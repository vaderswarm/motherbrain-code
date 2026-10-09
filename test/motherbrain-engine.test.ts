// The Motherbrain engine end to end against a mock OpenAI-compatible server and a mock mb-tools
// server: turn 1 makes a tool call; turn 2 must receive that call and its result in the history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EngineEvent, Message } from '../shared/types'
import { applyEvent } from '../src/state'

let mbServer: Server
let toolsServer: Server
const requests: any[] = []

function sse(res: any, chunks: object[]) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: c }] })}\n\n`)
  res.end('data: [DONE]\n\n')
}

function body(req: any): Promise<any> {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (d: Buffer) => (b += d))
    req.on('end', () => resolve(b ? JSON.parse(b) : {}))
  })
}

beforeAll(async () => {
  mbServer = createServer(async (req, res) => {
    const j = await body(req)
    requests.push(j)
    const last = j.messages[j.messages.length - 1]
    if (last.role === 'user' && last.content.includes('compute')) {
      // first step of turn 1: call the tool
      sse(res, [{ content: 'Running it.' }, { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'code_interpreter', arguments: '{"code":' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"6*7"}' } }] }])
    } else if (last.role === 'tool') {
      sse(res, [{ content: 'The answer is 42.' }])
    } else {
      sse(res, [{ content: 'ok' }])
    }
  })
  toolsServer = createServer(async (req, res) => {
    if (req.url === '/tools') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([{ name: 'code_interpreter', description: 'py', parameters: { type: 'object', properties: { code: { type: 'string' } } } }]))
    }
    await body(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ result: '42' }))
  })
  await new Promise<void>((r) => mbServer.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => toolsServer.listen(0, '127.0.0.1', r))
  process.env.MB_URL = `http://127.0.0.1:${(mbServer.address() as AddressInfo).port}/v1`
  process.env.MB_TOOLS_URL = `http://127.0.0.1:${(toolsServer.address() as AddressInfo).port}`
})

afterAll(() => {
  mbServer?.close()
  toolsServer?.close()
})

describe('runMotherbrain', () => {
  it('replays her earlier tool call and result into the next turn', async () => {
    const { runMotherbrain } = await import('../electron/motherbrain')
    let session: any = { key: 's', messages: [] as Message[] }
    const emit = (_k: string, ev: EngineEvent) => {
      session = applyEvent(session, ev)
    }
    const base = { sessionKey: 's', model: 'mb', effort: 'low' as const, mode: 'auto' as const, cwd: '/tmp' }

    session.messages.push({ role: 'user', ts: 0, blocks: [{ kind: 'text', text: 'compute 6*7' }] })
    await runMotherbrain({ ...base, prompt: 'compute 6*7', history: [] }, emit)
    const tool = session.messages[1].blocks.find((b: any) => b.kind === 'tool')
    expect(tool).toMatchObject({ id: 'call_abc', name: 'code_interpreter', input: { code: '6*7' }, result: '42' })

    const history = session.messages
    requests.length = 0
    await runMotherbrain({ ...base, prompt: 'and doubled?', history }, emit)
    const msgs = requests[0].messages
    expect(msgs.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
    expect(msgs[2].tool_calls[0]).toEqual({ id: 'call_abc', type: 'function', function: { name: 'code_interpreter', arguments: '{"code":"6*7"}' } })
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'call_abc', content: '42' })
    expect(msgs[4]).toEqual({ role: 'assistant', content: 'The answer is 42.' })
    expect(msgs[5]).toEqual({ role: 'user', content: 'and doubled?' })
  })
})
