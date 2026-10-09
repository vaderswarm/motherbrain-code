// Motherbrain Code — Electron main process: window, persisted state, and the two engines
// (Claude Code via the Agent SDK, Motherbrain via the hero on :8100), streamed to the renderer.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import type { AppState, EngineEvent, HealthReport, SendArgs } from '../shared/types.js'
import { MODELS } from '../shared/types.js'
import { resolveDecision } from './bridge.js'
import { claudePath, claudeVersion, interruptClaude, runClaude } from './claude.js'
import { interruptMotherbrain, mbToolSchemas, motherbrainHealth, runMotherbrain } from './motherbrain.js'
import { loadState, saveState } from './store.js'
import { tapeDays, tapeLedger, tapeSummary, tapeWindow, tapeWindows } from './tape.js'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv
const capturePath = argv.includes('--capture') ? argv[argv.indexOf('--capture') + 1] : undefined
const demo = argv.includes('--demo')
const startView = argv.includes('--view') ? argv[argv.indexOf('--view') + 1] : undefined
const winSize = argv.includes('--size') ? argv[argv.indexOf('--size') + 1].split('x').map(Number) : [1440, 940]
const startTab = argv.includes('--tab') ? argv[argv.indexOf('--tab') + 1] : undefined
const captureDelay = argv.includes('--capture-delay') ? Number(argv[argv.indexOf('--capture-delay') + 1]) : 2500

// A Finder-launched app gets a minimal PATH; the claude CLI and its tools need the usual one.
process.env.PATH = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':')

let win: BrowserWindow | null = null

function emit(sessionKey: string, ev: EngineEvent) {
  win?.webContents.send('engine:event', sessionKey, ev)
}

function createWindow() {
  win = new BrowserWindow({
    width: winSize[0],
    height: winSize[1],
    minWidth: 900,
    minHeight: 600,
    title: 'Motherbrain Code',
    backgroundColor: '#1f1f1f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: !capturePath,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) win.loadURL(dev + (startTab ? `#${startTab}` : ''))
  else win.loadFile(join(here, '..', '..', 'dist', 'index.html'), startTab ? { hash: startTab } : undefined)

  win.webContents.on('console-message', (e: any) => {
    const level = e.level ?? ''
    if (level === 'error' || level === 3) console.error('[renderer]', e.message)
  })
  if (capturePath) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        writeFileSync(capturePath, img.toPNG())
        console.log('[capture] wrote', capturePath)
        app.quit()
      }, captureDelay)
    })
  }
}

ipcMain.handle('app:info', () => ({ demo, platform: process.platform, view: startView }))
ipcMain.handle('state:load', () => loadState())
ipcMain.handle('state:save', (_e, s: AppState) => {
  if (!demo) saveState(s)
})
ipcMain.handle('engine:send', (_e, args: SendArgs) => {
  const engine = MODELS.find((m) => m.id === args.model)?.engine ?? 'claude'
  // Fire and forget: progress arrives as engine:event messages.
  void (engine === 'motherbrain' ? runMotherbrain(args, emit) : runClaude(args, emit))
})
ipcMain.handle('engine:interrupt', (_e, sessionKey: string) => interruptClaude(sessionKey) || interruptMotherbrain(sessionKey))
ipcMain.handle('decision:respond', (_e, id: string, value: unknown) => resolveDecision(id, value))
ipcMain.handle('tape:days', (_e, asset?: string) => tapeDays(asset))
ipcMain.handle('tape:windows', (_e, day: string, asset?: string) => tapeWindows(day, asset))
ipcMain.handle('tape:window', (_e, ticker: string, day: string, strategy: string) => tapeWindow(ticker, day, strategy))
ipcMain.handle('tape:summary', (_e, d0: string, d1: string, asset?: string) => tapeSummary(d0, d1, asset))
ipcMain.handle('tape:ledger', () => tapeLedger())
ipcMain.handle('health', async (): Promise<HealthReport> => {
  const [mb, tools] = await Promise.all([motherbrainHealth(), mbToolSchemas()])
  return {
    motherbrain: mb,
    mbTools: tools ? { up: true, count: tools.length } : { up: false },
    claude: { path: claudePath(), version: claudeVersion() },
  }
})

// --selftest: drive one Claude Code turn that needs a tool permission and one Motherbrain turn
// through the real main-process engines, auto-approving, logging every event; then quit.
async function selftest() {
  const log = (key: string, ev: EngineEvent) => {
    if (ev.type === 'permission') resolveDecision(ev.id, true)
    if (ev.type !== 'text-delta') console.log('[selftest]', key, JSON.stringify(ev).slice(0, 200))
    else process.stdout.write(ev.text)
  }
  const base = { effort: 'low' as const, cwd: join(homedir(), 'motherbrain-code'), history: [] }
  await runClaude({ ...base, sessionKey: 'claude', model: 'claude-haiku-4-5-20251001', mode: 'default', prompt: 'Use the Write tool to create the file .selftest_tmp containing selftest-ok, then reply DONE.' }, log)
  await runMotherbrain({ ...base, sessionKey: 'mb', model: 'mlx-community/Qwen3.5-397B-A17B-4bit', mode: 'auto', prompt: 'Reply with exactly: OK' }, log)
  app.quit()
}

app.whenReady().then(() => (argv.includes('--selftest') ? selftest() : createWindow()))
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
