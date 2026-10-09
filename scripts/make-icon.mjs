// Renders build/icon.svg to build/icon.png (1024²) with Electron, then builds build/icon.icns with
// sips + iconutil (macOS).  Run: npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', 'build')
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 1 } })
  win.webContents.setZoomFactor(1)
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 400))
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' })
  const png = join(dir, 'icon.png')
  writeFileSync(png, img.toPNG())

  const set = join(dir, 'icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), png, '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(dir, 'icon.icns')])
  rmSync(set, { recursive: true, force: true })
  console.log('wrote build/icon.png and build/icon.icns')
  app.quit()
})
