// Smoke test for both engines outside Electron: one tiny Claude Code turn (haiku, via the
// Agent SDK and the local CLI login) and one streamed Motherbrain reply.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { homedir } from 'node:os'
import { join } from 'node:path'

const t0 = Date.now()
let deltas = 0, text = '', sessionId = ''
for await (const m of query({
  prompt: 'Reply with exactly: OK',
  options: {
    model: 'claude-haiku-4-5-20251001',
    includePartialMessages: true,
    permissionMode: 'default',
    allowedTools: [],
    maxTurns: 1,
    cwd: join(homedir(), 'motherbrain-code'),
    pathToClaudeCodeExecutable: join(homedir(), '.local', 'bin', 'claude'),
  },
})) {
  if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id
  if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') { deltas++; text += m.event.delta.text }
  if (m.type === 'result') console.log(`[claude] ${m.subtype} · ${deltas} deltas · "${text.trim()}" · session ${sessionId} · ${Date.now() - t0} ms`)
}

const t1 = Date.now()
try {
  const r = await fetch('http://localhost:8100/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'mlx-community/Qwen3.5-397B-A17B-4bit', stream: true, max_tokens: 400,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }] }),
  })
  const dec = new TextDecoder(); let chunks = 0, content = '', reasoning = ''
  for await (const part of r.body) {
    for (const line of dec.decode(part, { stream: true }).split('\n')) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue
      try { const d = JSON.parse(line.slice(5)).choices?.[0]?.delta ?? {}; if (d.content) { chunks++; content += d.content } if (d.reasoning) reasoning += d.reasoning } catch {}
    }
  }
  console.log(`[motherbrain] HTTP ${r.status} · ${chunks} content chunks · "${content.trim().slice(0, 80)}" · reasoning ${reasoning.length} chars · ${Date.now() - t1} ms`)
} catch (e) {
  console.log('[motherbrain] unreachable:', e.message)
}
