// Motherbrain engine: the hero on Mind (OpenAI-compatible, mlx_lm.server on :8100), with her
// sandboxed tools from mb-tools (:8140) plus one app-side tool, spawn_claude_session, which only
// runs after the user approves a card in the transcript.
import type { Message, SendArgs } from '../shared/types.js'
import { awaitDecision, newId, type Emit } from './bridge.js'

export const MB_URL = process.env.MB_URL ?? 'http://localhost:8100/v1'
export const MB_TOOLS_URL = process.env.MB_TOOLS_URL ?? 'http://localhost:8140'
const MAX_STEPS = 8

const running = new Map<string, AbortController>()

const SYSTEM = [
  'You are Motherbrain, Brandon\'s captive CFO, trading and market expert, running on his own hardware.',
  'Deterministic code computes; you never do arithmetic in your head — use code_interpreter when it is available.',
  'You can delegate work to a Claude Code session with spawn_claude_session; the user approves every spawn.',
  'Be direct and concise. Use markdown.',
].join(' ')

const SPAWN_TOOL = {
  type: 'function',
  function: {
    name: 'spawn_claude_session',
    description: 'Open a new Claude Code session (runs on the user\'s Claude subscription) to do a coding or research task. The user must approve. Returns the new session key.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The full task for the new session.' },
        cwd: { type: 'string', description: 'Working directory for the session (defaults to the current project).' },
        model: { type: 'string', enum: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'] },
      },
      required: ['prompt'],
    },
  },
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 2000): Promise<any> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

export async function motherbrainHealth(): Promise<{ up: boolean; models?: string[] }> {
  try {
    const j = await fetchJson(`${MB_URL}/models`)
    return { up: true, models: (j.data ?? []).map((m: any) => m.id) }
  } catch {
    return { up: false }
  }
}

export async function mbToolSchemas(): Promise<any[] | null> {
  try {
    const j = await fetchJson(`${MB_TOOLS_URL}/tools`)
    return Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

function toChat(history: Message[], prompt: string): any[] {
  const msgs: any[] = [{ role: 'system', content: SYSTEM }]
  for (const m of history) {
    const text = m.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => (b as any).text)
      .join('\n')
    if (text.trim()) msgs.push({ role: m.role, content: text })
  }
  msgs.push({ role: 'user', content: prompt })
  return msgs
}

interface StreamOut {
  content: string
  reasoning: string
  toolCalls: { id: string; name: string; arguments: string }[]
}

async function streamChat(body: any, signal: AbortSignal, onText: (t: string) => void): Promise<StreamOut> {
  const r = await fetch(`${MB_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`Motherbrain HTTP ${r.status}`)
  const out: StreamOut = { content: '', reasoning: '', toolCalls: [] }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j: any
      try {
        j = JSON.parse(data)
      } catch {
        continue
      }
      const d = j.choices?.[0]?.delta ?? {}
      if (d.reasoning) out.reasoning += d.reasoning
      if (d.content) {
        out.content += d.content
        onText(d.content)
      }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? out.toolCalls.length
        const cur = (out.toolCalls[i] ??= { id: tc.id ?? newId(), name: '', arguments: '' })
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
      }
    }
  }
  return out
}

export function interruptMotherbrain(sessionKey: string): boolean {
  const ac = running.get(sessionKey)
  if (!ac) return false
  ac.abort()
  return true
}

export async function runMotherbrain(args: SendArgs, emit: Emit): Promise<void> {
  const { sessionKey } = args
  if (running.has(sessionKey)) {
    emit(sessionKey, { type: 'error', text: 'This session is already running.' })
    return
  }
  const ac = new AbortController()
  running.set(sessionKey, ac)
  emit(sessionKey, { type: 'running', running: true })
  const t0 = Date.now()
  try {
    const mbTools = await mbToolSchemas()
    if (!mbTools) emit(sessionKey, { type: 'meta', text: 'mb-tools offline — Motherbrain is answering without code_interpreter.' })
    const tools = [...(mbTools ?? []).map((t: any) => (t.type ? t : { type: 'function', function: t })), SPAWN_TOOL]
    const messages = toChat(args.history, args.prompt)

    for (let step = 0; step < MAX_STEPS; step++) {
      const out = await streamChat({ model: args.model, messages, tools, max_tokens: 4096 }, ac.signal, (t) =>
        emit(sessionKey, { type: 'text-delta', text: t }),
      )
      if (out.reasoning.trim()) emit(sessionKey, { type: 'tool-use', id: newId(), name: 'Thinking', input: out.reasoning.trim() })
      if (!out.toolCalls.length) break
      messages.push({
        role: 'assistant',
        content: out.content,
        tool_calls: out.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      })
      for (const tc of out.toolCalls) {
        let input: any = {}
        try {
          input = JSON.parse(tc.arguments || '{}')
        } catch {
          input = { _raw: tc.arguments }
        }
        let result: string
        let isError = false
        if (tc.name === 'spawn_claude_session') {
          const id = newId()
          const prompt = String(input.prompt ?? '')
          const cwd = String(input.cwd || args.cwd)
          const model = String(input.model || 'claude-opus-5-5')
          const pendingDecision = awaitDecision<{ approved: boolean; sessionKey?: string }>(id, ac.signal)
          emit(sessionKey, { type: 'spawn-request', id, prompt, cwd, model })
          const decision = await pendingDecision
          result = decision.approved
            ? `Spawned Claude Code session ${decision.sessionKey}. It is running in the user's sidebar; you will not see its output.`
            : 'The user declined to spawn the session.'
        } else {
          emit(sessionKey, { type: 'tool-use', id: tc.id, name: tc.name, input })
          try {
            const j = await fetchJson(`${MB_TOOLS_URL}/tools/${encodeURIComponent(tc.name)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(input),
            }, 120000)
            result = typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? j)
          } catch (e: any) {
            result = `tool error: ${e?.message ?? e}`
            isError = true
          }
          emit(sessionKey, { type: 'tool-result', id: tc.id, result, isError })
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }
    emit(sessionKey, { type: 'done', summary: `${((Date.now() - t0) / 1000).toFixed(1)} s` })
  } catch (e: any) {
    if (ac.signal.aborted) emit(sessionKey, { type: 'meta', text: 'Interrupted.' })
    else emit(sessionKey, { type: 'error', text: `Motherbrain: ${e?.message ?? e}` })
    emit(sessionKey, { type: 'done' })
  } finally {
    running.delete(sessionKey)
    emit(sessionKey, { type: 'running', running: false })
  }
}
