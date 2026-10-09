import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Mic, Plus, Square } from 'lucide-react'
import { EFFORTS, MODELS, MODES, type Effort, type HealthReport, type Mode } from '../../shared/types'
import { Picker } from './Menu'

export function Composer(props: {
  model: string
  effort: Effort
  mode: Mode
  running: boolean
  health?: HealthReport
  onModel: (m: string) => void
  onEffort: (e: Effort) => void
  onMode: (m: Mode) => void
  onSend: (text: string) => void
  onInterrupt: () => void
}) {
  const [text, setText] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 260) + 'px'
  }, [text])
  const model = MODELS.find((m) => m.id === props.model)
  const send = () => {
    if (!text.trim() || props.running) return
    props.onSend(text)
    setText('')
  }
  const mbUp = props.health?.motherbrain.up
  return (
    <div className="mx-auto w-full max-w-[920px] px-10 pb-4">
      <div className="rounded-2xl border border-line-strong bg-raised px-4 pt-3 pb-2 shadow-[0_4px_24px_rgba(0,0,0,0.25)] focus-within:border-[#4a4a4a]">
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
        <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Attach"><Plus size={17} /></button>
        <button className="rounded-md p-1.5 hover:bg-row hover:text-ink" title="Dictate"><Mic size={16} /></button>
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
