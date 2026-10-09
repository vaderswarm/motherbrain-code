import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, FileText, Image as ImageIcon, Mic, MicOff, Paperclip, Plus, Square, X } from 'lucide-react'
import { EFFORTS, MODELS, MODES, type Attachment, type Effort, type HealthReport, type Mode } from '../../shared/types'
import { mb } from '../api'
import { Picker } from './Menu'

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

export function Composer(props: {
  model: string
  effort: Effort
  mode: Mode
  running: boolean
  health?: HealthReport
  platform?: string
  cwd?: string
  onModel: (m: string) => void
  onEffort: (e: Effort) => void
  onMode: (m: Mode) => void
  onSend: (text: string, attachments: Attachment[]) => void
  onInterrupt: () => void
  onNotice: (text: string, tone?: 'info' | 'error') => void
}) {
  const [text, setText] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [drag, setDrag] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 260) + 'px'
  }, [text])
  const model = MODELS.find((m) => m.id === props.model)
  const textOnly = model?.engine === 'motherbrain'
  const send = () => {
    if ((!text.trim() && !atts.length) || props.running) return
    props.onSend(text.trim() ? text : `See the attached file${atts.length > 1 ? 's' : ''}.`, atts)
    setText('')
    setAtts([])
  }
  const add = (more: Attachment[]) => setAtts((cur) => [...cur, ...more.filter((a) => !cur.some((c) => c.path === a.path))])
  const pick = async () => add(await mb().files.pick(props.cwd))
  const dictationOk = props.platform === 'darwin'
  const dictate = async () => {
    ta.current?.focus() // dictation types into the first responder
    const r = await mb().dictation()
    if (!r.ok) props.onNotice(r.reason ?? 'Dictation is not available.', 'error')
  }
  const mbUp = props.health?.motherbrain.up
  return (
    <div className="mx-auto w-full max-w-[920px] px-10 pb-4">
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDrag(false)
          if (e.dataTransfer.files.length) add(await mb().files.describeDropped(e.dataTransfer.files))
        }}
        className={`rounded-2xl border bg-raised px-4 pt-3 pb-2 shadow-[0_4px_24px_rgba(0,0,0,0.25)] focus-within:border-[#4a4a4a] ${
          drag ? 'border-accent' : 'border-line-strong'
        }`}
      >
        {atts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {atts.map((a) => {
              const lost = a.kind === 'image' && textOnly
              return (
                <span
                  key={a.path}
                  title={lost ? `${a.path}\nMotherbrain is text-only: the image is referenced by path, not sent.` : a.path}
                  className={`flex max-w-[260px] items-center gap-1.5 rounded-lg border px-2 py-1 text-[12.5px] ${lost ? 'border-[#5a4a27] text-[#e0c08a]' : 'border-line-strong text-ink-2'} bg-[#232323]`}
                >
                  {a.kind === 'image' ? <ImageIcon size={13} className="shrink-0 text-mute" /> : a.kind === 'text' ? <FileText size={13} className="shrink-0 text-mute" /> : <Paperclip size={13} className="shrink-0 text-mute" />}
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-faint">{kb(a.size)}</span>
                  <button onClick={() => setAtts((cur) => cur.filter((c) => c.path !== a.path))} className="shrink-0 rounded p-0.5 text-mute hover:bg-row hover:text-ink" title="Remove">
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        <textarea
          ref={ta}
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
            if (e.key === 'Escape' && props.running) props.onInterrupt()
          }}
          placeholder={model?.engine === 'motherbrain' ? 'Ask Motherbrain…' : 'Ask Claude Code…'}
          className="selectable block w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />
        <div className="flex justify-end">
          {props.running ? (
            <button onClick={props.onInterrupt} className="rounded-md p-1 text-ink-2 hover:bg-row" title="Interrupt (Esc)"><Square size={15} /></button>
          ) : (
            <button onClick={send} className="rounded-md p-1 text-mute hover:bg-row hover:text-ink" title="Send (Enter)"><CornerDownLeft size={16} /></button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center px-1 text-mute">
        <button onClick={pick} className="rounded-md p-1.5 hover:bg-row hover:text-ink" title={textOnly ? 'Attach files (text is inlined; Motherbrain gets images by path only)' : 'Attach files (text is inlined, images are sent)'}>
          <Plus size={17} />
        </button>
        {dictationOk ? (
          <button onClick={dictate} className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Dictate with macOS dictation (turn it on in System Settings › Keyboard if nothing happens)">
            <Mic size={16} />
          </button>
        ) : (
          <span className="cursor-not-allowed rounded-md p-1.5 opacity-40" title="Dictation is not available: it uses macOS system dictation.">
            <MicOff size={16} />
          </span>
        )}
        <Picker up value={props.mode} items={MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={(v) => props.onMode(v as Mode)} title="Permission mode" />
        <div className="ml-auto flex items-center gap-1">
          <Picker
            up
            align="right"
            chevron={false}
            value={props.model}
            title="Model"
            items={MODELS.map((m) => ({
              id: m.id,
              label: m.label,
              hint: m.engine === 'motherbrain' ? (mbUp ? 'hero · online' : 'hero · offline') : 'Claude Code',
            }))}
            onChange={props.onModel}
          />
          {model?.supportsEffort && (
            <Picker up align="right" chevron={false} value={props.effort} title="Effort" items={EFFORTS.map((e) => ({ id: e, label: e[0].toUpperCase() + e.slice(1) }))} onChange={(v) => props.onEffort(v as Effort)} />
          )}
          <span className={`ml-1 h-3.5 w-3.5 rounded-full border-2 ${props.running ? 'spin border-mute border-t-transparent' : 'border-[#3a3a3a]'}`} />
        </div>
      </div>
    </div>
  )
}
