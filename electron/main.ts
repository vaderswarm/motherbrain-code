// Motherbrain Code — Electron main process: window, persisted state, and the two engines
// (Claude Code via the Agent SDK, Motherbrain via the hero on :8100), streamed to the renderer.
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { AppState, EngineEvent, HealthReport, SendArgs } from '../shared/types.js'
import { MODELS } from '../shared/types.js'
import { resolveDecision } from './bridge.js'
import { claudePath, claudeVersion, interruptClaude, runClaude } from './claude.js'
import { interruptMotherbrain, mbToolSchemas, motherbrainHealth, runMotherbrain } from './motherbrain.js'
import { loadState, saveState } from './store.js'
import { describeFiles } from './attachments.js'
import { tapeDays, tapeEntries, tapeLedger, tapeSummary, tapeWindow, tapeWindows } from './tape.js'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv
const capturePath = argv.includes('--capture') ? argv[argv.indexOf('--capture') + 1] : undefined
const demo = argv.includes('--demo')
const startView = argv.includes('--view') ? argv[argv.indexOf('--view') + 1] : undefined
const winSize = argv.includes('--size') ? argv[argv.indexOf('--size') + 1].split('x').map(Number) : [1440, 940]
const startTab = argv.includes('--tab') ? argv[argv.indexOf('--tab') + 1] : undefined
const captureJs = argv.includes('--capture-js') ? argv[argv.indexOf('--capture-js') + 1] : undefined
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
        // --capture-js "<code>": drive the UI (open a menu, a dialog…) before the shot; it may return a promise.
        if (captureJs) {
          await win!.webContents.executeJavaScript(captureJs).catch((e) => console.error('[capture-js]', e))
          await new Promise((r) => setTimeout(r, 600))
        }
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
// ---- files, folders, export, dictation
const expand = (p: string) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

ipcMain.handle('dialog:openFiles', async (_e, defaultPath?: string) => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Attach files',
    defaultPath: defaultPath ? expand(defaultPath) : undefined,
    properties: ['openFile', 'multiSelections'],
  })
  return r.canceled ? [] : describeFiles(r.filePaths)
})
ipcMain.handle('attach:describe', (_e, paths: string[]) => describeFiles(paths.map(expand)))
ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Choose the working folder',
    defaultPath: defaultPath ? expand(defaultPath) : homedir(),
    properties: ['openDirectory', 'createDirectory'],
  })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('shell:openFolder', async (_e, p: string) => {
  const dir = expand(p)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return `No folder at ${dir}`
  return (await shell.openPath(dir)) || null // '' on success
})
ipcMain.handle('shell:openTerminal', (_e, p: string) => {
  const dir = expand(p)
  if (process.platform !== 'darwin') return 'Open in Terminal is macOS only.'
  if (!existsSync(dir)) return `No folder at ${dir}`
  return new Promise((resolve) => execFile('open', ['-a', 'Terminal', dir], (err) => resolve(err ? String(err.message) : null)))
})
ipcMain.handle('export:markdown', async (_e, name: string, md: string, cwd?: string) => {
  const r = await dialog.showSaveDialog(win!, {
    title: 'Export transcript',
    defaultPath: join(cwd && existsSync(expand(cwd)) ? expand(cwd) : app.getPath('downloads'), basename(name)),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, md)
  return r.filePath
})
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
// macOS dictation: send AppKit's startDictation: to the first responder (the focused text area), the
// same action as Edit > Start Dictation. Elsewhere there is no system hook, and the UI says so.
ipcMain.handle('dictation:start', () => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'Dictation uses macOS system dictation and is not available on this platform.' }
  Menu.sendActionToFirstResponder('startDictation:')
  return { ok: true }
})

ipcMain.handle('tape:days', (_e, asset?: string) => tapeDays(asset))
ipcMain.handle('tape:windows', (_e, day: string, asset?: string) => tapeWindows(day, asset))
ipcMain.handle('tape:window', (_e, ticker: string, day: string, strategy: string, asset?: string) => tapeWindow(ticker, day, strategy, asset))
ipcMain.handle('tape:entries', (_e, ticker: string, day: string, asset: string, row: unknown) => tapeEntries(ticker, day, asset, row))
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

app.whenReady().then(() => {
  // Packaged builds take the icon from the bundle; in dev, show it in the Dock too.
  const icon = join(here, '..', '..', 'build', 'icon.png')
  if (!app.isPackaged && process.platform === 'darwin' && existsSync(icon)) app.dock?.setIcon(icon)
  return argv.includes('--selftest') ? selftest() : createWindow()
})
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
