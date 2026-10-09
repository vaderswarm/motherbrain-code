import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ClipboardCopy, Columns2, Download, FolderOpen, Laptop, MoreHorizontal, PanelRight, Pencil, Share, SquareTerminal, Trash2, X,
} from 'lucide-react'
import type { AppState, Attachment, Effort, EngineEvent, HealthReport, Mode, Session } from '../shared/types'
import { MODELS } from '../shared/types'
import { mb } from './api'
import { applyEvent, setBlock, titleFrom } from './state'
import { addProject, canBack, canForward, deleteSession, emptyNav, navForget, navPush, navStep, newSession, renameSession, type Nav, type Place } from './lib/sessions'
import { exportFileName, transcriptMarkdown } from './lib/transcript'
import { Sidebar, type View } from './components/Sidebar'
import { Transcript } from './components/Transcript'
import { Composer } from './components/Composer'
import { ActionMenu, type Action } from './components/Menu'
import { AddProjectDialog, ConfirmDialog, RenameDialog, Toast } from './components/Dialogs'
import { ArtifactsPanel, EnginesPanel, TapePanel } from './components/Panels'
import { demoState } from './demo'

const newKey = () => crypto.randomUUID()

type Dialog = { kind: 'rename'; key: string } | { kind: 'delete'; key: string } | { kind: 'project' } | null

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [view, setView] = useState<View>('chat')
  const [sidebar, setSidebar] = useState(true)
  const [health, setHealth] = useState<HealthReport>()
  const [demo, setDemo] = useState(false)
  const [platform, setPlatform] = useState<string>()
  const [nav, setNav] = useState<Nav>(emptyNav)
  const [split, setSplit] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<{ text: string; tone?: 'info' | 'error' } | null>(null)
  const stateRef = useRef<AppState | null>(null)
  stateRef.current = state
  const notice = useCallback((text: string, tone?: 'info' | 'error') => setToast({ text, tone }), [])

  // load + persist
  useEffect(() => {
    ;(async () => {
      const info = await mb().info()
      setDemo(info.demo)
      setPlatform(info.platform)
      const st = info.demo ? demoState() : await mb().loadState()
      const v = (info.view as View) ?? 'chat'
      setView(v)
      setState(st)
      setNav(navPush(emptyNav(), { view: v, session: st.selected }))
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
  const splitSession = useMemo(() => (split ? state?.sessions.find((s) => s.key === split) : undefined), [state, split])

  // ---- navigation: every move goes through go(), which records it for back/forward
  const apply = useCallback((p: Place) => {
    setView(p.view as View)
    if (p.view === 'chat') setState((st) => (st ? { ...st, selected: p.session } : st))
  }, [])
  const go = useCallback(
    (p: Place) => {
      apply(p)
      setNav((n) => navPush(n, p))
    },
    [apply],
  )
  const navRef = useRef(nav)
  navRef.current = nav
  const step = useCallback(
    (dir: -1 | 1) => {
      const exists = (k: string) => !!stateRef.current?.sessions.some((s) => s.key === k)
      const r = navStep(navRef.current, dir, exists)
      if (!r.place) return
      apply(r.place)
      setNav(r.nav)
    },
    [apply],
  )
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === '[') step(-1)
      else if (e.key === ']') step(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [step])

  const createSession = useCallback((projectId: string, init: Partial<Session> = {}): Session => {
    const prev = stateRef.current?.sessions.find((s) => s.key === stateRef.current?.selected)
    return newSession(projectId, prev, newKey(), Date.now(), init)
  }, [])

  const onNew = (projectId?: string) => {
    if (!state) return
    const s = createSession(projectId ?? project?.id ?? state.projects[0].id)
    setState({ ...state, sessions: [s, ...state.sessions], selected: s.key })
    go({ view: 'chat', session: s.key })
  }

  const sendIn = useCallback((s: Session, prompt: string, attachments: Attachment[] = []) => {
    const st = stateRef.current
    const cwd = st?.projects.find((p) => p.id === s.projectId)?.cwd ?? '~'
    const history = s.messages
    const user = { role: 'user' as const, blocks: [{ kind: 'text' as const, text: prompt }], ts: Date.now(), ...(attachments.length ? { attachments } : {}) }
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
    mb().send({ sessionKey: s.key, prompt, model: s.model, effort: s.effort, mode: s.mode, cwd, claudeSessionId: s.claudeSessionId, history, attachments })
  }, [])

  const onSend = (text: string, attachments: Attachment[]) => {
    if (!state) return
    let s = current
    if (!s) {
      s = createSession(project?.id ?? state.projects[0].id)
      setState({ ...state, sessions: [s, ...state.sessions], selected: s.key })
      setNav((n) => navPush(n, { view: 'chat', session: s!.key }))
    }
    sendIn(s, text, attachments)
  }

  const onPermission = (key: string, id: string, allow: boolean) => {
    mb().respond(id, allow)
    updateSession(key, (s) => setBlock(s, id, { state: allow ? 'allowed' : 'denied' } as any))
  }

  const onSpawn = (key: string, id: string, approve: boolean) => {
    const parent = state?.sessions.find((s) => s.key === key)
    if (!parent || !state) return
    const block = parent.messages.flatMap((m) => m.blocks).find((b) => b.kind === 'spawn' && b.id === id)
    if (!block || block.kind !== 'spawn') return
    if (!approve) {
      mb().respond(id, { approved: false })
      updateSession(key, (s) => setBlock(s, id, { state: 'declined' } as any))
      return
    }
    // The spawned session lives in the project whose cwd matches, else the parent's project.
    const proj = state.projects.find((p) => p.cwd === block.cwd) ?? state.projects.find((p) => p.id === parent.projectId)
    const child = createSession(proj?.id ?? parent.projectId, {
      model: MODELS.some((m) => m.id === block.model && m.engine === 'claude') ? block.model : 'claude-opus-5-5',
      spawnedBy: key,
    })
    setState((cur) => (cur ? { ...cur, sessions: [child, ...cur.sessions] } : cur))
    updateSession(key, (s) => setBlock(s, id, { state: 'approved', sessionKey: child.key } as any))
    mb().respond(id, { approved: true, sessionKey: child.key })
    sendIn({ ...child }, block.prompt)
  }

  const setPref = (patch: Partial<Pick<Session, 'model' | 'effort' | 'mode'>>) => {
    if (current) updateSession(current.key, (s) => ({ ...s, ...patch }))
  }

  // ---- session actions (sidebar menu, header menu)
  const doDelete = (key: string) => {
    if (running.has(key)) mb().interrupt(key)
    setState((st) => (st ? deleteSession(st, key) : st))
    setNav((n) => navForget(n, key))
    if (split === key) setSplit(null)
  }
  const exportMd = async (s: Session) => {
    const proj = state?.projects.find((p) => p.id === s.projectId)
    const path = await mb().files.exportMarkdown(exportFileName(s), transcriptMarkdown(s, proj), proj?.cwd)
    if (path) notice(`Saved ${path}`)
  }
  const copyMd = async (s: Session) => {
    await mb().files.copy(transcriptMarkdown(s, state?.projects.find((p) => p.id === s.projectId)))
    notice('Transcript copied as Markdown')
  }
  const openFolder = async () => {
    if (!project) return
    const err = await mb().files.openFolder(project.cwd)
    if (err) notice(err, 'error')
  }
  const openTerminal = async () => {
    if (!project) return
    const err = await mb().files.openTerminal(project.cwd)
    if (err) notice(err, 'error')
  }
  const toggleSplit = () => {
    if (split) return setSplit(null)
    if (!state) return
    // the place you came from, else the most recent other session
    const back = [...nav.stack.slice(0, nav.index)].reverse().find((p) => p.view === 'chat' && p.session && p.session !== current?.key && state.sessions.some((s) => s.key === p.session))
    const other = back?.session ?? [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt).find((s) => s.key !== current?.key)?.key
    if (!other) return notice('Split view needs a second session.')
    setSplit(other)
  }

  const sessionActions = (s: Session | undefined): Action[] => [
    ...(s
      ? [
          { id: 'rename', label: 'Rename…', icon: <Pencil size={13} />, onSelect: () => setDialog({ kind: 'rename', key: s.key }) },
          { id: 'copy', label: 'Copy as Markdown', icon: <ClipboardCopy size={13} />, disabled: !s.messages.length, onSelect: () => copyMd(s) },
          { id: 'export', label: 'Export Markdown…', icon: <Download size={13} />, disabled: !s.messages.length, onSelect: () => exportMd(s) },
        ]
      : []),
    ...(s?.claudeSessionId
      ? [{ id: 'resume', label: 'Copy resume command', hint: 'claude --resume', icon: <ClipboardCopy size={13} />, onSelect: async () => { await mb().files.copy(`claude --resume ${s.claudeSessionId}`); notice('Resume command copied') } }]
      : []),
    { id: 'split', label: split ? 'Close split view' : 'Split view', icon: <Columns2 size={13} />, separator: !!s, onSelect: toggleSplit },
    { id: 'folder', label: 'Open project folder', icon: <FolderOpen size={13} />, disabled: !project, onSelect: openFolder },
    { id: 'terminal', label: 'Open in Terminal', icon: <SquareTerminal size={13} />, disabled: !project || platform !== 'darwin', onSelect: openTerminal },
    ...(s ? [{ id: 'delete', label: 'Delete session…', icon: <Trash2 size={13} />, danger: true, separator: true, onSelect: () => setDialog({ kind: 'delete', key: s.key }) }] : []),
  ]

  if (!state) return <div className="h-full bg-app" />

  const nRunning = running.size
  const model = current?.model ?? 'claude-opus-5-5'
  const dialogSession = dialog && 'key' in dialog ? state.sessions.find((s) => s.key === dialog.key) : undefined
  const iconBtn = 'rounded-md p-1.5 hover:bg-row hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent'

  const transcriptOf = (s: Session) => (
    <Transcript
      messages={s.messages}
      onPermission={(id, allow) => onPermission(s.key, id, allow)}
      onSpawn={(id, ok) => onSpawn(s.key, id, ok)}
      onOpenSession={(k) => go({ view: 'chat', session: k })}
    />
  )

  return (
    <div className="flex h-full">
      {sidebar && (
        <Sidebar
          state={state}
          running={running}
          view={view}
          onSelect={(k) => go({ view: 'chat', session: k })}
          onNew={onNew}
          onView={(v) => go({ view: v, session: v === 'chat' ? state.selected : undefined })}
          onToggle={() => setSidebar(false)}
          canBack={canBack(nav)}
          canForward={canForward(nav)}
          onBack={() => step(-1)}
          onForward={() => step(1)}
          onRename={(key) => setDialog({ kind: 'rename', key })}
          onDelete={(key) => setDialog({ kind: 'delete', key })}
          onAddProject={() => setDialog({ kind: 'project' })}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col bg-app">
        <header className="drag flex h-[58px] shrink-0 items-center px-5" style={{ paddingLeft: sidebar ? 20 : 96 }}>
          {!sidebar && (
            <button className="no-drag mr-3 rounded-md p-1.5 text-mute hover:bg-row hover:text-ink" onClick={() => setSidebar(true)} title="Show sidebar">
              <PanelRight size={17} />
            </button>
          )}
          {view === 'chat' && current ? (
            <ActionMenu
              items={sessionActions(current)}
              trigger={(_o, toggle) => (
                <button onClick={toggle} className="no-drag flex items-center gap-2 rounded-md px-1.5 py-1 text-[15px] text-ink hover:bg-row">
                  <Laptop size={16} className="text-ink-2" />
                  <span className="max-w-[420px] truncate">{current.title}</span>
                  <ChevronDown size={15} className="text-mute" />
                </button>
              )}
            />
          ) : (
            <div className="flex items-center gap-2 px-1.5 py-1 text-[15px] text-ink">
              <Laptop size={16} className="text-ink-2" />
              <span className="max-w-[420px] truncate">{view === 'chat' ? project?.name : view[0].toUpperCase() + view.slice(1)}</span>
            </div>
          )}
          {current && view === 'chat' && <span className="ml-2 truncate text-[12.5px] text-faint">{project?.name} · {project?.cwd}</span>}
          <div className="no-drag ml-auto flex items-center gap-1 text-ink-2">
            <span className="mr-2 flex items-center gap-1.5 text-[12px] text-mute" title="Motherbrain hero">
              <span className={`h-1.5 w-1.5 rounded-full ${health?.motherbrain.up ? 'bg-ok' : 'bg-bad'}`} />hero
              <span className={`ml-2 h-1.5 w-1.5 rounded-full ${health?.mbTools.up ? 'bg-ok' : 'bg-faint'}`} />tools
            </span>
            <button className={`${iconBtn} ${split ? 'bg-row text-ink' : ''}`} onClick={toggleSplit} disabled={view !== 'chat'} title={split ? 'Close split view' : 'Split view'}>
              <PanelRight size={17} />
            </button>
            <button className={iconBtn} onClick={openFolder} disabled={!project} title={project ? `Open ${project.cwd}` : 'Project folder'}><FolderOpen size={17} /></button>
            <button className={iconBtn} onClick={() => current && exportMd(current)} disabled={!current?.messages.length || view !== 'chat'} title="Share: export transcript as Markdown">
              <Share size={17} />
            </button>
            <ActionMenu
              align="right"
              items={sessionActions(view === 'chat' ? current : undefined)}
              trigger={(open, toggle) => (
                <button className={`${iconBtn} ${open ? 'bg-row text-ink' : ''}`} onClick={toggle} title="More"><MoreHorizontal size={17} /></button>
              )}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {view === 'tape' ? (
                <TapePanel />
              ) : view === 'artifacts' ? (
                <ArtifactsPanel />
              ) : view === 'customize' ? (
                <EnginesPanel health={health} />
              ) : current && current.messages.length ? (
                <>
                  {transcriptOf(current)}
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
                platform={platform}
                cwd={project?.cwd}
                onModel={(m) => setPref({ model: m })}
                onEffort={(e: Effort) => setPref({ effort: e })}
                onMode={(m: Mode) => setPref({ mode: m })}
                onSend={onSend}
                onInterrupt={() => current && mb().interrupt(current.key)}
                onNotice={notice}
              />
            )}
          </div>

          {view === 'chat' && splitSession && (
            <section className="flex w-[46%] min-w-[360px] shrink-0 flex-col border-l border-line bg-app">
              <div className="flex h-[40px] shrink-0 items-center gap-2 border-b border-line px-3 text-[13px]">
                <select
                  value={splitSession.key}
                  onChange={(e) => setSplit(e.target.value)}
                  className="no-drag min-w-0 flex-1 truncate rounded-lg border border-line bg-raised px-2 py-1 text-[13px] text-ink outline-none hover:border-line-strong"
                  title="Session in the split pane"
                >
                  {[...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((s) => (
                    <option key={s.key} value={s.key}>
                      {state.projects.find((p) => p.id === s.projectId)?.name} · {s.title}
                    </option>
                  ))}
                </select>
                {running.has(splitSession.key) && <span className="pulse h-[7px] w-[7px] rounded-full bg-accent" title="Running" />}
                <button
                  className="rounded-md px-2 py-1 text-mute hover:bg-row hover:text-ink"
                  onClick={() => {
                    const k = splitSession.key
                    setSplit(current?.key ?? null)
                    go({ view: 'chat', session: k })
                  }}
                  title="Swap panes: make this the main session"
                >
                  Swap
                </button>
                <button className="rounded-md p-1 text-mute hover:bg-row hover:text-ink" onClick={() => setSplit(null)} title="Close split view"><X size={15} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {splitSession.messages.length ? transcriptOf(splitSession) : <div className="p-8 text-center text-[13.5px] text-mute">No messages yet.</div>}
              </div>
            </section>
          )}
        </div>
      </main>

      {dialog?.kind === 'rename' && dialogSession && (
        <RenameDialog initial={dialogSession.title} onRename={(t) => setState((st) => (st ? renameSession(st, dialogSession.key, t) : st))} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && dialogSession && (
        <ConfirmDialog
          title="Delete session?"
          danger
          confirm="Delete"
          body={
            <>
              <span className="text-ink">{dialogSession.title}</span> and its transcript will be removed from Motherbrain Code.
              {running.has(dialogSession.key) && ' It is running and will be interrupted.'}
              {dialogSession.claudeSessionId && ' The Claude Code session itself stays in ~/.claude/projects and can still be resumed from the terminal.'}
            </>
          }
          onConfirm={() => doDelete(dialogSession.key)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'project' && (
        <AddProjectDialog
          onAdd={(name, cwd) => {
            try {
              const r = addProject(state, name, cwd)
              const s = createSession(r.project.id)
              setState({ ...r.state, sessions: [s, ...r.state.sessions], selected: s.key })
              go({ view: 'chat', session: s.key })
            } catch (e: any) {
              notice(String(e?.message ?? e), 'error')
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {toast && <Toast text={toast.text} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  )
}
