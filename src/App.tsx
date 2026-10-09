import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Laptop, MoreHorizontal, PanelRight, Share } from 'lucide-react'
import type { AppState, Effort, EngineEvent, HealthReport, Mode, Session } from '../shared/types'
import { MODELS } from '../shared/types'
import { mb } from './api'
import { applyEvent, setBlock, titleFrom } from './state'
import { Sidebar, type View } from './components/Sidebar'
import { Transcript } from './components/Transcript'
import { Composer } from './components/Composer'
import { ArtifactsPanel, EnginesPanel, TapePanel } from './components/Panels'
import { demoState } from './demo'

const newKey = () => crypto.randomUUID()

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>('chat')
  const [sidebar, setSidebar] = useState(true)
  const [health, setHealth] = useState<HealthReport>()
  const [demo, setDemo] = useState(false)
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state

  // load + persist
  useEffect(() => {
    ;(async () => {
      const info = await mb().info()
      setDemo(info.demo)
      setState(info.demo ? demoState() : await mb().loadState())
    })()
  }, [])
  useEffect(() => {
    if (!state || demo) return
    const t = setTimeout(() => mb().saveState(state), 400)
    return () => clearTimeout(t)
  }, [state, demo])

  // engine health, polled
  useEffect(() => {
    const poll = () => mb().health().then(setHealth).catch(() => {})
    poll()
    const t = setInterval(poll, 15000)
    return () => clearInterval(t)
  }, [])

  const updateSession = useCallback((key: string, fn: (s: Session) => Session) => {
    setState((st) => (st ? { ...st, sessions: st.sessions.map((s) => (s.key === key ? fn(s) : s)) } : st))
  }, [])

  // engine events
  useEffect(
    () =>
      mb().onEvent((key: string, ev: EngineEvent) => {
        if (ev.type === 'running') {
          setRunning((r) => {
            const n = new Set(r)
            ev.running ? n.add(key) : n.delete(key)
            return n
          })
          return
        }
        updateSession(key, (s) => applyEvent(s, ev))
      }),
    [updateSession],
  )

  const current = useMemo(() => state?.sessions.find((s) => s.key === state.selected), [state])
  const project = useMemo(
    () => state?.projects.find((p) => p.id === (current?.projectId ?? state?.projects[0]?.id)),
    [state, current],
  )

  const createSession = useCallback((projectId: string, init: Partial<Session> = {}): Session => {
    const now = Date.now()
    const prev = stateRef.current?.sessions.find((s) => s.key === stateRef.current?.selected)
    return {
      key: newKey(),
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
  }, [])

  const onNew = (projectId?: string) => {
    if (!state) return
    const s = createSession(projectId ?? project?.id ?? state.projects[0].id)
    setState({ ...state, sessions: [s, ...state.sessions], selected: s.key })
    setView('chat')
  }

  const sendIn = useCallback((s: Session, prompt: string) => {
    const st = stateRef.current
    const cwd = st?.projects.find((p) => p.id === s.projectId)?.cwd ?? '~'
    const history = s.messages
    const user = { role: 'user' as const, blocks: [{ kind: 'text' as const, text: prompt }], ts: Date.now() }
    const next: Session = {
      ...s,
      title: s.messages.length ? s.title : titleFrom(prompt),
      messages: [...s.messages, user, { role: 'assistant', blocks: [], ts: Date.now() }],
      updatedAt: Date.now(),
    }
    setState((cur) => {
      if (!cur) return cur
      const exists = cur.sessions.some((x) => x.key === s.key)
      return { ...cur, sessions: exists ? cur.sessions.map((x) => (x.key === s.key ? next : x)) : [next, ...cur.sessions] }
    })
    mb().send({ sessionKey: s.key, prompt, model: s.model, effort: s.effort, mode: s.mode, cwd, claudeSessionId: s.claudeSessionId, history })
  }, [])

  const onSend = (text: string) => {
    if (!state) return
    let s = current
    if (!s) {
      s = createSession(project?.id ?? state.projects[0].id)
      setState({ ...state, sessions: [s, ...state.sessions], selected: s.key })
    }
    sendIn(s, text)
  }

  const onPermission = (id: string, allow: boolean) => {
    if (!current) return
    mb().respond(id, allow)
    updateSession(current.key, (s) => setBlock(s, id, { state: allow ? 'allowed' : 'denied' } as any))
  }

  const onSpawn = (id: string, approve: boolean) => {
    if (!current || !state) return
    const block = current.messages.flatMap((m) => m.blocks).find((b) => b.kind === 'spawn' && b.id === id)
    if (!block || block.kind !== 'spawn') return
    if (!approve) {
      mb().respond(id, { approved: false })
      updateSession(current.key, (s) => setBlock(s, id, { state: 'declined' } as any))
      return
    }
    // The spawned session lives in the project whose cwd matches, else the parent's project.
    const proj = state.projects.find((p) => p.cwd === block.cwd) ?? project
    const child = createSession(proj?.id ?? current.projectId, {
      model: MODELS.some((m) => m.id === block.model && m.engine === 'claude') ? block.model : 'claude-opus-5-5',
      spawnedBy: current.key,
    })
    setState((cur) => (cur ? { ...cur, sessions: [child, ...cur.sessions] } : cur))
    updateSession(current.key, (s) => setBlock(s, id, { state: 'approved', sessionKey: child.key } as any))
    mb().respond(id, { approved: true, sessionKey: child.key })
    sendIn({ ...child }, block.prompt)
  }

  const setPref = (patch: Partial<Pick<Session, 'model' | 'effort' | 'mode'>>) => {
    if (current) updateSession(current.key, (s) => ({ ...s, ...patch }))
  }

  if (!state) return <div className="h-full bg-app" />

  const nRunning = running.size
  const model = current?.model ?? 'claude-opus-5-5'

  return (
    <div className="flex h-full">
      {sidebar && (
        <Sidebar
          state={state}
          running={running}
          view={view}
          onSelect={(k) => {
            setState({ ...state, selected: k })
            setView('chat')
          }}
          onNew={onNew}
          onView={setView}
          onToggle={() => setSidebar(false)}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col bg-app">
        <header className="drag flex h-[58px] shrink-0 items-center px-5" style={{ paddingLeft: sidebar ? 20 : 96 }}>
          {!sidebar && (
            <button className="no-drag mr-3 rounded-md p-1.5 text-mute hover:bg-row hover:text-ink" onClick={() => setSidebar(true)} title="Show sidebar">
              <PanelRight size={17} />
            </button>
          )}
          <button className="no-drag flex items-center gap-2 rounded-md px-1.5 py-1 text-[15px] text-ink hover:bg-row">
            <Laptop size={16} className="text-ink-2" />
            <span className="max-w-[420px] truncate">{view === 'chat' ? current?.title ?? project?.name : view[0].toUpperCase() + view.slice(1)}</span>
            <ChevronDown size={15} className="text-mute" />
          </button>
          {current && view === 'chat' && <span className="ml-2 truncate text-[12.5px] text-faint">{project?.name} · {project?.cwd}</span>}
          <div className="no-drag ml-auto flex items-center gap-1 text-ink-2">
            <span className="mr-2 flex items-center gap-1.5 text-[12px] text-mute" title="Motherbrain hero">
              <span className={`h-1.5 w-1.5 rounded-full ${health?.motherbrain.up ? 'bg-ok' : 'bg-bad'}`} />hero
              <span className={`ml-2 h-1.5 w-1.5 rounded-full ${health?.mbTools.up ? 'bg-ok' : 'bg-faint'}`} />tools
            </span>
            <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Open in terminal"><PanelRight size={17} /></button>
            <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Project folder"><FolderOpen size={17} /></button>
            <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Share"><Share size={17} /></button>
            <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="More"><MoreHorizontal size={17} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'tape' ? (
            <TapePanel />
          ) : view === 'artifacts' ? (
            <ArtifactsPanel />
          ) : view === 'customize' ? (
            <EnginesPanel health={health} />
          ) : current && current.messages.length ? (
            <>
              <Transcript
                messages={current.messages}
                onPermission={onPermission}
                onSpawn={onSpawn}
                onOpenSession={(k) => setState({ ...state, selected: k })}
              />
              {nRunning > 0 && <div className="mx-auto max-w-[860px] px-10 pb-6 text-[14px] text-mute">{nRunning} running task{nRunning > 1 ? 's' : ''}</div>}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-2 text-[26px] font-semibold tracking-tight text-ink">Motherbrain Code</div>
              <div className="text-[14px] text-mute">Ask Motherbrain, or open a Claude Code session in {project?.name}.</div>
            </div>
          )}
        </div>

        {view === 'chat' && (
          <Composer
            model={model}
            effort={current?.effort ?? 'medium'}
            mode={current?.mode ?? 'auto'}
            running={!!current && running.has(current.key)}
            health={health}
            onModel={(m) => setPref({ model: m })}
            onEffort={(e: Effort) => setPref({ effort: e })}
            onMode={(m: Mode) => setPref({ mode: m })}
            onSend={onSend}
            onInterrupt={() => current && mb().interrupt(current.key)}
          />
        )}
      </main>
    </div>
  )
}
