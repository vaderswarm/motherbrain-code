// Claude Code engine: drives the local `claude` CLI through the Agent SDK, so it runs on the
// signed-in subscription and its sessions land in ~/.claude/projects like any CLI session.
import { query, type Options, type PermissionResult, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { SendArgs } from '../shared/types.js'
import { MODELS } from '../shared/types.js'
import { awaitDecision, newId, type Emit } from './bridge.js'
import { attachmentText, imageBlocks } from './attachments.js'

const running = new Map<string, AbortController>()

export function claudePath(): string | undefined {
  const p = join(homedir(), '.local', 'bin', 'claude')
  return existsSync(p) ? p : undefined
}

export function claudeVersion(): string | undefined {
  const p = claudePath()
  if (!p) return undefined
  try {
    return execFileSync(p, ['--version'], { timeout: 5000 }).toString().trim()
  } catch {
    return undefined
  }
}

function stringifyResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c?.type === 'text' ? c.text : c?.type === 'image' ? '[image]' : JSON.stringify(c)))
      .join('\n')
  }
  return JSON.stringify(content)
}

export function isClaudeRunning(sessionKey: string): boolean {
  return running.has(sessionKey)
}

export function interruptClaude(sessionKey: string): boolean {
  const ac = running.get(sessionKey)
  if (!ac) return false
  ac.abort()
  return true
}

export async function runClaude(args: SendArgs, emit: Emit): Promise<void> {
  const { sessionKey } = args
  if (running.has(sessionKey)) {
    emit(sessionKey, { type: 'error', text: 'This session is already running.' })
    return
  }
  const ac = new AbortController()
  running.set(sessionKey, ac)
  emit(sessionKey, { type: 'running', running: true })

  const model = MODELS.find((m) => m.id === args.model)
  const options: Options = {
    abortController: ac,
    cwd: args.cwd,
    model: args.model,
    permissionMode: args.mode,
    includePartialMessages: true,
    // Load the user's own settings so their permission rules and hooks bind here too.
    settingSources: ['user', 'project', 'local'],
    canUseTool: async (toolName, input, { signal }): Promise<PermissionResult> => {
      const id = newId()
      // Register before emitting so an immediate answer cannot be lost.
      const decision = awaitDecision<boolean>(id, signal)
      emit(sessionKey, { type: 'permission', id, tool: toolName, input })
      try {
        const allow = await decision
        return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user denied this tool call.' }
      } catch {
        return { behavior: 'deny', message: 'Interrupted.', interrupt: true }
      }
    },
  }
  if (model?.supportsEffort) options.effort = args.effort
  if (args.claudeSessionId) options.resume = args.claudeSessionId
  const exe = claudePath()
  if (exe) options.pathToClaudeCodeExecutable = exe

  // Attachments: text is inlined into the prompt; images need a structured user message, which the
  // SDK takes as a one-message input stream.
  const atts = args.attachments ?? []
  const text = args.prompt + attachmentText(atts, 'claude')
  const { blocks: images, skipped } = imageBlocks(atts)
  for (const s of skipped) emit(sessionKey, { type: 'meta', text: `Image not sent: ${s}` })
  let prompt: string | AsyncIterable<SDKUserMessage> = text
  if (images.length) {
    const msg: SDKUserMessage = {
      type: 'user',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text }, ...images] as any },
    }
    prompt = (async function* () {
      yield msg
    })()
  }

  try {
    for await (const msg of query({ prompt, options })) {
      switch (msg.type) {
        case 'system':
          if ((msg as any).subtype === 'init') emit(sessionKey, { type: 'claude-session', sessionId: msg.session_id })
          break
        case 'stream_event': {
          const ev: any = (msg as any).event
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            emit(sessionKey, { type: 'text-delta', text: ev.delta.text })
          }
          break
        }
        case 'assistant': {
          // Text already arrived as deltas; take only tool calls from the full message.
          for (const block of (msg as any).message?.content ?? []) {
            if (block.type === 'tool_use') emit(sessionKey, { type: 'tool-use', id: block.id, name: block.name, input: block.input })
          }
          break
        }
        case 'user': {
          const content = (msg as any).message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result') {
                emit(sessionKey, { type: 'tool-result', id: block.tool_use_id, result: stringifyResult(block.content), isError: !!block.is_error })
              }
            }
          }
          break
        }
        case 'result': {
          const r: any = msg
          const secs = r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + ' s' : ''
          if (r.subtype !== 'success') emit(sessionKey, { type: 'error', text: `Run ended: ${r.subtype}` })
          emit(sessionKey, { type: 'done', summary: [secs, r.num_turns ? `${r.num_turns} turns` : ''].filter(Boolean).join(' · ') })
          break
        }
      }
    }
  } catch (e: any) {
    if (ac.signal.aborted) emit(sessionKey, { type: 'meta', text: 'Interrupted.' })
    else emit(sessionKey, { type: 'error', text: String(e?.message ?? e) })
    emit(sessionKey, { type: 'done' })
  } finally {
    running.delete(sessionKey)
    emit(sessionKey, { type: 'running', running: false })
  }
}
