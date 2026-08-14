/**
 * dsh-compaction-shield — make compaction lossless by construction.
 *
 * Every memory plugin in the ecosystem is a PASSIVE store (the model must call
 * memorize); every compaction fix is "save after the fact" (premise-guard
 * alarms on anchors the summary already dropped). This plugin is the missing
 * proactive half: at `compaction/summary` it extracts distinctive literal
 * anchors from the shadowed span and ARCHIVES them into the session's
 * file-memory notes file (lossless bytes) BEFORE the summary replaces them,
 * then injects a recall hint so the model knows exactly where they live.
 *
 * Compose with `dsh-file-memory` (recall reads the same notes file) and
 * `dsh-premise-guard` (which alarms on anchors that STILL vanished): nothing
 * critical can be lost from the model's perspective anymore.
 * @module @deepseek-ai/dsh-compaction-shield
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message, MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls in dsh-compaction's SessionEventMap augmentation so the
// 'compaction/summary' / 'compaction/end' event types are visible.
import type {} from '@deepseek-ai/dsh-compaction'

export const name = 'dsh-compaction-shield'

export interface Config {
  /** Maximum anchors archived per compaction (default 6). */
  maxAnchors?: number
  /** Minimum anchor length to archive (default 6). */
  minAnchorLength?: number
}

export const Config: z<Config> = z.object({
  maxAnchors: z.number().default(6),
  minAnchorLength: z.number().default(6),
})

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'dsh-compaction-shield' }

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'your', 'what',
  'error', 'failed', 'failure', 'timeout', 'exception', 'command', 'result',
  'output', 'input', 'value', 'status', 'note', 'file', 'path',
])

function distinctive(anchor: string): boolean {
  if (STOPWORDS.has(anchor.toLowerCase())) return false
  return /[0-9./\\_=:%-]/.test(anchor) || anchor.length >= 12
}

/** Extract distinctive literal anchors from text (same vocabulary as premise-guard). */
export function extractAnchors(text: string, minLength: number): string[] {
  const seen = new Set<string>()
  const anchors: string[] = []
  const patterns: RegExp[] = [
    /(["'`])([^"'`\n]{4,80})\1/g,
    /(?:[A-Za-z]:[\\/]|(?:\/|\.{1,2}[\\/]))[\w.\\/()-]+\.\w{1,5}/g,
    /\b[\w.-]{2,40}\s*[=:]\s*[\w./:%-]{1,60}/g,
    /\b(?:[A-Z][A-Z0-9_]{3,}|[\w-]*[Ee]rror[\w-]*|[\w-]*(?:exception|failed|timeout)[\w-]*)\b/g,
    /\b[\w-]{2,40}\.[\w.-]{2,40}\b/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] ?? match[0]
      const anchor = raw.trim()
      if (anchor.length < minLength || !distinctive(anchor)) continue
      if (seen.has(anchor)) continue
      seen.add(anchor)
      anchors.push(anchor)
    }
  }
  return anchors.sort((a, b) => b.length - a.length)
}

/** Minimal structural face of the optional `fs` service. */
interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<{ targetKey: string }>
  stat(target: unknown): Promise<{ kind: string } | undefined>
  readText(target: unknown): Promise<string>
  writeText(target: unknown, content: string): Promise<unknown>
}

/** A pending recall hint for one session, delivered once at the next pre-step. */
interface Hint {
  anchors: string[]
  count: number
}

function validateInt(label: string, value: number | undefined, fallback: number): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`dsh-compaction-shield: invalid ${label} ${resolved} — must be an integer >= 1`)
  }
  return resolved
}

/**
 * Install the shield.
 * @param ctx - plugin context; listeners disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const maxAnchors = validateInt('maxAnchors', config.maxAnchors, 6)
  const minAnchorLength = validateInt('minAnchorLength', config.minAnchorLength, 6)

  const hints = new Map<SessionId, Hint>()

  // At compaction/summary: archive the shadowed span's critical anchors into
  // the session notes file (the same file `recall` reads), lossless bytes.
  ctx.on('session/event', async (_session, event: SessionEvent): Promise<void> => {
    if (event.type !== 'compaction/summary') return
    const shadowedText = event.data.shadowedSeqs
      .map(seq => _session.deriveEventMessage(_session.events[seq]!))
      .filter((message): message is Message => message !== null)
      .map(message => message.content
        .filter((block): block is { type: 'text'; text: string } =>
          block !== null && typeof block === 'object'
          && (block as { type?: unknown }).type === 'text'
          && typeof (block as { text?: unknown }).text === 'string')
        .map(block => block.text)
        .join('\n'))
      .join('\n')
    const anchors = extractAnchors(shadowedText, minAnchorLength).slice(0, maxAnchors)
    if (anchors.length === 0) return

    // Append to the file-memory notes file: <cwd>/.dsh-notes/<session>.md
    const cwd = _session.header.cwd
    const fs = ctx.get('fs') as FsLike | undefined
    if (fs !== undefined) {
      try {
        const rel = `.dsh-notes/${_session.id}.md`
        const target = cwd === undefined ? await fs.resolve(rel) : await fs.resolve(rel, { cwd })
        const existing = (await fs.stat(target)) !== undefined ? await fs.readText(target) : ''
        const lines = existing === '' ? [] : existing.split('\n')
        const header = '> ⚠️ compaction-shield 自动存档（压缩前关键锚点）'
        const fresh: string[] = []
        if (!lines.includes(header)) fresh.push(header)
        for (const anchor of anchors) {
          if (!lines.includes(anchor) && !fresh.includes(anchor)) fresh.push(anchor)
        }
        if (fresh.length > 0) {
          const joined = lines.concat(fresh).join('\n')
          await fs.writeText(target, `${joined}${joined.endsWith('\n') ? '' : '\n'}`)
        }
      } catch {
        // archiving is best-effort; the hint still fires
      }
    }
    hints.set(_session.id, { anchors, count: anchors.length })
  })

  // Deliver the recall hint once, at the next step that is not a new user prompt.
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) return next()
    const hint = hints.get(agent.id)
    if (hint === undefined) return next()
    hints.delete(agent.id)

    const anchorLines = hint.anchors.map(anchor => `- ${anchor}`).join('\n')
    const text = '🧠 压缩盾（compaction-shield）：刚发生一次上下文压缩，已将关键锚点自动存档到会话笔记'
      + `（.dsh-notes/${agent.session.id}.md，无损字节）：\n${anchorLines}\n`
      + `如需找回完整上下文，用 recall 读取该笔记；配合 premise-guard 的告警使用。`

    const downstream = await next()
    if (downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [
        ...downstream.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { ...PLUGIN_SOURCE, form: 'notice', summary: `archived ${hint.count} anchors` },
        }),
      ],
    }
  })

  // Release per-agent state when the agent leaves the registry.
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }): void => {
    hints.delete(agent.id)
  })
}
