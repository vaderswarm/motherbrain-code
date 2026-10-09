// A seeded transcript for screenshots (`electron . --demo`); never persisted.
import type { AppState } from '../shared/types'

const md = `**Motherbrain as research lead.** She reads the hindsight map and finds where the profitable trades clustered. She proposes conditions and rules as code and submits them to \`score()\`. She keeps a journal. **Every rule she tries is logged, including the failures.**

1. **Substrate (code, durable).** A library she imports, \`core/tape/\`:
   - \`window(ticker)\`: the full tape for one window
   - \`oracle(window, strategy)\`: the hindsight map
   - \`score(rule)\`: walk-forward, taker prices, both fees, latency ladder
2. **Small fast models for narrow tasks**, spawned through the orchestrator queue.

| strategy | entries | net c/ct | days + |
|---|---|---|---|
| hold to settle | — | — | — |
| scalp TP 4c / SL 3c | — | — | — |

All of it stays on the lab side: read-only to the trading plane, heavy jobs one at a time.`

export function demoState(): AppState {
  const now = Date.now()
  const s = (key: string, projectId: string, title: string, mins: number, extra: object = {}) => ({
    key, projectId, title, model: 'claude-opus-5-5', effort: 'medium' as const, mode: 'auto' as const,
    messages: [], createdAt: now - mins * 60e3, updatedAt: now - mins * 60e3, ...extra,
  })
  return {
    user: { name: 'Brandon', plan: 'Max' },
    projects: [
      { id: 'moneymaker', name: 'MoneyMaker', cwd: '~/vader-swarm' },
      { id: 'syndicate', name: 'Syndicate', cwd: '~/vault' },
      { id: 'hydra', name: 'Black Hydra', cwd: '~/.claude/skills/hydra' },
    ],
    selected: 'd1',
    sessions: [
      {
        ...s('d1', 'moneymaker', 'Tape substrate + Motherbrain desk', 1),
        model: 'mlx-community/Qwen3.5-397B-A17B-4bit',
        messages: [
          { role: 'user', ts: now, blocks: [{ kind: 'text', text: 'Lay out the Motherbrain tape desk.' }] },
          {
            role: 'assistant', ts: now, blocks: [
              { kind: 'text', text: md },
              { kind: 'tool', id: 't1', name: 'code_interpreter', input: { code: "from core.tape import score\nscore(turn_rule)" }, result: 'walk-forward: pending' },
              { kind: 'spawn', id: 'sp1', prompt: 'Build core/tape/breakeven.py: the BTC continuation (bps) needed to cover the round trip, by tau × |idx−K|.', cwd: '~/vader-swarm', model: 'claude-opus-5-5', state: 'pending' },
            ],
          },
        ],
      },
      s('d2', 'moneymaker', 'Morning read 10-09', 180, { spawnedBy: 'd1' }),
      s('d3', 'moneymaker', 'controlshr lock audit', 600),
      s('d4', 'syndicate', '2025 return review', 900),
      s('d5', 'hydra', 'T-20261007-002 engine design', 1500),
    ],
  }
}
