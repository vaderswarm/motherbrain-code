import { describe, expect, it } from 'vitest'
import type { AppState, Session } from '../shared/types'
import {
  addProject, canBack, canForward, deleteSession, emptyNav, navForget, navPush, navStep, newSession, renameSession, slug,
} from '../src/lib/sessions'
import { transcriptMarkdown } from '../src/lib/transcript'

const sess = (key: string, projectId: string, updatedAt: number, extra: Partial<Session> = {}): Session =>
  newSession(projectId, undefined, key, updatedAt, { updatedAt, ...extra })

const base = (): AppState => ({
  user: { name: 'B', plan: 'Max' },
  projects: [
    { id: 'mm', name: 'MoneyMaker', cwd: '/r/mm' },
    { id: 'syn', name: 'Syndicate', cwd: '/r/syn' },
  ],
  sessions: [sess('a', 'mm', 10), sess('b', 'mm', 30), sess('c', 'mm', 20, { spawnedBy: 'b' }), sess('d', 'syn', 40)],
  selected: 'b',
})

describe('session store', () => {
  it('newSession inherits model, effort and mode from the previous session', () => {
    const prev = sess('p', 'mm', 0, { model: 'claude-haiku-4-5-20251001', effort: 'high', mode: 'plan' })
    const s = newSession('syn', prev, 'k', 5)
    expect(s).toMatchObject({ key: 'k', projectId: 'syn', model: 'claude-haiku-4-5-20251001', effort: 'high', mode: 'plan', messages: [], createdAt: 5 })
  })

  it('renames, normalising whitespace, and ignores a blank name', () => {
    let st = renameSession(base(), 'a', '  lock   audit \n')
    expect(st.sessions.find((s) => s.key === 'a')!.title).toBe('lock audit')
    const same = renameSession(st, 'a', '   ')
    expect(same).toBe(st)
  })

  it('deleting the selected session selects the most recent remaining one in its project', () => {
    const st = deleteSession(base(), 'b')
    expect(st.sessions.map((s) => s.key)).toEqual(['a', 'c', 'd'])
    expect(st.selected).toBe('c')
    // the child no longer points at a deleted parent
    expect(st.sessions.find((s) => s.key === 'c')!.spawnedBy).toBeUndefined()
  })

  it('deleting another session keeps the selection; the last one in a project clears it', () => {
    expect(deleteSession(base(), 'a').selected).toBe('b')
    const st = { ...base(), selected: 'd' }
    expect(deleteSession(st, 'd').selected).toBeUndefined()
    expect(deleteSession(st, 'zzz')).toBe(st)
  })

  it('adds a project with a unique slug id and rejects missing fields', () => {
    const { state, project } = addProject(base(), ' Money Maker! ', '/x')
    expect(project).toEqual({ id: 'money-maker', name: 'Money Maker!', cwd: '/x' })
    const again = addProject(state, 'money maker', '/y').project
    expect(again.id).toBe('money-maker-2')
    expect(() => addProject(base(), '', '/x')).toThrow()
    expect(() => addProject(base(), 'n', ' ')).toThrow()
    expect(slug('***')).toBe('project')
  })
})

describe('back / forward', () => {
  it('pushes, steps back and forward, and truncates the forward branch on a new visit', () => {
    let n = emptyNav()
    n = navPush(n, { view: 'chat', session: 'a' })
    n = navPush(n, { view: 'chat', session: 'a' }) // repeat: no-op
    n = navPush(n, { view: 'chat', session: 'b' })
    n = navPush(n, { view: 'tape' })
    expect(n.stack.length).toBe(3)
    expect(canForward(n)).toBe(false)
    let r = navStep(n, -1, () => true)
    expect(r.place).toEqual({ view: 'chat', session: 'b' })
    r = navStep(r.nav, -1, () => true)
    expect(r.place).toEqual({ view: 'chat', session: 'a' })
    expect(canBack(r.nav)).toBe(false)
    expect(navStep(r.nav, -1, () => true).place).toBeUndefined()
    n = navPush(r.nav, { view: 'customize' })
    expect(n.stack.map((p) => p.view)).toEqual(['chat', 'customize'])
    expect(canForward(n)).toBe(false)
  })

  it('skips sessions that no longer exist, and forgets a deleted one', () => {
    let n = emptyNav()
    for (const k of ['a', 'b', 'a', 'c']) n = navPush(n, { view: 'chat', session: k })
    const r = navStep(n, -1, (k) => k !== 'a')
    expect(r.place).toEqual({ view: 'chat', session: 'b' })
    const f = navForget(n, 'b') // a, a merge into one
    expect(f.stack).toEqual([{ view: 'chat', session: 'a' }, { view: 'chat', session: 'c' }])
    expect(f.index).toBe(1)
    expect(navForget(navPush(emptyNav(), { view: 'chat', session: 'x' }), 'x')).toEqual({ stack: [], index: -1 })
  })
})

describe('transcript export', () => {
  it('renders user, assistant text, tools and attachments as markdown', () => {
    const s = sess('a', 'mm', 0, {
      title: 'T',
      claudeSessionId: 'abc',
      messages: [
        { role: 'user', ts: 0, blocks: [{ kind: 'text', text: 'hi' }], attachments: [{ path: '/f.txt', name: 'f.txt', size: 1, mime: 'text/plain', kind: 'text' }] },
        { role: 'assistant', ts: 0, blocks: [{ kind: 'text', text: 'yo' }, { kind: 'tool', id: '1', name: 'Bash', input: { command: 'ls' }, result: 'a```b' }] },
      ],
    })
    const md = transcriptMarkdown(s, base().projects[0])
    expect(md).toContain('# T')
    expect(md).toContain('claude --resume abc')
    expect(md).toContain('## You\n\nhi\n\n- attached: `/f.txt`')
    expect(md).toContain('**Tool: Bash**')
    expect(md).toContain('````\na```b\n````') // fence longer than any run inside
  })
})
