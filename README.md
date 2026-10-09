# Motherbrain Code

A desktop app modelled on the Claude Code desktop app. One window, two engines:

- **Motherbrain**: the hero on Mind (`mlx-community/Qwen3.5-397B-A17B-4bit`, OpenAI-compatible at `localhost:8100/v1`), with her sandboxed tools from mb-tools (`localhost:8140`: `code_interpreter`, `read_file`, `recall_memory`), plus one app-side tool, `spawn_claude_session`.
- **Claude Code**: the local `claude` CLI (`~/.local/bin/claude`) driven through `@anthropic-ai/claude-agent-sdk`. It uses the CLI's existing login, so it runs on the signed-in subscription. Sessions are written to `~/.claude/projects` and can be resumed from the terminal (`claude --resume <id>`).

![v0](docs/v0.png)

![Tape panel](docs/tape_panel.png)

## Architecture

```
renderer (React + Tailwind, sandboxed)            main process (Electron, Node)
  Sidebar · Transcript · Composer   <── IPC ──>    engine:send → claude.ts | motherbrain.ts
  state.ts applies EngineEvents                    engine:event (stream) ← both engines
  cards: permission / spawn  ── decision:respond → bridge.ts resolves the awaiting engine
  saveState (debounced)      ── state:save ─────→ store.ts → <userData>/state.json
```

- `shared/types.ts`: models, modes, the transcript block model, and the `EngineEvent` stream contract.
- `electron/claude.ts`: one `query()` per turn. It resumes with the session id from the previous turn's `system/init` and sets `includePartialMessages` for text deltas. Tool calls come from assistant messages and results from user messages. `canUseTool` raises an approve/deny card. `settingSources: user, project, local` means **your own permission rules and hooks apply**: pre-allowed tools run without a card, exactly as in the CLI. An AbortController handles interrupt.
- `electron/motherbrain.ts`: streaming chat with a tool loop (max 8 steps). mb-tools schemas are fetched per turn; if the server is down she runs without them and the transcript says so. Reasoning is shown as a collapsible "Thinking" block. **`spawn_claude_session(prompt, cwd, model)`** raises a card. On approval the renderer creates a new Claude Code session in the sidebar (marked ✦, with `spawnedBy`) and starts it, and Motherbrain receives the session key as the tool result.
- History replay (`shared/history.ts`): each Motherbrain turn re-sends the session's transcript in OpenAI form, including earlier tool calls (`assistant.tool_calls`) and their results (`role: "tool"`), spawn cards as `spawn_claude_session` calls, and a marker for calls interrupted before they returned. A result is capped at 6,000 characters and arguments at 4,000 (kept as valid JSON), with a `[… truncated N chars]` marker. Over 120,000 characters in total, the oldest whole turns are dropped and the first kept user turn says how many.
- Attachments (`electron/attachments.ts`): the composer's **+** (or drag and drop) attaches files. Text files are inlined into the turn in a fence, capped at 200,000 characters. Images go to the Claude engine as image blocks (5 MB limit); Motherbrain is text-only and gets the path, and its chip says so. Other files are referenced by path. Only paths are stored in the transcript; files are read when the turn is sent.
- Shell: back/forward (⌘[ / ⌘]) over sessions and panels; a per-session menu (hover … or right-click) with rename and delete (with a confirmation); **Add project** (a name and a folder picker). In the header: split view (a second session beside the current one, with swap), open the project folder, Share (export the transcript as Markdown), and an overflow menu (rename, copy or export Markdown, copy `claude --resume`, open in Terminal, delete). The mic sends AppKit's `startDictation:` to the focused composer, the same as Edit › Start Dictation. It needs Dictation turned on in System Settings › Keyboard. On other platforms the mic is disabled and says so.
- `electron/bridge.ts`: pending user decisions. The resolver is registered before the card is emitted.
- Persistence: projects, sessions and transcripts in `<userData>/state.json`.

## Tape panel (More → Tape)

Read-only views over the `core/tape` outputs in `~/vader-swarm/data/kalshi/lab/tape/`. Nothing is written there.

