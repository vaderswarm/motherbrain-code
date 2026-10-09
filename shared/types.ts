// Types shared by the Electron main process and the renderer.

export type EngineId = 'motherbrain' | 'claude'

export interface ModelOption {
  id: string
  label: string
  engine: EngineId
  supportsEffort: boolean
}

export const MODELS: ModelOption[] = [
  { id: 'mlx-community/Qwen3.5-397B-A17B-4bit', label: 'Motherbrain', engine: 'motherbrain', supportsEffort: false },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', supportsEffort: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', engine: 'claude', supportsEffort: true },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', engine: 'claude', supportsEffort: false },
]

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// "Auto" maps to Claude Code's auto permission mode; "Ask" prompts for every tool; "Plan" plans only.
export type Mode = 'auto' | 'default' | 'acceptEdits' | 'plan'
export const MODES: { id: Mode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'default', label: 'Ask' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
]

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; isError?: boolean }
  | { kind: 'permission'; id: string; tool: string; input: unknown; state: 'pending' | 'allowed' | 'denied' }
  | { kind: 'spawn'; id: string; prompt: string; cwd: string; model: string; state: 'pending' | 'approved' | 'declined'; sessionKey?: string }
  | { kind: 'error'; text: string }
  | { kind: 'meta'; text: string }

// A file attached to a user turn. Only the path and metadata are stored; the main process reads
// the file when the turn is sent (text is inlined, images go to the Claude engine as image blocks).
export interface Attachment {
  path: string
  name: string
  size: number
  mime: string
  kind: 'image' | 'text' | 'binary'
}

export interface Message {
  role: 'user' | 'assistant'
  blocks: Block[]
  ts: number
  attachments?: Attachment[]
}

export interface Session {
  key: string // local id
  projectId: string
  title: string
  model: string
  effort: Effort
  mode: Mode
  claudeSessionId?: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  spawnedBy?: string // session key of the Motherbrain session that spawned it
}

export interface Project {
  id: string
  name: string
  cwd: string
}

export interface AppState {
  projects: Project[]
  sessions: Session[]
  selected?: string
  user: { name: string; plan: string }
}

// Events streamed from main to renderer, keyed by session.
export type EngineEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; result: string; isError?: boolean }
  | { type: 'permission'; id: string; tool: string; input: unknown }
  | { type: 'spawn-request'; id: string; prompt: string; cwd: string; model: string }
  | { type: 'claude-session'; sessionId: string }
  | { type: 'meta'; text: string }
  | { type: 'error'; text: string }
  | { type: 'running'; running: boolean }
  | { type: 'done'; summary?: string }

export interface SendArgs {
  sessionKey: string
  prompt: string
  model: string
  effort: Effort
  mode: Mode
  cwd: string
  claudeSessionId?: string
  history: Message[] // used by Motherbrain (stateless chat API)
  attachments?: Attachment[]
}

export interface HealthReport {
  motherbrain: { up: boolean; models?: string[] }
  mbTools: { up: boolean; count?: number }
  claude: { path?: string; version?: string }
}
