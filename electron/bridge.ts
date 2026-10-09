// Pending user decisions (permission cards, spawn cards) that the main process awaits.
import { randomUUID } from 'node:crypto'
import type { EngineEvent } from '../shared/types.js'

export type Emit = (sessionKey: string, ev: EngineEvent) => void

type Resolver = (value: any) => void
const pending = new Map<string, Resolver>()

export function newId(): string {
  return randomUUID()
}

export function awaitDecision<T>(id: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(id, resolve)
    signal?.addEventListener('abort', () => {
      pending.delete(id)
      reject(new Error('aborted'))
    })
  })
}

export function resolveDecision(id: string, value: unknown): boolean {
  const r = pending.get(id)
  if (!r) return false
  pending.delete(id)
  r(value)
  return true
}
