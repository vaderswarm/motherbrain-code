import { describe, expect, it } from 'vitest'
import { stepValueAt, toSecondGrid } from '../src/lib/downsample'

// A deterministic random walk that changes on most seconds of a 900-s window.
function walk(n: number, seed = 7): number[] {
  let s = seed
  let v = 60000
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const r = s / 2147483648
    if (r > 0.15) v += Math.round((r - 0.575) * 40 * 100) / 100
    out.push(v)
  }
  return out
}

describe('toSecondGrid', () => {
  it('keeps every price change of a 900-s window at 1-s resolution (no decimation)', () => {
    const xs = Array.from({ length: 900 }, (_, i) => i)
    const bn = walk(900)
    const g = toSecondGrid(xs, [bn], 0, 899)
    expect(g.x.length).toBe(900)
    expect(g.ys[0]).toEqual(bn)
    const changes = (a: (number | null)[]) => a.filter((v, i) => i > 0 && v !== a[i - 1]).length
    expect(changes(g.ys[0])).toBe(changes(bn))
    expect(changes(bn)).toBeGreaterThan(600) // the fixture really is busy
    for (let i = 1; i < g.x.length; i++) expect(g.x[i] - g.x[i - 1]).toBe(1)
  })

  it('bins sub-second samples to the last value of each second', () => {
    const xs = [0, 0.3, 0.9, 1.2, 2.0, 2.5]
    const ys = [10, 11, 12, 20, 30, 31]
    const g = toSecondGrid(xs, [ys], 0, 2)
    expect(g.ys[0]).toEqual([12, 20, 31])
  })

  it('holds a step across short holes and shows a long gap as a gap', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const ys = [1, null, null, 2, null, null, null, null, null, 3]
    const g = toSecondGrid(xs, [ys], 0, 9, 3)
    expect(g.ys[0]).toEqual([1, 1, 1, 2, 2, 2, 2, null, null, 3])
  })

  it('aligns several series on one x and ignores samples outside the range', () => {
    const xs = [-1, 0, 1, 2, 3]
    const g = toSecondGrid(xs, [[9, 1, 2, 3, 4], [9, 5, null, 7, 8]], 0, 2)
    expect(g.x).toEqual([0, 1, 2])
    expect(g.ys).toEqual([
      [1, 2, 3],
      [5, 5, 7],
    ])
  })

  it('stepValueAt reads the held value for any second', () => {
    const g = { x: [0, 5, 9], ys: [[1, 2, 3]] }
    expect(stepValueAt(g, 4)).toBe(1)
    expect(stepValueAt(g, 5)).toBe(2)
    expect(stepValueAt(g, 100)).toBe(3)
    expect(stepValueAt(g, -1)).toBe(null)
  })
})
