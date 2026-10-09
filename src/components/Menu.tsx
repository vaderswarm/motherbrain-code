import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface MenuItem {
  id: string
  label: string
  hint?: string
  disabled?: boolean
}

// A small popover picker, opening upward or downward, styled like the desktop app's menus.
export function Picker(props: {
  value: string
  items: MenuItem[]
  onChange: (id: string) => void
  label?: ReactNode
  up?: boolean
  align?: 'left' | 'right'
  chevron?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const current = props.items.find((i) => i.id === props.value)
  return (
    <div ref={ref} className="relative no-drag">
      <button
        title={props.title}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-ink-2 hover:bg-row hover:text-ink"
      >
        {props.label ?? current?.label}
        {props.chevron !== false && <ChevronDown size={13} className="text-mute" />}
      </button>
      {open && (
        <div
          className={`absolute z-50 min-w-[200px] rounded-xl border border-line-strong bg-[#252525] p-1 shadow-2xl ${
            props.up ? 'bottom-full mb-2' : 'top-full mt-1'
          } ${props.align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {props.items.map((i) => (
            <button
              key={i.id}
              disabled={i.disabled}
              onClick={() => {
                props.onChange(i.id)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-6 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-row hover:text-ink disabled:opacity-40"
            >
              <span>
                {i.label}
                {i.hint && <span className="ml-2 text-[11.5px] text-faint">{i.hint}</span>}
              </span>
              {i.id === props.value && <Check size={14} className="text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
