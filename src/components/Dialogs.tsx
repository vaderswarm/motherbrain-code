// Modal dialogs (confirm, rename, add project) and a small toast, in the app's dark style.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { mb } from '../api'

function Modal(props: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const close = useRef(props.onClose)
  close.current = props.onClose
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])
  return (
    <div className="no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onMouseDown={props.onClose}>
      <div
        role="dialog"
        aria-label={props.title}
        style={{ width: props.width ?? 440 }}
        className="rounded-2xl border border-line-strong bg-[#252525] p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center text-[15px] font-semibold text-ink">
          {props.title}
          <button onClick={props.onClose} className="ml-auto rounded-md p-1 text-mute hover:bg-row hover:text-ink" title="Close (Esc)"><X size={15} /></button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

const btn = 'rounded-lg px-3 py-1.5 text-[13px] font-medium'
const primary = `${btn} bg-ink text-[#1a1a1a] hover:bg-white disabled:opacity-40`
const secondary = `${btn} border border-line-strong text-ink-2 hover:bg-row`
const danger = `${btn} bg-[#c9483f] text-white hover:bg-[#d9544b]`
const input = 'selectable w-full rounded-lg border border-line bg-[#1e1e1e] px-3 py-2 text-[14px] text-ink outline-none focus:border-[#4a4a4a] placeholder:text-faint'

export function ConfirmDialog(props: { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => ok.current?.focus(), [])
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="mb-5 text-[13.5px] leading-relaxed text-ink-2">{props.body}</div>
      <div className="flex justify-end gap-2">
        <button className={secondary} onClick={props.onClose}>Cancel</button>
        <button
          ref={ok}
          className={props.danger ? danger : primary}
          onClick={() => {
            props.onConfirm()
            props.onClose()
          }}
        >
          {props.confirm}
        </button>
      </div>
    </Modal>
  )
}

export function RenameDialog(props: { initial: string; onRename: (title: string) => void; onClose: () => void }) {
  const [v, setV] = useState(props.initial)
  const submit = () => {
    if (!v.trim()) return
    props.onRename(v)
    props.onClose()
  }
  return (
    <Modal title="Rename session" onClose={props.onClose}>
      <input
        autoFocus
        className={input}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="mt-5 flex justify-end gap-2">
        <button className={secondary} onClick={props.onClose}>Cancel</button>
        <button className={primary} disabled={!v.trim()} onClick={submit}>Rename</button>
      </div>
    </Modal>
  )
}

export function AddProjectDialog(props: { onAdd: (name: string, cwd: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const pick = async () => {
    const dir = await mb().files.pickFolder(cwd || undefined)
    if (!dir) return
    setCwd(dir)
    if (!name.trim()) setName(dir.split('/').filter(Boolean).pop() ?? '')
  }
  const ok = name.trim() && cwd.trim()
  const submit = () => {
    if (!ok) return
    props.onAdd(name, cwd)
    props.onClose()
  }
  return (
    <Modal title="Add project" onClose={props.onClose}>
      <label className="mb-1 block text-[12.5px] text-mute">Name</label>
      <input autoFocus className={input} value={name} placeholder="e.g. Syndicate" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <label className="mb-1 mt-4 block text-[12.5px] text-mute">Working folder</label>
      <div className="flex gap-2">
        <input className={`${input} font-mono text-[12.5px]`} value={cwd} placeholder="~/path/to/folder" onChange={(e) => setCwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className={`${secondary} flex shrink-0 items-center gap-1.5`} onClick={pick}><FolderOpen size={14} />Choose…</button>
      </div>
      <div className="mt-2 text-[12px] text-faint">Claude Code sessions in this project run with this folder as their working directory.</div>
      <div className="mt-5 flex justify-end gap-2">
        <button className={secondary} onClick={props.onClose}>Cancel</button>
        <button className={primary} disabled={!ok} onClick={submit}>Add project</button>
      </div>
    </Modal>
  )
}

export function Toast(props: { text: string; tone?: 'info' | 'error'; onDone: () => void }) {
  const done = useRef(props.onDone)
  done.current = props.onDone
  useEffect(() => {
    const t = setTimeout(() => done.current(), props.tone === 'error' ? 6000 : 2600)
    return () => clearTimeout(t)
  }, [props.text, props.tone])
  return (
    <div
      role="status"
      className={`no-drag fixed bottom-6 left-1/2 z-[110] max-w-[560px] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-[13px] shadow-2xl ${
        props.tone === 'error' ? 'border-[#5a2a27] bg-[#2a1d1c] text-[#f0a49e]' : 'border-line-strong bg-[#2a2a2a] text-ink-2'
      }`}
    >
      {props.text}
    </div>
  )
}
