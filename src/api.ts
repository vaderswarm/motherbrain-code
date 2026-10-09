import type { AppState, EngineEvent, HealthReport, SendArgs } from '../shared/types'

export interface MbApi {
  info(): Promise<{ demo: boolean; platform: string }>
  loadState(): Promise<AppState>
  saveState(s: AppState): Promise<void>
  send(args: SendArgs): Promise<void>
  interrupt(key: string): Promise<boolean>
  respond(id: string, value: unknown): Promise<boolean>
  health(): Promise<HealthReport>
  onEvent(cb: (key: string, ev: EngineEvent) => void): () => void
}

declare global {
  interface Window {
    mb: MbApi
  }
}

export const mb = (): MbApi => window.mb
