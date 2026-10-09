// A session transcript as markdown, for Share / Export / Copy.
import type { Block, Project, Session } from '../../shared/types'
import { MODELS } from '../../shared/types'

function fenced(s: string, lang = ''): string {
  let longest = 2
  for (const m of s.matchAll(/`+/g)) longest = Math.max(longest, m[0].length)
  const f = '`'.repeat(longest + 1)
  return `${f}${lang}\n${s}\n${f}`
}

const json = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

function block(b: Block): string {
  switch (b.kind) {
    case 'text':
      return b.text
    case 'tool':
      if (b.name === 'Thinking') return `<details><summary>Thinking</summary>\n\n${json(b.input)}\n\n</details>`
      return [`**Tool: ${b.name}**`, fenced(json(b.input), 'json'), b.result !== undefined ? `${b.isError ? 'Error' : 'Result'}:\n\n${fenced(b.result)}` : '_(no result)_'].join('\n\n')
    case 'permission':
      return `_Permission for ${b.tool}: ${b.state}_`
    case 'spawn':
      return `_Spawn Claude Code session (${b.model}, ${b.cwd}): ${b.state}${b.sessionKey ? ` → ${b.sessionKey}` : ''}_\n\n> ${b.prompt.replace(/\n/g, '\n> ')}`
    case 'error':
      return `> **Error:** ${b.text}`
    case 'meta':
      return `_${b.text}_`
  }
}

export function transcriptMarkdown(s: Session, project?: Project): string {
  const model = MODELS.find((m) => m.id === s.model)?.label ?? s.model
  const head = [
    `# ${s.title}`,
    '',
    `- Project: ${project ? `${project.name} (${project.cwd})` : s.projectId}`,
    `- Model: ${model}`,
    `- Started: ${new Date(s.createdAt).toISOString()}`,
    ...(s.claudeSessionId ? [`- Claude session: \`${s.claudeSessionId}\` (resume with \`claude --resume ${s.claudeSessionId}\`)`] : []),
  ]
  const body = s.messages.map((m) => {
    const parts = m.blocks.map(block).filter((x) => x.trim())
    if (m.role === 'user') {
      const att = (m.attachments ?? []).map((a) => `- attached: \`${a.path}\``)
      return ['## You', '', ...parts, ...(att.length ? ['', ...att] : [])].join('\n')
    }
    return ['## ' + model, '', parts.join('\n\n')].join('\n')
  })
  return [...head, '', ...body.flatMap((b) => [b, ''])].join('\n').trimEnd() + '\n'
}

export function exportFileName(s: Session): string {
  const base = s.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'session'
  return `${base}.md`
}
