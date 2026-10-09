// Pure state transitions: apply an engine event to a session's transcript.
import type { Block, EngineEvent, Message, Session } from '../shared/types'

function lastAssistant(s: Session): { msgs: Message[]; msg: Message } {
  const msgs = [...s.messages]
  let msg = msgs[msgs.length - 1]
  if (!msg || msg.role !== 'assistant') {
    msg = { role: 'assistant', blocks: [], ts: Date.now() }
    msgs.push(msg)
  } else {
    msg = { ...msg, blocks: [...msg.blocks] }
    msgs[msgs.length - 1] = msg
  }
  return { msgs, msg }
}

function mapBlocks(s: Session, fn: (b: Block) => Block): Session {
  return { ...s, messages: s.messages.map((m) => ({ ...m, blocks: m.blocks.map(fn) })) }
}

export function applyEvent(s: Session, ev: EngineEvent): Session {
  const now = Date.now()
  switch (ev.type) {
    case 'text-delta': {
      const { msgs, msg } = lastAssistant(s)
      const last = msg.blocks[msg.blocks.length - 1]
      if (last && last.kind === 'text') msg.blocks[msg.blocks.length - 1] = { kind: 'text', text: last.text + ev.text }
      else msg.blocks.push({ kind: 'text', text: ev.text })
      return { ...s, messages: msgs, updatedAt: now }
    }
    case 'tool-use': {
      const { msgs, msg } = lastAssistant(s)
      msg.blocks.push({ kind: 'tool', id: ev.id, name: ev.name, input: ev.input })
      return { ...s, messages: msgs, updatedAt: now }
    }
    case 'tool-result':
      return mapBlocks(s, (b) => (b.kind === 'tool' && b.id === ev.id ? { ...b, result: ev.result, isError: ev.isError } : b))
    case 'permission': {
      const { msgs, msg } = lastAssistant(s)
      msg.blocks.push({ kind: 'permission', id: ev.id, tool: ev.tool, input: ev.input, state: 'pending' })
      return { ...s, messages: msgs, updatedAt: now }
    }
    case 'spawn-request': {
      const { msgs, msg } = lastAssistant(s)
      msg.blocks.push({ kind: 'spawn', id: ev.id, prompt: ev.prompt, cwd: ev.cwd, model: ev.model, state: 'pending' })
      return { ...s, messages: msgs, updatedAt: now }
    }
    case 'claude-session':
      return { ...s, claudeSessionId: ev.sessionId }
    case 'meta':
    case 'error': {
      const { msgs, msg } = lastAssistant(s)
      msg.blocks.push(ev.type === 'meta' ? { kind: 'meta', text: ev.text } : { kind: 'error', text: ev.text })
      return { ...s, messages: msgs, updatedAt: now }
    }
    case 'done': {
      if (!ev.summary) return s
      const { msgs, msg } = lastAssistant(s)
      msg.blocks.push({ kind: 'meta', text: ev.summary })
      return { ...s, messages: msgs, updatedAt: now }
    }
    default:
      return s
  }
}

export function setBlock(s: Session, id: string, patch: Partial<Block>): Session {
  return mapBlocks(s, (b) => ('id' in b && b.id === id ? ({ ...b, ...patch } as Block) : b))
}

export function titleFrom(prompt: string): string {
  const t = prompt.replace(/\s+/g, ' ').trim()
  return t.length > 48 ? t.slice(0, 46) + '…' : t || 'New session'
}
