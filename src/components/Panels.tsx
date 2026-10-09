import { Activity, Box, Cpu, Shapes } from 'lucide-react'
import type { HealthReport } from '../../shared/types'

function Shell(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[860px] px-10 pt-10">
      <div className="mb-6 flex items-center gap-2.5 text-[20px] font-semibold text-ink">{props.icon}{props.title}</div>
      <div className="space-y-4 text-[14.5px] leading-relaxed text-ink-2">{props.children}</div>
    </div>
  )
}

// Stub: will render the core/tape oracle map and the rule ledger
// (~/vader-swarm/data/kalshi/lab/tape/oracle/*.parquet, rule_ledger.jsonl).
export function TapePanel() {
  return (
    <Shell icon={<Activity size={20} className="text-accent" />} title="Tape">
      <p>The tape room: the hindsight map of every window and the ledger of every rule Motherbrain has tried.</p>
      <div className="rounded-xl border border-dashed border-line-strong p-5 text-mute">
        Not wired yet. Planned views: window replay (Kalshi taker prices, Binance, strike, tau) with oracle entries overlaid ·
        strategy × tau heatmap of net c/ct · rule ledger with attempt counts, walk-forward results and the noise floor.
        Source: <code className="text-coral">~/vader-swarm/data/kalshi/lab/tape/</code>
      </div>
    </Shell>
  )
}

export function ArtifactsPanel() {
  return (
    <Shell icon={<Shapes size={20} className="text-mute" />} title="Artifacts">
      <p className="text-mute">Reports, charts and pages produced by sessions will collect here. Stub.</p>
    </Shell>
  )
}

export function EnginesPanel({ health }: { health?: HealthReport }) {
  const dot = (up?: boolean) => <span className={`inline-block h-2 w-2 rounded-full ${up ? 'bg-ok' : 'bg-bad'}`} />
  return (
    <Shell icon={<Box size={20} className="text-mute" />} title="Engines">
      <div className="rounded-xl border border-line bg-[#212121] divide-y divide-line">
        <div className="flex items-center gap-3 px-4 py-3">
          <Cpu size={16} className="text-mute" />
          <div className="flex-1">
            <div className="text-ink">Motherbrain hero</div>
            <div className="text-[12.5px] text-faint">{health?.motherbrain.models?.[0] ?? 'localhost:8100'}</div>
          </div>
          {dot(health?.motherbrain.up)}<span className="text-[13px]">{health?.motherbrain.up ? 'online' : 'offline'}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Cpu size={16} className="text-mute" />
          <div className="flex-1">
            <div className="text-ink">mb-tools (code_interpreter, read_file, recall_memory)</div>
            <div className="text-[12.5px] text-faint">localhost:8140 · sandboxed as the motherbrain user</div>
          </div>
          {dot(health?.mbTools.up)}<span className="text-[13px]">{health?.mbTools.up ? `${health.mbTools.count} tools` : 'offline'}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Cpu size={16} className="text-mute" />
          <div className="flex-1">
            <div className="text-ink">Claude Code</div>
            <div className="text-[12.5px] text-faint">{health?.claude.path ?? 'claude CLI not found'} · runs on your subscription</div>
          </div>
          {dot(!!health?.claude.version)}<span className="text-[13px]">{health?.claude.version ?? 'missing'}</span>
        </div>
      </div>
    </Shell>
  )
}
