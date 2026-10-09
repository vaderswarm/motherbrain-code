import type { AppState, Attachment, EngineEvent, HealthReport, SendArgs } from '../shared/types'

export interface MbApi {
  info(): Promise<{ demo: boolean; platform: string; view?: string }>
  loadState(): Promise<AppState>
  saveState(s: AppState): Promise<void>
  send(args: SendArgs): Promise<void>
  interrupt(key: string): Promise<boolean>
  respond(id: string, value: unknown): Promise<boolean>
  health(): Promise<HealthReport>
  files: {
    pick(defaultPath?: string): Promise<Attachment[]>
    describeDropped(files: FileList | File[]): Promise<Attachment[]>
    pickFolder(defaultPath?: string): Promise<string | null>
    openFolder(path: string): Promise<string | null> // error text, or null on success
    openTerminal(path: string): Promise<string | null>
    exportMarkdown(name: string, md: string, cwd?: string): Promise<string | null> // saved path
    copy(text: string): Promise<void>
  }
  dictation(): Promise<{ ok: boolean; reason?: string }>
  tape: {
    days(asset?: string): Promise<any>
    windows(day: string, asset?: string): Promise<any>
    window(ticker: string, day: string, strategy: string, asset?: string): Promise<any>
    summary(d0: string, d1: string, asset?: string): Promise<any>
    entries(ticker: string, day: string, asset: string, row: unknown): Promise<any>
    ledger(): Promise<{ mtime: number; rows: any[]; error?: string }>
  }
  onEvent(cb: (key: string, ev: EngineEvent) => void): () => void
}

declare global {
  interface Window {
    mb: MbApi
  }
}

export const mb = (): MbApi => window.mb
