// The Tape panel: core/tape outputs, read-only. Three views:
//  Replay    — one window: Kalshi taker prices (cents) and Binance/index vs strike (USD) as two charts on a shared tau
//              axis (never a dual axis), with the hindsight strip for one strategy under them (net c/ct per entry second).
//  Hindsight — share of entries net-positive and mean c/ct by strategy × tau bucket over a day range.
//  Ledger    — every scored attempt in rule_ledger.jsonl, newest first, refreshed while open.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { mb } from '../api'
import { toSecondGrid } from '../lib/downsample'

// dataviz reference palette, dark steps (validated on #1e1e1e: all checks pass)
const C = { s1: '#3987e5', s2: '#d95926', ref: '#8f8d89', grid: '#2e2e2e', axis: '#8f8d89', neg: [230, 103, 103], pos: [57, 135, 229], mid: [56, 56, 53] }
const AXIS_W = 64

type Tab = 'replay' | 'hindsight' | 'ledger'
type Asset = 'BTC' | 'ETH'
const ASSETS: Asset[] = ['BTC', 'ETH']
const W = 900 // seconds in a window; x = 900 − τ

// A rule's entry in the current window, on the chart's x (seconds since the open).
interface Marker { x: number; side: 'yes' | 'no' }
const sideColor = (side: string) => (side === 'no' ? C.s2 : C.s1)

// Prices are step functions (a value holds until the next print), so every series is drawn stepped.
const stepped = uPlot.paths.stepped!({ align: 1 })

// Vertical entry markers on a uPlot chart.
function markerPlugin(markers: Marker[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        if (!markers.length) return
        const g = u.ctx
        const { top, height } = u.bbox
        const dpr = devicePixelRatio
        g.save()
        g.lineWidth = 1.5 * dpr
        g.font = `${10.5 * dpr}px system-ui, -apple-system, sans-serif`
        for (const m of markers) {
          const px = Math.round(u.valToPos(m.x, 'x', true))
          g.strokeStyle = g.fillStyle = sideColor(m.side)
          g.setLineDash([5 * dpr, 3 * dpr])
          g.beginPath()
          g.moveTo(px, top)
          g.lineTo(px, top + height)
          g.stroke()
          g.fillText(m.side.toUpperCase(), px + 4 * dpr, top + 11 * dpr)
        }
        g.restore()
      },
    },
  }
}

const ct = (epoch: number) =>
  new Date(epoch * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
const f2 = (v: unknown, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—')
const signed = (v: unknown, d = 2) => (typeof v === 'number' && isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(d) : '—')

function Select(props: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; width?: number }) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ width: props.width }}
      className="no-drag rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[13px] text-ink outline-none hover:border-line-strong"
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function ErrorBox({ error }: { error?: string }) {
  if (!error) return null
  return <div className="selectable whitespace-pre-wrap rounded-lg border border-[#5a2a28] bg-[#2a1d1c] p-3 font-mono text-[12px] text-[#e8a39f]">{error}</div>
}

