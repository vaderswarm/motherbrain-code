// Pure operations on the persisted app state: sessions, projects, and back/forward navigation.
// App.tsx calls these inside setState; the unit tests call them directly.
import type { AppState, Project, Session } from '../../shared/types'

export function newSession(projectId: string, prev: Session | undefined, key: string, now = Date.now(), init: Partial<Session> = {}): Session {
  return {
    key,
    projectId,
    title: 'New session',
    model: prev?.model ?? 'claude-opus-5-5',
    effort: prev?.effort ?? 'medium',
    mode: prev?.mode ?? 'auto',
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...init,
  }
}

export function renameSession(st: AppState, key: string, title: string): AppState {
  const t = title.replace(/\s+/g, ' ').trim()
  if (!t) return st
  return { ...st, sessions: st.sessions.map((s) => (s.key === key ? { ...s, title: t } : s)) }
}

// Deleting the selected session selects the next most recent one in the same project, else none.
export function deleteSession(st: AppState, key: string): AppState {
  const gone = st.sessions.find((s) => s.key === key)
  if (!gone) return st
  const sessions = st.sessions
    .filter((s) => s.key !== key)
    // a child keeps its ✦ history but no longer points at a parent that is gone
    .map((s) => (s.spawnedBy === key ? { ...s, spawnedBy: undefined } : s))
  let selected = st.selected
  if (selected === key) {
    const sameProject = sessions.filter((s) => s.projectId === gone.projectId).sort((a, b) => b.updatedAt - a.updatedAt)
    selected = sameProject[0]?.key
  }
  return { ...st, sessions, selected }
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

export function addProject(st: AppState, name: string, cwd: string): { state: AppState; project: Project } {
  const n = name.trim()
  const c = cwd.trim()
  if (!n || !c) throw new Error('A project needs a name and a working folder.')
  const base = slug(n)
  let id = base
  for (let i = 2; st.projects.some((p) => p.id === id); i++) id = `${base}-${i}`
  const project = { id, name: n, cwd: c }
  return { state: { ...st, projects: [...st.projects, project] }, project }
}

// ---------------------------------------------------------------- back / forward
// A browser-style history of places: a session, or one of the panels.
export type Place = { view: string; session?: string }

export interface Nav {
  stack: Place[]
  index: number
}

export const emptyNav = (): Nav => ({ stack: [], index: -1 })

const same = (a: Place | undefined, b: Place) => !!a && a.view === b.view && (a.view !== 'chat' || a.session === b.session)

// Visiting a new place drops the forward branch, like a browser.
export function navPush(n: Nav, p: Place, cap = 100): Nav {
  if (same(n.stack[n.index], p)) return n
  const stack = [...n.stack.slice(0, n.index + 1), p].slice(-cap)
  return { stack, index: stack.length - 1 }
}

export const canBack = (n: Nav) => n.index > 0
export const canForward = (n: Nav) => n.index < n.stack.length - 1

// Step back or forward, skipping places whose session no longer exists.
export function navStep(n: Nav, dir: -1 | 1, exists: (key: string) => boolean): { nav: Nav; place?: Place } {
  for (let i = n.index + dir; i >= 0 && i < n.stack.length; i += dir) {
    const p = n.stack[i]
    if (p.view !== 'chat' || !p.session || exists(p.session)) return { nav: { ...n, index: i }, place: p }
  }
  return { nav: n }
}

// Drop a deleted session from the history, keeping the index on the same place where possible.
export function navForget(n: Nav, key: string): Nav {
  const stack: Place[] = []
  let index = -1
  n.stack.forEach((p, i) => {
    if (p.view === 'chat' && p.session === key) return
    if (same(stack[stack.length - 1], p)) {
      if (i <= n.index) index = stack.length - 1
      return
    }
    stack.push(p)
    if (i <= n.index) index = stack.length - 1
  })
  return { stack, index: stack.length ? Math.max(0, index) : -1 }
}
