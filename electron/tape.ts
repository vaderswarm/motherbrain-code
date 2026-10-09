// Tape panel data: a read-only bridge to the core/tape outputs in ~/vader-swarm/data/kalshi/lab/tape.
// Parquet is read by py/tape_query.py under the vader-swarm venv (pyarrow + core.tape.data.window);
// the rule ledger (jsonl, appended by core.tape.score) is read here directly. Nothing is ever written there.
//
// Fixture mode (MB_TAPE_FIXTURES=<dir> or --tape-fixtures <dir>): the same calls are answered from
// JSON files (see test/fixtures/tape), so the panel can be developed and checked without lab data.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SWARM = join(homedir(), 'vader-swarm')
const TAPE = join(SWARM, 'data', 'kalshi', 'lab', 'tape')
const PY = join(SWARM, '.venv', 'bin', 'python')

export const ASSETS = ['BTC', 'ETH'] as const
export type Asset = (typeof ASSETS)[number]
// The asset becomes a path segment in the helper: only known assets pass.
const asAsset = (a?: string): Asset => (ASSETS.includes(a as Asset) ? (a as Asset) : 'BTC')

const flag = process.argv.includes('--tape-fixtures') ? process.argv[process.argv.indexOf('--tape-fixtures') + 1] : undefined
const FIXTURES = flag ?? process.env.MB_TAPE_FIXTURES
const fixtureDir = () => (FIXTURES ? resolve(FIXTURES) : undefined)
const LEDGER = () => (fixtureDir() ? join(fixtureDir()!, 'rule_ledger.jsonl') : join(TAPE, 'rule_ledger.jsonl'))

function script(): string {
  // packaged: Resources/py (extraResources); dev: <repo>/py
  const packaged = join(process.resourcesPath ?? '', 'py', 'tape_query.py')
  return app.isPackaged && existsSync(packaged) ? packaged : join(here, '..', '..', 'py', 'tape_query.py')
}

const cache = new Map<string, unknown>()

function query(args: string[], useCache = true, stdin?: string): Promise<any> {
  if (fixtureDir()) return Promise.resolve(fixture(args, stdin))
  const key = args.join('\u0000') + (stdin ?? '')
  if (useCache && cache.has(key)) return Promise.resolve(cache.get(key))
  if (!existsSync(PY)) return Promise.resolve({ error: `The tape helper needs the vader-swarm venv at ${PY}; it is not on this machine.` })
  return new Promise((resolve) => {
    const child = execFile(
      PY,
      [script(), ...args],
      { cwd: SWARM, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env: { ...process.env, TAPE_CACHE: join(app.getPath('userData'), 'tape_cache') } },
      (err, stdout, stderr) => {
        let res: any
        try {
          res = JSON.parse(stdout)
        } catch {
          res = { error: (err?.message ?? 'no output') + (stderr ? `\n${stderr.slice(-800)}` : '') }
        }
        if (!res.error && useCache) cache.set(key, res)
        resolve(res)
      },
    )
    child.stdin?.end(stdin ?? '')
  })
}

export const tapeDays = (asset?: string) => query(['days', asAsset(asset)], false)
export const tapeWindows = (day: string, asset?: string) => query(['windows', day, asAsset(asset)])
export const tapeWindow = (ticker: string, day: string, strategy: string, asset?: string) => query(['window', ticker, day, strategy, asAsset(asset)])
export const tapeSummary = (d0: string, d1: string, asset?: string) => query(['summary', d0, d1, asAsset(asset)])
// A ledger rule's entries in one window: the row travels on stdin (it can be large).
export const tapeEntries = (ticker: string, day: string, asset: string, row: unknown) =>
  query(['entries', ticker, day, asAsset(asset)], true, JSON.stringify(row ?? {}))

// The ledger is appended to while we read it: parse complete lines only, skip a torn tail.
export function tapeLedger(): { mtime: number; rows: unknown[]; error?: string } {
  const path = LEDGER()
  if (!existsSync(path)) return { mtime: 0, rows: [], error: `no ledger at ${path}` }
  const mtime = statSync(path).mtimeMs
  const rows: unknown[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      /* torn line mid-append */
    }
  }
  return { mtime, rows: rows.reverse() }
}

// ---------------------------------------------------------------- fixture mode
function readJson(...parts: string[]): any {
  const p = join(fixtureDir()!, ...parts)
  if (!existsSync(p)) return { error: `fixture missing: ${p}` }
  return JSON.parse(readFileSync(p, 'utf8'))
}

function fixture(args: string[], stdin?: string): any {
  const [cmd, ...a] = args
  switch (cmd) {
    case 'days':
      return readJson(a[0], 'days.json')
    case 'windows':
      return readJson(a[1], `windows_${a[0]}.json`)
    case 'window': {
      const [ticker, , strategy, asset] = a
      const w = readJson(asset, `window_${ticker}.json`)
      if (w.error) return w
      const strip = w.strips?.[strategy] ?? { yes: w.s.map(() => null), no: w.s.map(() => null) }
      const pos = (v: (number | null)[]) => {
        const xs = v.filter((x): x is number => x !== null)
        return xs.length ? xs.filter((x) => x > 0).length / xs.length : null
      }
      const { strips: _drop, ...rest } = w
      return { ...rest, strategy, strip, share_pos: { yes: pos(strip.yes), no: pos(strip.no) } }
    }
    case 'summary':
      return readJson(a[2], 'summary.json')
    case 'entries': {
      const row = JSON.parse(stdin || '{}')
      if (!Array.isArray(row.entries))
        return { error: 'Fixture mode reads explicit entries only; reconstructing a rule from its bands needs the lab conditions cache.' }
      return { source: 'row', entries: row.entries.filter((e: any) => e.ticker === a[0]).map((e: any) => ({ s: e.s, side: e.side })) }
    }
  }
  return { error: `unknown fixture query ${cmd}` }
}
