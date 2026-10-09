// Writes the synthetic Tape fixtures in test/fixtures/tape (deterministic; no lab data involved).
// Run: node scripts/make-tape-fixtures.mjs   Use: MB_TAPE_FIXTURES=test/fixtures/tape npm start
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '..', 'test', 'fixtures', 'tape')
const DAY = '2026-10-08'
const STRATS = ['hold', 'scalp_tp4_sl6']
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const r2 = (v, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

function makeWindow(asset, ticker, closeTs, base) {
  const n = 900
  const s = [], tau = [], bn = [], idx = [], yes = [], no = [], mid = []
  let px = base, ix = base - base * 0.00005
  const K = Math.round(base / (asset === 'BTC' ? 10 : 1)) * (asset === 'BTC' ? 10 : 1)
  for (let i = 0; i < n; i++) {
    s.push(closeTs - n + i)
    tau.push(n - i)
    if (rnd() > 0.12) px += (rnd() - 0.5) * base * 0.00012
    // Binance has short holes (no print that second): the chart must hold the step across them
    bn.push(i % 97 >= 94 ? null : r2(px))
    if (i % 3 === 0) ix += (px - ix) * 0.5 // the index is a slower composite
    idx.push(r2(ix))
    const sigma = base * 0.0009 * Math.sqrt((n - i) / n + 0.01)
    const p = 1 / (1 + Math.exp(-((ix - K) / sigma) * 1.7))
    const m = Math.min(0.98, Math.max(0.02, p))
    mid.push(r2(m, 3))
    yes.push(r2(Math.min(0.99, Math.ceil((m + 0.01) * 100) / 100), 2))
    no.push(r2(Math.min(0.99, Math.ceil((1 - m + 0.01) * 100) / 100), 2))
  }
  const outcome_yes = idx[n - 1] > K ? 1 : 0
  const strips = {}
  for (const st of STRATS) {
    const edge = st === 'hold' ? 1 : 0.4
    strips[st] = {
      yes: yes.map((p, i) => (i % 211 === 0 ? null : r2(((outcome_yes - p) * edge - 0.012) * 100, 2))),
      no: no.map((p, i) => (i % 211 === 0 ? null : r2((((1 - outcome_yes) - p) * edge - 0.012) * 100, 2))),
    }
  }
  return { ticker, day: DAY, K, outcome_yes, close_ts: closeTs, feed_ok: true, s, tau, yes_px: yes, no_px: no, mid, bn, idx, strips }
}

function write(asset, base) {
  const dir = join(OUT, asset)
  mkdirSync(dir, { recursive: true })
  const closes = [1791493200, 1791494100] // two consecutive windows, 2026-10-08 CT afternoon
  const wins = closes.map((c, i) => makeWindow(asset, `KX${asset}15M-26OCT08${String(1400 + i * 15)}-${i}`, c, base))
  writeFileSync(join(dir, 'days.json'), JSON.stringify({ days: [DAY], strategies: STRATS, asset }))
  writeFileSync(join(dir, `windows_${DAY}.json`), JSON.stringify({ windows: wins.map((w) => ({ ticker: w.ticker, close_ts: w.close_ts, outcome_yes: w.outcome_yes, feed_ok: true })) }))
  for (const w of wins) writeFileSync(join(dir, `window_${w.ticker}.json`), JSON.stringify(w))
  const buckets = ['(5, 60]', '(60, 180]', '(180, 300]', '(300, 450]', '(450, 600]', '(600, 900]']
  const rows = [...STRATS, 'best'].map((st, k) => ({
    strategy: st,
    cells: Object.fromEntries(buckets.map((b, j) => [b, { share: r2(0.3 + 0.05 * j + 0.1 * k, 3), cpct: r2(-2 + j * 0.6 + k * 1.5, 2), n: 1000 + j * 10 }])),
  }))
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ days: [DAY], buckets, rows }))
  return wins
}

const btc = write('BTC', 61500)
const eth = write('ETH', 2450)
const t0 = 1791580000
const ledger = [
  { ts: t0, rule: 'fixture_turn_up_yes', strategy: 'hold', asset: 'BTC', attempt_global: 1, params: { spec: { side: 'yes' } },
    train: { cpct: 1.2, days_pos: '9/14' }, test: { cpct: 0.4, days_pos: '4/7' }, all: { cpct: 0.9 },
    entries: [{ ticker: btc[0].ticker, s: btc[0].s[212], side: 'yes' }, { ticker: btc[0].ticker, s: btc[0].s[640], side: 'no' }, { ticker: btc[1].ticker, s: btc[1].s[75], side: 'yes' }] },
  { ts: t0 + 60, rule: 'fixture_extreme_no', strategy: 'scalp_tp4_sl6', asset: 'BTC', attempt_global: 2,
    params: "{'spec': {'side': 'no', 'when': [['turn_r30_sig', 0, 2]]}, 'bands': [{'feature': 'turn_r30_sig', 'lo': -8.6, 'hi': -0.86, 'hi_inclusive': False}]}",
    train: { cpct: -2.3, days_pos: '17/45' }, test: { cpct: -0.97, days_pos: '6/22' } },
  { ts: t0 + 120, rule: 'fixture_eth_fade', strategy: 'hold', asset: 'ETH', attempt_global: 3, params: { spec: { side: 'no' } },
    train: { cpct: 0.3, days_pos: '8/14' }, test: { cpct: -0.2, days_pos: '3/7' },
    entries: [{ ticker: eth[0].ticker, s: eth[0].s[450], side: 'no' }] },
]
writeFileSync(join(OUT, 'rule_ledger.jsonl'), ledger.map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log('wrote', OUT)
