import { describe, expect, it } from 'vitest'
import { buildHistory, droppedMarker, truncate, type ChatMessage } from '../shared/history'
import type { Message } from '../shared/types'

const user = (text: string, extra: Partial<Message> = {}): Message => ({ role: 'user', ts: 0, blocks: [{ kind: 'text', text }], ...extra })
const asst = (blocks: Message['blocks']): Message => ({ role: 'assistant', ts: 0, blocks })

describe('buildHistory', () => {
  it('replays text-only turns as plain messages', () => {
    const h = buildHistory([user('hi'), asst([{ kind: 'text', text: 'hello' }, { kind: 'meta', text: '1.2 s' }])])
    expect(h).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('replays tool calls and results in OpenAI tool-message format, in block order', () => {
    const h = buildHistory([
      user('compute'),
      asst([
        { kind: 'text', text: 'Let me run it.' },
        { kind: 'tool', id: 'Thinking-1', name: 'Thinking', input: 'reasoning…' },
        { kind: 'tool', id: 'call_1', name: 'code_interpreter', input: { code: '1+1' }, result: '2' },
        { kind: 'tool', id: 'call_2', name: 'read_file', input: { path: '/x' }, result: 'nope', isError: true },
        { kind: 'text', text: 'It is 2.' },
        { kind: 'meta', text: '3.1 s' },
      ]),
    ])
    expect(h).toEqual<ChatMessage[]>([
      { role: 'user', content: 'compute' },
      {
        role: 'assistant',
        content: 'Let me run it.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'code_interpreter', arguments: '{"code":"1+1"}' } },
          { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"/x"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '2' },
      { role: 'tool', tool_call_id: 'call_2', content: 'error: nope' },
      { role: 'assistant', content: 'It is 2.' },
    ])
  })

  it('answers every tool call, even one interrupted before its result, and replays spawn cards as calls', () => {
    const h = buildHistory([
      user('go'),
      asst([
        { kind: 'tool', id: 'c1', name: 'code_interpreter', input: { code: 'sleep(99)' } },
        { kind: 'spawn', id: 's1', prompt: 'build it', cwd: '/r', model: 'claude-opus-5-5', state: 'approved', sessionKey: 'k9' },
        { kind: 'spawn', id: 's2', prompt: 'other', cwd: '/r', model: 'claude-opus-5-5', state: 'declined' },
      ]),
    ])
    const calls = (h[1] as any).tool_calls.map((c: any) => c.id)
    const answered = h.filter((m) => m.role === 'tool').map((m: any) => m.tool_call_id)
    expect(calls).toEqual(['c1', 's1', 's2'])
    expect(answered).toEqual(calls)
    expect((h[2] as any).content).toMatch(/interrupted/)
    expect((h[1] as any).tool_calls[1].function).toEqual({ name: 'spawn_claude_session', arguments: '{"prompt":"build it","cwd":"/r","model":"claude-opus-5-5"}' })
    expect((h[3] as any).content).toContain('k9')
    expect((h[4] as any).content).toMatch(/declined/)
  })

  it('caps a long tool result with a truncation marker, keeping head and tail', () => {
    const long = 'A'.repeat(5000) + 'TAIL'
    const h = buildHistory([user('x'), asst([{ kind: 'tool', id: 'c', name: 't', input: {}, result: long }])], { maxResultChars: 1000 })
    const tool = h.find((m) => m.role === 'tool')!
    expect(tool.content.length).toBeLessThan(1100)
    expect(tool.content).toMatch(/\[… truncated 4,004 chars\]/)
    expect(tool.content.endsWith('TAIL')).toBe(true)
  })

  it('keeps oversize arguments valid JSON', () => {
    const h = buildHistory([user('x'), asst([{ kind: 'tool', id: 'c', name: 't', input: { code: 'y'.repeat(9000) }, result: 'ok' }])], { maxArgChars: 500 })
    const args = (h[1] as any).tool_calls[0].function.arguments
    expect(() => JSON.parse(args)).not.toThrow()
    expect(JSON.parse(args)._truncated).toMatch(/truncated/)
    expect(args.length).toBeLessThan(700)
  })

  it('wraps a non-object tool input as an object', () => {
    const h = buildHistory([user('x'), asst([{ kind: 'tool', id: 'c', name: 't', input: 'ls', result: 'ok' }])])
    expect(JSON.parse((h[1] as any).tool_calls[0].function.arguments)).toEqual({ input: 'ls' })
  })

  it('drops the oldest whole turns over the total budget and says so, never orphaning a tool message', () => {
    const turn = (i: number): Message[] => [
      user(`q${i}`),
      asst([{ kind: 'tool', id: `c${i}`, name: 't', input: {}, result: 'r'.repeat(400) }, { kind: 'text', text: `a${i}` }]),
    ]
    const h = buildHistory([...turn(1), ...turn(2), ...turn(3), ...turn(4)], { maxTotalChars: 1000 })
    expect(h[0].role).toBe('user')
    expect(h[0].content.startsWith(droppedMarker(2))).toBe(true)
    expect(h[0].content).toContain('q3')
    const ids = new Set(h.flatMap((m) => (m.role === 'assistant' && m.tool_calls ? m.tool_calls.map((c) => c.id) : [])))
    for (const m of h) if (m.role === 'tool') expect(ids.has(m.tool_call_id)).toBe(true)
    expect(h.some((m) => m.content === 'a1')).toBe(false)
    expect(h.some((m) => m.content === 'a4')).toBe(true)
  })

  it('notes attachments on user turns by path', () => {
    const h = buildHistory([user('see file', { attachments: [{ path: '/tmp/a.csv', name: 'a.csv', size: 3, mime: 'text/plain', kind: 'text' }] })])
    expect(h[0].content).toBe('see file\n[attached text: /tmp/a.csv]')
  })

  it('handles an assistant message with no preceding user turn', () => {
    expect(buildHistory([asst([{ kind: 'text', text: 'boot' }])])).toEqual([{ role: 'assistant', content: 'boot' }])
  })
})

describe('truncate', () => {
  it('is the identity under the cap', () => {
    expect(truncate('abc', 3)).toBe('abc')
  })
})
