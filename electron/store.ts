// App state (projects, sessions, transcripts) as one JSON file in Electron's userData.
import { app } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppState } from '../shared/types.js'

const file = () => join(app.getPath('userData'), 'state.json')

export function defaultState(): AppState {
  const h = homedir()
  return {
    projects: [
      { id: 'moneymaker', name: 'MoneyMaker', cwd: join(h, 'vader-swarm') },
      { id: 'syndicate', name: 'Syndicate', cwd: join(h, 'vault') },
      { id: 'motherbrain-code', name: 'Motherbrain Code', cwd: join(h, 'motherbrain-code') },
    ],
    sessions: [],
    user: { name: 'Brandon', plan: 'Max' },
  }
}

export function loadState(): AppState {
  try {
    if (existsSync(file())) return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    /* fall through to defaults */
  }
  return defaultState()
}

export function saveState(s: AppState): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(s))
  renameSync(tmp, file())
}
