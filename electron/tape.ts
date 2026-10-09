// Tape panel data: a read-only bridge to the core/tape outputs in ~/vader-swarm/data/kalshi/lab/tape.
// Parquet is read by py/tape_query.py under the vader-swarm venv (pyarrow + core.tape.data.window);
// the rule ledger (jsonl, appended by core.tape.score) is read here directly. Nothing is ever written there.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SWARM = join(homedir(), 'vader-swarm')
const TAPE = join(SWARM, 'data', 'kalshi', 'lab', 'tape')
const PY = join(SWARM, '.venv', 'bin', 'python')
const LEDGER = join(TAPE, 'rule_ledger.jsonl')

function script(): string {
  // packaged: Resources/py (extraResources); dev: <repo>/py
  const packaged = join(process.resourcesPath ?? '', 'py', 'tape_query.py')
  return app.isPackaged && existsSync(packaged) ? packaged : join(here, '..', '..', 'py', 'tape_query.py')
}

const cache = new Map<string, unknown>()

function query(args: string[], useCache = true): Promise<any> {
  const key = args.join('\u0000')
  if (useCache && cache.has(key)) return Promise.resolve(cache.get(key))
  return new Promise((resolve) => {
    execFile(
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
  })
}

export const tapeDays = (asset = 'BTC') => query(['days', asset], false)
export const tapeWindows = (day: string, asset = 'BTC') => query(['windows', day, asset])
export const tapeWindow = (ticker: string, day: string, strategy: string) => query(['window', ticker, day, strategy])
export const tapeSummary = (d0: string, d1: string, asset = 'BTC') => query(['summary', d0, d1, asset])

// The ledger is appended to while we read it: parse complete lines only, skip a torn tail.
export function tapeLedger(): { mtime: number; rows: unknown[]; error?: string } {
  if (!existsSync(LEDGER)) return { mtime: 0, rows: [], error: `no ledger at ${LEDGER}` }
  const mtime = statSync(LEDGER).mtimeMs
  const rows: unknown[] = []
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      /* torn line mid-append */
    }
  }
  return { mtime, rows: rows.reverse() }
}
