// Rebuild an OpenAI chat history from a stored transcript, including earlier tool calls and their
// results, so Motherbrain sees what she (or a Claude turn in the same session) actually did, not
// only the prose around it. Pure: no I/O, used by electron/motherbrain.ts and the unit tests.
import type { Block, Message } from './types.js'

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface HistoryLimits {
  maxResultChars: number // one tool result
  maxArgChars: number // one tool call's JSON arguments
  maxTotalChars: number // the whole replayed history; the oldest turns are dropped first
}

export const DEFAULT_LIMITS: HistoryLimits = { maxResultChars: 6000, maxArgChars: 4000, maxTotalChars: 120_000 }

export const truncMarker = (n: number) => `[… truncated ${n.toLocaleString('en-US')} chars]`
export const droppedMarker = (n: number) =>
  `[Earlier conversation truncated: ${n} older turn${n === 1 ? '' : 's'} omitted to fit the context budget.]`

// Keep the head and the tail of a long result: errors and summaries tend to sit at the end.
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.length - max
  const head = Math.ceil(max * 0.7)
  const tail = max - head
  return s.slice(0, head) + `\n${truncMarker(cut)}\n` + (tail > 0 ? s.slice(s.length - tail) : '')
}

function argsJson(input: unknown, max: number): string {
  let j: string
  try {
    j = JSON.stringify(input ?? {})
  } catch {
    j = '{}'
  }
  if (j === undefined) j = '{}'
  // Arguments must stay valid JSON (chat templates parse them), so an oversize call is wrapped.
  if (j.length > max) return JSON.stringify({ _truncated: truncate(j, max) })
  // Non-object inputs (a bare string) are wrapped too: function arguments are an object.
  if (!j.startsWith('{')) return JSON.stringify({ input })
  return j
}

const SKIP_TOOLS = new Set(['Thinking']) // reasoning shown in the UI, not a call she made

type ToolLike = { id: string; name: string; input: unknown; result: string; isError?: boolean }

function asTool(b: Block): ToolLike | null {
  if (b.kind === 'tool') {
    if (SKIP_TOOLS.has(b.name)) return null
    const result = b.result === undefined ? '[no result: the turn was interrupted before this tool returned]' : b.result
    return { id: b.id, name: b.name, input: b.input, result: b.isError ? `error: ${result}` : result }
  }
  if (b.kind === 'spawn') {
    const result =
      b.state === 'approved'
        ? `Spawned Claude Code session${b.sessionKey ? ' ' + b.sessionKey : ''}. It is running in the user's sidebar; you will not see its output.`
        : b.state === 'declined'
          ? 'The user declined to spawn the session.'
          : '[no decision: the turn ended before the user answered]'
    return { id: b.id, name: 'spawn_claude_session', input: { prompt: b.prompt, cwd: b.cwd, model: b.model }, result }
  }
  return null
}

function userText(m: Message): string {
  const text = m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')
  const att = (m.attachments ?? []).map((a) => `[attached ${a.kind}: ${a.path}]`)
  return [text, ...att].filter((x) => x.trim()).join('\n')
}

// One stored assistant message becomes: assistant(text, tool_calls) → tool results → assistant(text) …
// in the order the blocks were produced.
function assistantMessages(m: Message, lim: HistoryLimits): ChatMessage[] {
  const out: ChatMessage[] = []
  let text = ''
  let calls: ToolLike[] = []
  const flushCalls = () => {
    if (!calls.length) return
    out.push({
      role: 'assistant',
      content: text,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: argsJson(c.input, lim.maxArgChars) } })),
    })
    for (const c of calls) out.push({ role: 'tool', tool_call_id: c.id, content: truncate(c.result, lim.maxResultChars) })
    text = ''
    calls = []
  }
  for (const b of m.blocks) {
    if (b.kind === 'text') {
      if (calls.length) flushCalls()
      text += b.text
      continue
    }
    const t = asTool(b)
    if (t) calls.push(t)
    // permission cards, errors and meta lines are UI, not conversation
  }
  flushCalls()
  if (text.trim()) out.push({ role: 'assistant', content: text })
  return out
}

const size = (m: ChatMessage) =>
  m.content.length + (m.role === 'assistant' && m.tool_calls ? m.tool_calls.reduce((n, c) => n + c.function.arguments.length + c.function.name.length, 0) : 0)

// Build the replayed history (system prompt and the new user turn are added by the caller).
export function buildHistory(history: Message[], limits: Partial<HistoryLimits> = {}): ChatMessage[] {
  const lim = { ...DEFAULT_LIMITS, ...limits }
  // Group into turns that start at a user message, so dropping never orphans a tool result.
  const turns: ChatMessage[][] = []
  for (const m of history) {
    if (m.role === 'user') {
      const t = userText(m)
      turns.push(t.trim() ? [{ role: 'user', content: t }] : [])
    } else {
      if (!turns.length) turns.push([])
      turns[turns.length - 1].push(...assistantMessages(m, lim))
    }
  }
  const nonEmpty = turns.filter((t) => t.length)
  let total = 0
  let keepFrom = nonEmpty.length
  for (let i = nonEmpty.length - 1; i >= 0; i--) {
    const n = nonEmpty[i].reduce((a, m) => a + size(m), 0)
    if (total + n > lim.maxTotalChars && keepFrom < nonEmpty.length) break
    total += n
    keepFrom = i
    if (total > lim.maxTotalChars) break // a single newest turn over budget is still kept, alone
  }
  const kept = nonEmpty.slice(keepFrom).flat()
  const dropped = keepFrom
  if (!dropped) return kept
  // Say so, in the first kept user turn (or as one), so the history still opens on a user message.
  const first = kept[0]
  if (first?.role === 'user') return [{ role: 'user', content: `${droppedMarker(dropped)}\n\n${first.content}` }, ...kept.slice(1)]
  return [{ role: 'user', content: droppedMarker(dropped) }, ...kept]
}
