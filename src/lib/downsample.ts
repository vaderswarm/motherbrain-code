// Put tape series on a 1-second grid for step-line charts.
//
// Prices are step functions: a value holds until the next print. The replay charts therefore draw
// stepped paths, and this module guarantees that every price change survives at 1-s resolution:
//  - samples are binned to whole seconds and the LAST value in each second wins (sub-second changes
//    collapse to where the second ended, never to an average);
//  - empty seconds carry the previous value forward (a step holds), up to `maxHold` seconds, after
//    which the gap shows as a gap;
//  - the output has exactly one point per second of the range: nothing is ever decimated below 1 Hz
//    (a 900-s window is 900 points, which uPlot draws without strain).

export type Num = number | null | undefined

export interface Grid {
  x: number[] // whole seconds, x0..x1 inclusive
  ys: (number | null)[][]
}

export function toSecondGrid(xs: ArrayLike<number>, series: ArrayLike<Num>[], x0: number, x1: number, maxHold = 60): Grid {
  const n = Math.max(0, Math.floor(x1) - Math.ceil(x0) + 1)
  const start = Math.ceil(x0)
  const x = Array.from({ length: n }, (_, i) => start + i)
  const ys = series.map((ys) => {
    const raw: (number | null)[] = new Array(n).fill(null)
    for (let i = 0; i < xs.length; i++) {
      const v = ys[i]
      if (v === null || v === undefined || !Number.isFinite(v)) continue
      const k = Math.floor(xs[i]) - start
      if (k < 0 || k >= n) continue
      raw[k] = v // input in time order: the last sample of the second wins
    }
    // carry forward across short holes
    let last: number | null = null
    let held = 0
    for (let k = 0; k < n; k++) {
      if (raw[k] !== null) {
        last = raw[k]
        held = 0
      } else if (last !== null && held < maxHold) {
        raw[k] = last
        held++
      }
    }
    return raw
  })
  return { x, ys }
}

// The values a step line shows at each whole second, for checking that nothing was lost.
export function stepValueAt(g: Grid, sec: number, series = 0): number | null {
  let lo = 0
  let hi = g.x.length - 1
  if (hi < 0 || sec < g.x[0]) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (g.x[mid] <= sec) lo = mid
    else hi = mid - 1
  }
  return g.ys[series][lo]
}
