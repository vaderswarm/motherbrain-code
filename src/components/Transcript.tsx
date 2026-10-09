import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Check, ChevronDown, ChevronRight, ShieldQuestion, Sparkles, Wrench, X } from 'lucide-react'
import type { Block, Message } from '../../shared/types'

function short(v: unknown, n = 140): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}

function toolSummary(name: string, input: any): string {
  if (!input || typeof input !== 'object') return short(input, 90)
  return short(input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? input.prompt ?? input.code ?? input, 90)
}

function ToolBlock({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const pending = b.result === undefined && b.name !== 'Thinking'
  return (
    <div className="my-2 rounded-lg border border-line bg-[#212121] text-[13px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink-2 hover:text-ink">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} className={b.isError ? 'text-bad' : 'text-mute'} />
        <span className="font-medium">{b.name}</span>
        <span className="truncate font-mono text-[12px] text-faint">{toolSummary(b.name, b.input)}</span>
        {pending && <span className="spin ml-auto h-3 w-3 shrink-0 rounded-full border-2 border-mute border-t-transparent" />}
      </button>
      {open && (
        <div className="selectable border-t border-line px-3 py-2 font-mono text-[12px] text-ink-2">
          <pre className="whitespace-pre-wrap break-words">{typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2)}</pre>
          {b.result !== undefined && (
            <pre className={`mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-line pt-2 ${b.isError ? 'text-bad' : 'text-mute'}`}>{b.result}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function Card(props: { icon: React.ReactNode; title: string; body: React.ReactNode; state: string; onYes?: () => void; onNo?: () => void; yes: string; no: string }) {
  return (
    <div className="my-3 rounded-xl border border-line-strong bg-[#242424] p-3.5 text-[13.5px]">
      <div className="mb-2 flex items-center gap-2 font-medium text-ink">{props.icon}{props.title}</div>
      <div className="selectable mb-3 text-ink-2">{props.body}</div>
      {props.state === 'pending' ? (
        <div className="flex gap-2">
          <button onClick={props.onYes} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-[#1a1a1a] hover:bg-white"><Check size={14} />{props.yes}</button>
          <button onClick={props.onNo} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-ink-2 hover:bg-row"><X size={14} />{props.no}</button>
        </div>
      ) : (
        <div className="text-[12.5px] text-mute">{props.state}</div>
      )}
    </div>
  )
}

export function Transcript(props: {
  messages: Message[]
  onPermission: (id: string, allow: boolean) => void
  onSpawn: (id: string, approve: boolean) => void
  onOpenSession: (key: string) => void
}) {
  return (
    <div className="selectable mx-auto w-full max-w-[860px] px-10 pt-6 pb-10">
      {props.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="my-5 flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[#2f2f2f] px-4 py-2.5 leading-relaxed text-ink">
              {m.blocks.map((b) => (b.kind === 'text' ? b.text : '')).join('')}
            </div>
          </div>
        ) : (
          <div key={i} className="my-4">
            {m.blocks.map((b, j) => {
              switch (b.kind) {
                case 'text':
                  return (
                    <div key={j} className="md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text}</ReactMarkdown>
                    </div>
                  )
                case 'tool':
                  return <ToolBlock key={j} b={b} />
                case 'permission':
                  return (
                    <Card
                      key={j}
                      icon={<ShieldQuestion size={15} className="text-accent" />}
                      title={`Allow ${b.tool}?`}
                      body={<pre className="whitespace-pre-wrap break-words font-mono text-[12px]">{short(b.input, 600)}</pre>}
                      state={b.state === 'pending' ? 'pending' : b.state === 'allowed' ? 'Allowed' : 'Denied'}
                      yes="Allow"
                      no="Deny"
                      onYes={() => props.onPermission(b.id, true)}
                      onNo={() => props.onPermission(b.id, false)}
                    />
                  )
                case 'spawn':
                  return (
                    <Card
                      key={j}
                      icon={<Sparkles size={15} className="text-accent" />}
                      title="Motherbrain wants to open a Claude Code session"
                      body={
                        <>
                          <div className="mb-1 text-[12.5px] text-mute">{b.model} · {b.cwd}</div>
                          <div className="whitespace-pre-wrap">{short(b.prompt, 800)}</div>
                        </>
                      }
                      state={
                        b.state === 'pending' ? 'pending' : b.state === 'approved' ? 'Spawned — open it from the sidebar' : 'Declined'
                      }
                      yes="Spawn session"
                      no="Decline"
                      onYes={() => props.onSpawn(b.id, true)}
                      onNo={() => props.onSpawn(b.id, false)}
                    />
                  )
                case 'error':
                  return (
                    <div key={j} className="my-2 flex items-start gap-2 rounded-lg border border-[#5a2a27] bg-[#2a1d1c] px-3 py-2 text-[13px] text-[#f0a49e]">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />{b.text}
                    </div>
                  )
                case 'meta':
                  return <div key={j} className="my-1 text-[12.5px] text-faint">{b.text}</div>
              }
            })}
          </div>
        ),
      )}
    </div>
  )
}
