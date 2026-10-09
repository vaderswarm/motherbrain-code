import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface Action {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean // a divider above this item
  onSelect: () => void
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open, close])
  return ref
}

// A popover of actions behind any trigger, in the same style as the pickers.
export function ActionMenu(props: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  items: Action[]
  align?: 'left' | 'right'
  up?: boolean
  width?: number
  className?: string
  open?: boolean // controlled (e.g. opened by a right-click elsewhere)
  onOpenChange?: (open: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const open = props.open ?? own
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v
    setOwn(next)
    props.onOpenChange?.(next)
  }
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div ref={ref} className={`relative no-drag ${props.className ?? ''}`}>
      {props.trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          role="menu"
          style={{ minWidth: props.width ?? 220 }}
          className={`absolute z-50 rounded-xl border border-line-strong bg-[#252525] p-1 shadow-2xl ${props.up ? 'bottom-full mb-2' : 'top-full mt-1'} ${
            props.align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {props.items.map((i) => (
            <div key={i.id}>
              {i.separator && <div className="my-1 border-t border-line" />}
              <button
                role="menuitem"
                disabled={i.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  i.onSelect()
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40 ${
                  i.danger ? 'text-[#f0a49e] hover:bg-[#3a2523]' : 'text-ink-2 hover:bg-row hover:text-ink'
                }`}
              >
                {i.icon && <span className="flex w-4 shrink-0 justify-center text-mute">{i.icon}</span>}
                <span className="flex-1 truncate">{i.label}</span>
                {i.hint && <span className="text-[11.5px] text-faint">{i.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