// diverging colour for c/ct, clipped at ±lim
function divColor(v: number | null, lim = 15): string {
  if (v === null || !isFinite(v)) return 'rgba(0,0,0,0)'
  const t = Math.max(-1, Math.min(1, v / lim))
  const end = t >= 0 ? C.pos : C.neg
  const a = Math.abs(t)
  const mix = C.mid.map((m, i) => Math.round(m + (end[i] - m) * a))
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`
}

// ---------------------------------------------------------------- charts
function useUPlot(opts: () => Omit<uPlot.Options, "width"> | null, data: uPlot.AlignedData | null, deps: unknown[], onReady?: (u: uPlot) => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const o = opts()
    if (!ref.current || !o || !data) return
    const u = new uPlot({ ...o, width: ref.current.clientWidth } as uPlot.Options, data, ref.current)
    onReady?.(u)
    const ro = new ResizeObserver(() => {
      if (ref.current) {
        u.setSize({ width: ref.current.clientWidth, height: o.height })
        onReady?.(u)
      }
    })
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      u.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

const xAxis = (show: boolean): uPlot.Axis => ({
  stroke: C.axis,
  grid: { stroke: C.grid, width: 1 },
  ticks: { stroke: C.grid, width: 1 },
  values: (_u, vals) => vals.map((v) => `τ ${900 - v}`),
  size: show ? 30 : 0,
  show,
  font: '11px system-ui, -apple-system, Helvetica Neue, sans-serif',
})
const yAxis = (fmt: (v: number) => string): uPlot.Axis => ({
  stroke: C.axis,
  grid: { stroke: C.grid, width: 1 },
  ticks: { stroke: C.grid, width: 1 },
  values: (_u, vals) => vals.map(fmt),
  size: AXIS_W,
  font: '11px system-ui, -apple-system, Helvetica Neue, sans-serif',
})

function Replay({ asset }: { asset: Asset }) {
  const [days, setDays] = useState<string[]>([])
  const [strategies, setStrategies] = useState<string[]>([])
  const [day, setDay] = useState('')
  const [wins, setWins] = useState<any[]>([])
  const [ticker, setTicker] = useState('')
  const [strategy, setStrategy] = useState('scalp_tp4_sl6')
  const [w, setW] = useState<any>(null)
  const [err, setErr] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [plot, setPlot] = useState<{ left: number; width: number }>({ left: AXIS_W, width: 0 })
  const [rules, setRules] = useState<any[]>([])
  const [rule, setRule] = useState('')
  const [entries, setEntries] = useState<{ s: number; side: 'yes' | 'no' }[]>([])
  const [ruleNote, setRuleNote] = useState<string>()

  // ledger rules for this asset (rows without an asset field are BTC, the only asset before ETH)
  useEffect(() => {
    mb().tape.ledger().then((r) => setRules((r.rows ?? []).filter((x: any) => (x.asset ?? 'BTC') === asset)))
  }, [asset])
  const ruleKey = (r: any, i: number) => String(r.attempt_global ?? `i${i}`)
  const ruleRow = rules.find((r, i) => ruleKey(r, i) === rule)

  useEffect(() => {
    mb().tape.days(asset).then((r) => {
      if (r.error) return setErr(r.error)
      setDays(r.days)
      setStrategies(r.strategies)
      const recent = [...r.days].reverse().find((d: string) => d >= '2026-09-28') ?? r.days[r.days.length - 1]
      setDay(recent)
    })
  }, [])
  useEffect(() => {
    if (!day) return
    mb().tape.windows(day, asset).then((r) => {
      if (r.error) return setErr(r.error)
      setWins(r.windows)
      setTicker((t) => (r.windows.some((x: any) => x.ticker === t) ? t : r.windows[Math.floor(r.windows.length / 2)]?.ticker ?? ''))
    })
  }, [day, asset])
  useEffect(() => {
    if (!ticker || !day) return
    setLoading(true)
    mb().tape.window(ticker, day, strategy, asset).then((r) => {
      setLoading(false)
      if (r.error) return setErr(r.error)
      setErr(undefined)
      setW(r)
    })
  }, [ticker, day, strategy, asset])

  // the selected rule's entries in this window
  useEffect(() => {
    setEntries([])
    setRuleNote(undefined)
    if (!ruleRow || !ticker || !day) return
    let live = true
    mb().tape.entries(ticker, day, asset, ruleRow).then((r) => {
      if (!live) return
      if (r.error) return setRuleNote(r.error)
      setEntries(r.entries ?? [])
      setRuleNote(r.note)
    })
    return () => {
      live = false
    }
  }, [ruleRow, ticker, day, asset])

  // Every series on a 1-s grid over the whole window: each price change kept, holes held as steps
  // (see lib/downsample.ts). Never thinner than one point per second.
  const grid = useMemo(() => {
    if (!w) return null
    const xs = w.tau.map((t: number) => W - t)
    const c = (v: number | null) => (v === null ? null : v * 100)
    return toSecondGrid(xs, [w.yes_px.map(c), w.no_px.map(c), w.mid.map(c), w.bn, w.idx], 0, W - 1)
  }, [w])
  const pxData = useMemo(() => (grid ? ([grid.x, grid.ys[0], grid.ys[1], grid.ys[2]] as uPlot.AlignedData) : null), [grid])
  const spData = useMemo(() => (grid && w ? ([grid.x, grid.ys[3], grid.ys[4], grid.x.map(() => w.K)] as uPlot.AlignedData) : null), [grid, w])
  const markers = useMemo<Marker[]>(() => {
    if (!w) return []
    return entries.flatMap((e) => {
      const i = w.s.indexOf(e.s)
      return i < 0 ? [] : [{ x: W - w.tau[i], side: e.side }]
    })
  }, [entries, w])

  const pxRef = useUPlot(
    () => ({
      height: 260,
      padding: [8, 18, 10, 0],
      scales: { x: { time: false, range: [0, 899] }, y: { range: [0, 100] } },
      axes: [xAxis(false), yAxis((v) => `${v}¢`)],
      cursor: { sync: { key: 'tape' }, points: { size: 8 } },
      legend: { live: true },
      plugins: [markerPlugin(markers)],
      series: [
        { label: 'τ', value: (_u, v) => (v == null ? '—' : `${900 - v} s`) },
        { label: 'YES taker', stroke: C.s1, width: 2, paths: stepped, value: (_u, v) => (v == null ? '—' : `${v.toFixed(0)}¢`) },
        { label: 'NO taker', stroke: C.s2, width: 2, paths: stepped, value: (_u, v) => (v == null ? '—' : `${v.toFixed(0)}¢`) },
        { label: 'mid', stroke: C.ref, width: 1, dash: [4, 4], paths: stepped, value: (_u, v) => (v == null ? '—' : `${v.toFixed(1)}¢`) },
      ],
    }),
    pxData,
    [pxData, markers],
    (u) => setPlot({ left: u.bbox.left / devicePixelRatio, width: u.bbox.width / devicePixelRatio }),
  )
  const spRef = useUPlot(
    () => ({
      height: 180,
      padding: [8, 18, 0, 0],
      scales: { x: { time: false, range: [0, 899] } },
      axes: [xAxis(true), yAxis((v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }))],
      cursor: { sync: { key: 'tape' }, points: { size: 8 } },
      legend: { live: true },
      plugins: [markerPlugin(markers)],
      series: [
        { label: 'τ', value: (_u, v) => (v == null ? '—' : `${900 - v} s`) },
        { label: 'Binance spot', stroke: C.s1, width: 1.5, paths: stepped, value: (_u, v) => (v == null ? '—' : v.toFixed(2)) },
        { label: asset === 'ETH' ? 'index (ETH RTI)' : 'index (BRTI)', stroke: C.s2, width: 1.5, paths: stepped, value: (_u, v) => (v == null ? '—' : v.toFixed(2)) },
        { label: 'strike K', stroke: C.ref, width: 1, dash: [6, 4], value: (_u, v) => (v == null ? '—' : v.toFixed(2)) },
      ],
    }),
    spData,
    [spData, markers],
  )

  // hindsight strip
  const strip = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = strip.current
    if (!cv || !w || !plot.width) return
    const dpr = devicePixelRatio
    const H = 44
    cv.width = Math.round(plot.width * dpr)
    cv.height = H * dpr
    cv.style.width = `${plot.width}px`
    cv.style.height = `${H}px`
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, cv.width, cv.height)
    const n = 900
    const bw = cv.width / n
    ;(['yes', 'no'] as const).forEach((side, row) => {
      const vals: (number | null)[] = w.strip[side]
      vals.forEach((v, i) => {
        g.fillStyle = divColor(v)
        g.fillRect(Math.floor((900 - w.tau[i]) * bw), row * (H / 2) * dpr + (row ? 1 * dpr : 0), Math.ceil(bw), (H / 2 - 1) * dpr)
      })
    })
    // the selected rule's entries: an outlined cell in that side's row
    g.lineWidth = 1.5 * dpr
    g.strokeStyle = '#ecebe8'
    for (const m of markers) {
      const row = m.side === 'no' ? 1 : 0
      const cw = Math.max(4 * dpr, Math.ceil(bw))
      const x0 = Math.floor(m.x * bw) - (cw - Math.ceil(bw)) / 2
      g.strokeRect(x0 + 0.75 * dpr, row * (H / 2) * dpr + 0.75 * dpr, cw - 1.5 * dpr, (H / 2 - 1) * dpr - 1.5 * dpr)
    }
  }, [w, plot, markers])

  const idx = wins.findIndex((x) => x.ticker === ticker)
  const step = (d: number) => {
    const n = wins[idx + d]
    if (n) setTicker(n.ticker)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={day} onChange={setDay} options={days.map((d) => ({ value: d, label: d }))} />
        <button onClick={() => step(-1)} disabled={idx <= 0} className="no-drag rounded-md p-1.5 text-mute hover:bg-row hover:text-ink disabled:opacity-30"><ChevronLeft size={16} /></button>
        <Select
          value={ticker}
          onChange={setTicker}
          width={290}
          options={wins.map((x) => ({ value: x.ticker, label: `${ct(x.close_ts - 900)}–${ct(x.close_ts)} CT · ${x.outcome_yes === 1 ? 'YES' : 'NO'}${x.feed_ok ? '' : ' · feed ✕'}` }))}
        />
        <button onClick={() => step(1)} disabled={idx < 0 || idx >= wins.length - 1} className="no-drag rounded-md p-1.5 text-mute hover:bg-row hover:text-ink disabled:opacity-30"><ChevronRight size={16} /></button>
        <Select value={strategy} onChange={setStrategy} options={strategies.map((s) => ({ value: s, label: s }))} />
        <Select
          value={rule}
          onChange={(v) => {
            setRule(v)
            const r = rules.find((x, i) => ruleKey(x, i) === v)
            if (r?.strategy && strategies.includes(r.strategy)) setStrategy(r.strategy)
          }}
          width={240}
          options={[{ value: '', label: rules.length ? 'Mark a ledger rule…' : 'No ledger rules' }, ...rules.map((r, i) => ({ value: ruleKey(r, i), label: `#${r.attempt_global ?? '?'} ${r.rule}` }))]}
        />
        {loading && <RefreshCw size={14} className="animate-spin text-mute" />}
      </div>
      <ErrorBox error={err} />
      {ruleRow && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-mute">
          <span>
            <span className="font-mono text-ink-2">{ruleRow.rule}</span> in this window:{' '}
            {entries.length ? (
              entries.map((e, i) => {
                const k = w ? w.s.indexOf(e.s) : -1
                return (
                  <span key={i} className="mr-2" style={{ color: sideColor(e.side) }}>
                    {e.side.toUpperCase()} at τ {k >= 0 ? w.tau[k] : '?'}
                  </span>
                )
              })
            ) : (
              <span>no entries</span>
            )}
          </span>
          {ruleNote && <span className="text-faint">{ruleNote}</span>}
        </div>
      )}
      {w && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
            <span className="text-ink">{w.ticker}</span>
            <span>strike <span className="text-ink">{f2(w.K)}</span></span>
            <span>settled <span className={`font-semibold ${w.outcome_yes === 1 ? 'text-[#86b6ef]' : 'text-[#ec835a]'}`}>{w.outcome_yes === 1 ? 'YES' : 'NO'}</span></span>
            <span>feed {w.feed_ok ? <span className="text-ok">ok</span> : <span className="text-bad">failed gate</span>}</span>
            <span>{strategy}: entries net&nbsp;&gt;&nbsp;0 — YES {f2(100 * (w.share_pos?.yes ?? NaN), 0)}% · NO {f2(100 * (w.share_pos?.no ?? NaN), 0)}%</span>
          </div>
          <div className="rounded-xl border border-line bg-[#1a1a19] p-3">
            <div className="mb-1 text-[12px] font-medium text-mute">Kalshi taker prices (¢) — what each side costs to take</div>
            <div ref={pxRef} className="tape-plot" />
            <div className="mb-1 mt-3 text-[12px] font-medium text-mute">Binance spot and the settlement index vs the strike (USD)</div>
            <div ref={spRef} className="tape-plot" />
            <div className="mt-3 text-[12px] font-medium text-mute">Hindsight map — net c/ct of entering at that second under {strategy} (fees in)</div>
            <div className="relative mt-1 flex items-center" style={{ paddingLeft: plot.left }}>
              <div className="absolute flex h-[44px] flex-col justify-around text-[11px] text-mute" style={{ left: plot.left - 34 }}>
                <span>YES</span>
                <span>NO</span>
              </div>
              <canvas ref={strip} />
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-mute" style={{ paddingLeft: plot.left }}>
              <span>−15¢</span>
              <div className="h-2 w-40 rounded-sm" style={{ background: `linear-gradient(90deg, ${divColor(-15)}, ${divColor(0)}, ${divColor(15)})` }} />
              <span>+15¢</span>
              <span className="ml-3">settles at close (τ 0): {w.outcome_yes === 1 ? 'YES pays 100¢' : 'NO pays 100¢'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- hindsight summary
function Hindsight({ asset }: { asset: Asset }) {
  const [days, setDays] = useState<string[]>([])
  const [d0, setD0] = useState('')
  const [d1, setD1] = useState('')
  const [r, setR] = useState<any>(null)
  const [err, setErr] = useState<string>()
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    mb().tape.days(asset).then((x) => {
      if (x.error) return setErr(x.error)
      setDays(x.days)
      setD0(x.days.find((d: string) => d >= '2026-09-28') ?? x.days[0])
      setD1(x.days[x.days.length - 1])
    })
  }, [asset])
  useEffect(() => {
    if (!d0 || !d1) return
    setLoading(true)
    mb().tape.summary(d0, d1, asset).then((x) => {
      setLoading(false)
      if (x.error) return setErr(x.error)
      setErr(undefined)
      setR(x)
    })
  }, [d0, d1, asset])
  const buckets: string[] = r ? [...r.buckets].reverse() : []
  const rows: any[] = r ? [...r.rows].sort((a, b) => (a.strategy === 'best' ? -1 : b.strategy === 'best' ? 1 : 0)) : []
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[13px] text-mute">
        <span>from</span>
        <Select value={d0} onChange={setD0} options={days.map((d) => ({ value: d, label: d }))} />
        <span>to</span>
        <Select value={d1} onChange={setD1} options={days.map((d) => ({ value: d, label: d }))} />
        {loading && <RefreshCw size={14} className="animate-spin" />}
        {r && <span>{r.days.length} days</span>}
      </div>
      <ErrorBox error={err} />
      {r && (
        <>
          <p className="text-[13px] text-mute">
            Each cell: share of entries (every second, both sides) that finished net&nbsp;&gt;&nbsp;0 after both fees, and the mean net c/ct. Columns run from
            the open (τ 900) to the close. <span className="text-ink-2">best</span> is the hindsight-best strategy per entry: the ceiling a perfect selector could reach,
            not something tradeable.
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#212121] text-mute">
                  <th className="px-3 py-2 text-left font-medium">strategy</th>
                  {buckets.map((b) => (
                    <th key={b} className="px-2 py-2 text-right font-medium">τ {b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.strategy} className={`border-t border-line ${row.strategy === 'best' ? 'bg-[#232323]' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{row.strategy}</td>
                    {buckets.map((b) => {
                      const c = row.cells[b]
                      return (
                        <td key={b} className="px-2 py-1.5 text-right tabular-nums" title={c ? `${c.n.toLocaleString()} entries` : ''}>
                          {c ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-mute">{(100 * c.share).toFixed(0)}%</span>
                              <span className="inline-block min-w-[52px] rounded px-1.5 py-0.5 text-ink" style={{ background: divColor(c.cpct, 5) }}>{signed(c.cpct)}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- rule ledger
function verdictOf(r: any): { label: string; good: boolean } {
  if (typeof r.verdict === 'string') return { label: r.verdict, good: /pass|keep|survive/i.test(r.verdict) }
  const tr = r.train?.cpct, te = r.test?.cpct
  if (typeof tr === 'number' && typeof te === 'number') return tr > 0 && te > 0 ? { label: 'positive', good: true } : { label: 'negative', good: false }
  return { label: '—', good: false }
}

function Ledger() {
  const [rows, setRows] = useState<any[]>([])
  const [mtime, setMtime] = useState(0)
  const [err, setErr] = useState<string>()
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    let last = -1
    const poll = () =>
      mb().tape.ledger().then((r) => {
        if (r.error) setErr(r.error)
        if (r.mtime !== last) {
          last = r.mtime
          setRows(r.rows)
          setMtime(r.mtime)
        }
      })
    poll()
    const t = setInterval(poll, 4000)
    return () => clearInterval(t)
  }, [])
  const lat = (r: any, d: string) => r.latency?.[d]?.cpct
  return (
    <div className="space-y-3">
      <div className="text-[13px] text-mute">
        {rows.length} attempts in <code className="text-coral">rule_ledger.jsonl</code> · updated {mtime ? new Date(mtime).toLocaleTimeString('en-US', { timeZone: 'America/Chicago' }) + ' CT' : '—'} · refreshes
        every 4 s. Every attempt counts against the next result.
      </div>
      <ErrorBox error={err} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#212121] text-left text-mute">
              {['#', 'time CT', 'rule', 'strategy', 'params', 'train c/ct', 'test c/ct', 'latency 0/2/5/10 s', 'vs random', 'verdict'].map((h) => (
                <th key={h} className="whitespace-nowrap px-2.5 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const v = verdictOf(r)
              return (
                <Fragment key={i}>
                  <tr onClick={() => setOpen(open === i ? null : i)} className="cursor-pointer border-t border-line hover:bg-row">
                    <td className="px-2.5 py-1.5 tabular-nums text-mute">{r.attempt_global ?? rows.length - i}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-mute">{r.ts ? new Date(r.ts * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[12px] text-ink">{r.rule}</td>
                    <td className="px-2.5 py-1.5 font-mono text-[12px] text-ink-2">{r.strategy}</td>
                    <td className="max-w-[150px] truncate px-2.5 py-1.5 font-mono text-[11.5px] text-mute" title={JSON.stringify(r.params)}>{r.params ? Object.entries(r.params).map(([k, x]) => `${k}=${x}`).join(' ') : '—'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{signed(r.train?.cpct)} <span className="text-mute">({r.train?.days_pos ?? '—'})</span></td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{signed(r.test?.cpct)} <span className="text-mute">({r.test?.days_pos ?? '—'})</span></td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-ink-2">{['0', '2', '5', '10'].map((d) => signed(lat(r, d), 1)).join(' / ')}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-ink-2">{r.baseline_random ? `${signed(r.all?.cpct != null ? r.all.cpct - r.baseline_random.cpct_mean : NaN)} · p${f2(100 * r.baseline_random.rule_pctile, 0)}` : '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${v.good ? 'bg-[#16301f] text-ok' : 'bg-[#2e1f1e] text-[#e66767]'}`}>{v.label}</span>
                    </td>
                  </tr>
                  {open === i && (
                    <tr className="border-t border-line bg-[#1a1a19]">
                      <td colSpan={10} className="p-0">
                        <pre className="selectable max-h-[420px] overflow-auto p-3 font-mono text-[11.5px] leading-snug text-ink-2">{JSON.stringify(r, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function TapeView() {
  const [tab, setTab] = useState<Tab>((['replay', 'hindsight', 'ledger'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'replay') as Tab)
  const [asset, setAsset] = useState<Asset>('BTC')
  return (
    <div className="mx-auto w-full max-w-[1180px] px-8 pb-12 pt-8">
      <div className="mb-1 flex items-center gap-2.5 text-[20px] font-semibold text-ink">
        <Activity size={20} className="text-accent" />Tape
      </div>
      <div className="mb-5 text-[13.5px] text-mute">
        The hindsight map of every window and the ledger of every rule tried. {asset} · read-only from <code className="text-coral">~/vader-swarm/data/kalshi/lab/tape</code>
      </div>
      <div className="mb-5 flex items-center gap-3">
      <div className="inline-flex rounded-lg border border-line bg-[#212121] p-0.5">
        {(['replay', 'hindsight', 'ledger'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`no-drag rounded-md px-3.5 py-1 text-[13px] capitalize ${tab === t ? 'bg-row text-ink' : 'text-mute hover:text-ink'}`}
          >
            {t === 'replay' ? 'Window replay' : t === 'hindsight' ? 'Hindsight summary' : 'Rule ledger'}
          </button>
        ))}
      </div>
      {tab !== 'ledger' && (
        <div className="inline-flex rounded-lg border border-line bg-[#212121] p-0.5" title="Asset">
          {ASSETS.map((a) => (
            <button key={a} onClick={() => setAsset(a)} className={`no-drag rounded-md px-3 py-1 text-[13px] ${asset === a ? 'bg-row text-ink' : 'text-mute hover:text-ink'}`}>
              {a}
            </button>
          ))}
        </div>
      )}
      </div>
      {tab === 'replay' ? <Replay key={asset} asset={asset} /> : tab === 'hindsight' ? <Hindsight key={asset} asset={asset} /> : <Ledger />}
    </div>
  )
}
