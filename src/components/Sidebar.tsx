import { useState } from 'react'
import {
  ArrowLeft, ArrowRight, Box, ChevronDown, ChevronRight, Code2, FolderPlus, LayoutGrid, MessageSquareText,
  MoreHorizontal, PanelLeft, Pencil, Plus, Search, SlidersHorizontal, Sparkles, Shapes, Activity, Trash2,
} from 'lucide-react'
import type { AppState, Session } from '../../shared/types'
import { ActionMenu } from './Menu'

export type View = 'chat' | 'artifacts' | 'customize' | 'tape'

export function Sidebar(props: {
  state: AppState
  running: Set<string>
  view: View
  onSelect: (key: string) => void
  onNew: (projectId?: string) => void
  onView: (v: View) => void
  onToggle: () => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onRename: (key: string) => void
  onDelete: (key: string) => void
  onAddProject: () => void
}) {
  const [q, setQ] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const { state } = props
  const match = (s: Session) => !q || s.title.toLowerCase().includes(q.toLowerCase())
  const navRow = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[14.5px] text-ink-2 hover:bg-row hover:text-ink'

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-line bg-side">
      {/* title bar row: traffic lights live in the first 80px */}
      <div className="drag flex h-[58px] items-center pl-[92px] pr-3">
        <div className="no-drag flex items-center gap-1 text-mute">
          <button onClick={props.onToggle} className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Toggle sidebar"><PanelLeft size={17} /></button>
          <button onClick={props.onBack} disabled={!props.canBack} className="rounded-md p-1.5 hover:bg-row hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-mute" title="Back (⌘[)"><ArrowLeft size={17} /></button>
          <button onClick={props.onForward} disabled={!props.canForward} className="rounded-md p-1.5 hover:bg-row hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-mute" title="Forward (⌘])"><ArrowRight size={17} /></button>
        </div>
        <div className="no-drag ml-auto flex items-center rounded-lg bg-[#232323] p-0.5">
          <button className="rounded-md p-1.5 text-mute hover:text-ink" title="Chat"><MessageSquareText size={16} /></button>
          <button className="rounded-md bg-[#353535] p-1.5 text-ink" title="Code"><Code2 size={16} /></button>
        </div>
      </div>

      <div className="px-3">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-[#212121] px-2.5 py-[7px] text-mute focus-within:border-line-strong">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[14.5px] text-ink outline-none placeholder:text-mute"
          />
        </label>
      </div>

      <nav className="mt-3 space-y-0.5 px-2">
        <button className={navRow} onClick={() => props.onNew()}>
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-mute"><Plus size={12} /></span>New
        </button>
        <button className={navRow} onClick={() => props.onView('artifacts')}><Shapes size={17} className="text-mute" />Artifacts</button>
        <button className={navRow} onClick={() => props.onView('customize')}><Box size={17} className="text-mute" />Customize</button>
        <button className={navRow} onClick={() => setMoreOpen((o) => !o)}>
          {moreOpen ? <ChevronDown size={17} className="text-mute" /> : <ChevronRight size={17} className="text-mute" />}More
        </button>
        {moreOpen && (
          <div className="ml-6 space-y-0.5">
            <button className={navRow + (props.view === 'tape' ? ' bg-row text-ink' : '')} onClick={() => props.onView('tape')}>
              <Activity size={16} className="text-mute" />Tape
            </button>
            <button className={navRow} onClick={() => props.onView('customize')}><LayoutGrid size={16} className="text-mute" />Engines</button>
          </div>
        )}
      </nav>

      <div className="mt-5 flex-1 overflow-y-auto px-2 pb-4">
        {state.projects.map((p) => {
          const sessions = state.sessions.filter((s) => s.projectId === p.id && match(s)).sort((a, b) => b.updatedAt - a.updatedAt)
          return (
            <section key={p.id} className="mb-5">
              <div className="group flex items-center px-2.5 pb-1.5 text-[13.5px] text-mute">
                <span className="truncate">{p.name}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => props.onNew(p.id)} className="rounded p-1 hover:bg-row hover:text-ink" title={`New session in ${p.name}`}><Plus size={15} /></button>
                  <button className="rounded p-1 hover:bg-row hover:text-ink" title="Filter"><SlidersHorizontal size={14} /></button>
                </div>
              </div>
              {sessions.length === 0 && <div className="px-2.5 py-1 text-[13px] text-faint">No sessions</div>}
              {sessions.map((s) => {
                const sel = state.selected === s.key && props.view === 'chat'
                const run = props.running.has(s.key)
                const menuOpen = menuFor === s.key
                return (
                  <div
                    key={s.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => props.onSelect(s.key)}
                    onKeyDown={(e) => e.key === 'Enter' && props.onSelect(s.key)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenuFor(s.key)
                    }}
                    className={`group relative flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-left text-[14.5px] outline-none ${
                      sel || menuOpen ? 'bg-row text-ink' : 'text-ink-2 hover:bg-[#222] hover:text-ink'
                    }`}
                  >
                    <span className={`h-[7px] w-[7px] shrink-0 rounded-full border ${run ? 'pulse border-accent bg-accent' : 'border-faint'}`} />
                    <span className="truncate">{s.title}</span>
                    {s.spawnedBy && <Sparkles size={12} className="ml-auto shrink-0 text-accent group-hover:hidden" />}
                    <ActionMenu
                      align="right"
                      width={180}
                      open={menuOpen}
                      onOpenChange={(o) => setMenuFor(o ? s.key : null)}
                      className={`ml-auto shrink-0 ${menuOpen ? '' : 'hidden group-hover:block'}`}
                      trigger={(_o, toggle) => (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle()
                          }}
                          className="-my-1 rounded p-0.5 text-mute hover:bg-[#3a3a3a] hover:text-ink"
                          title="Session actions"
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      )}
                      items={[
                        { id: 'rename', label: 'Rename', icon: <Pencil size={13} />, onSelect: () => props.onRename(s.key) },
                        { id: 'delete', label: 'Delete', icon: <Trash2 size={13} />, danger: true, separator: true, onSelect: () => props.onDelete(s.key) },
                      ]}
                    />
                  </div>
                )
              })}
            </section>
          )
        })}
        <button onClick={props.onAddProject} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13.5px] text-mute hover:bg-[#222] hover:text-ink">
          <FolderPlus size={15} />Add project
        </button>
      </div>

      <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3a3a3a] text-[11px] font-semibold text-ink">
          {state.user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-[14px] text-ink-2">{state.user.name}</span>
        <span className="text-[12.5px] text-faint">· {state.user.plan}</span>
        <ChevronDown size={14} className="text-faint" />
        <Sparkles size={16} className="ml-auto text-mute" />
      </div>
    </aside>
  )
}