- **Window replay**: pick a day and a 15-minute window, step with ‹ ›, choose a strategy. Two charts share a τ axis: Kalshi YES/NO taker prices and mid in cents, then Binance spot and the settlement index against the dashed strike in USD. They are two charts, not one chart with two y-axes. Under them sits the hindsight strip: net c/ct of entering YES or NO at each second under that strategy, fees in, on a diverging scale clipped at ±15¢ (blue positive, red negative). Hovering over a chart shows the values at that second. **BTC / ETH** switches the asset for the replay and the summary. Every series is put on a 1-second grid over the 900-second window (`src/lib/downsample.ts`): the last value in each second is kept, holes of up to 60 s hold the previous value, and nothing is thinned below one point per second. The series are drawn as step lines. **Mark a ledger rule** draws that rule's entries in the window as dashed vertical lines on both charts and outlined cells on the hindsight strip, coloured by side. The entries come from an `entries` list on the ledger row when there is one. Otherwise they are rebuilt from the row's `params.bands` and `spec.side` over the cached `cond/<asset>/<day>.parquet`, taking the first decision per side and entering at s+1 (latency 0). The cached file is read only, never built.
- **Hindsight summary**: for a day range, the share of entries net > 0 and the mean net c/ct, by strategy × τ bucket. `best` is the hindsight-best strategy per entry, the ceiling a perfect selector could reach.
- **Rule ledger**: every attempt in `rule_ledger.jsonl`, newest first. It re-reads when the file changes (polled every 4 s) and skips a half-written last line, so a scorer can append while the panel is open. Click a row for the full JSON. `verdict` is the ledger's own field when present; otherwise it is derived as positive (train and test both > 0) or negative.

Plumbing: `electron/tape.ts` runs `py/tape_query.py` under `~/vader-swarm/.venv/bin/python`, which uses pyarrow plus `core.tape.data.window`. Results are cached in memory per query. Per-day summaries are cached in `<userData>/tape_cache`, keyed by the oracle file's mtime, so a rebuilt day is recomputed. The ledger is read directly in Node. The asset is passed through to the helper and only `BTC`/`ETH` are accepted. Fixture mode (`--tape-fixtures test/fixtures/tape` or `MB_TAPE_FIXTURES`) answers every query from synthetic JSON (`npm run fixtures` regenerates it), so the panel runs without lab data. Charts use uPlot with the dataviz reference palette's dark steps, validated against `#1e1e1e`.

## Package

```
npm run dist         # build + electron-builder --mac dir (unsigned)
open "dist/app/mac-arm64/Motherbrain Code.app"
```

The `.app` (about 556 MB) can be launched from Finder. It bundles `py/tape_query.py` in `Resources/py`, still uses the vader-swarm venv and data on this machine, and finds the `claude` CLI through `~/.local/bin` (main.ts extends `PATH` for Finder launches). It is not signed or notarised and not installed anywhere; copying it to /Applications is a manual step. The icon is `build/icon.svg`. `npm run icon` renders it to `build/icon.png` and `build/icon.icns`, and `mac.icon` points electron-builder at the `.icns`.

Capture flags: `--view tape --tab replay|hindsight|ledger --size 1440x1180 --capture out.png --capture-delay 6000`, plus `--capture-js "<js>"` to drive the UI (open a menu or a dialog) before the shot.

## Run

```
npm install
npm run build        # typecheck + main + renderer
npm start            # the app
npm run dev          # vite HMR + electron
npm test             # vitest: history replay, downsampler, session store, attachments, Motherbrain engine vs mock servers
npm run smoke        # one Claude (haiku) turn + one Motherbrain turn, outside Electron
npx electron . --selftest                       # the same through the real main-process engines; the Claude turn writes .selftest_tmp and needs approval
npx electron . --demo --capture docs/v0.png     # seeded transcript → screenshot, not persisted
```

## Verified (2026-10-09, on vader-mind)

- `npm run build` is clean (typecheck of renderer and main, vite build).
- `npm run smoke`: Claude haiku replied "OK" in 2.1 s, streamed, with a new session id. The hero streamed "OK" in 12.3 s (cold; about 4 s warm).
- `--selftest`: a Claude turn in `default` mode → Write tool → permission event → approved → file written → "DONE"; the Motherbrain turn streams. A Bash `echo` ran without a card because the user settings pre-allow it, which shows those rules are applied.

## Stubbed / not yet built

- **Spawn path end to end with the hero choosing the tool**: the card → create → send path is built and compiles, but has not been exercised with a real hero tool call yet.
- Artifacts panel and the Customize page (currently an Engines health page). Projects can be added but not yet edited or removed.
- Verified only against mocks and fixtures (polish-v1): rebuilding rule entries from the bands on real `cond` parquet, ETH windows from the real helper, image attachments through a real Claude turn, the hero accepting replayed `tool` messages, and macOS dictation (it needs a person at the machine).
- Packaging is an unsigned `--mac dir` build with no dmg or notarisation. Renderer-only dependencies (react, markdown) are copied into the app's node_modules unnecessarily.

## Next

1. Tape panel: a per-day view of a rule's P/L, and the scorer writing an explicit `entries` list to each ledger row so the overlay never has to rebuild it.
2. Spawned-session results flowing back to Motherbrain: a `read_session(key)` tool, so she can supervise what she delegates.
3. Small-model lane: route narrow tasks to small local models through the orchestrator queue, with per-task measurement.
4. Hydra as a panel: send one prompt to several heads and show the grade side by side.
5. Sign and notarise; trim renderer dependencies out of the packaged node_modules.
