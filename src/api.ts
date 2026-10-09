import type { AppState, EngineEvent, HealthReport, SendArgs } from '../shared/types'

export interface MbApi {
  info(): Promise<{ demo: boolean; platform: string; view?: string }>
  loadState(): Promise<AppState>
  saveState(s: AppState): Promise<void>
  send(args: SendArgs): Promise<void>
  interrupt(key: string): Promise<boolean>
  respond(id: string, value: unknown): Promise<boolean>
  health(): Promise<HealthReport>
  tape: {
    days(asset?: string): Promise<any>
    windows(day: string, asset?: string): Promise<any>
    window(ticker: string, day: string, strategy: string): Promise<any>
    summary(d0: string, d1: string, asset?: string): Promise<any>
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
