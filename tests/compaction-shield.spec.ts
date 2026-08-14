import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Shield from 'dsh-compaction-shield'
import { extractAnchors } from 'dsh-compaction-shield'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the compaction shield: anchor extraction, automatic
 * archiving into the session notes file at compaction/summary, and the
 * one-shot recall hint delivered at the next pre-step.
 */

class FakeFs {
  readonly files = new Map<string, string>()
  readonly dirs = new Set<string>(['.'])
  norm(p: string): string { return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/') }
  async resolve(path: string): Promise<{ targetKey: string }> { return { targetKey: this.norm(path) } }
  async stat(target: { targetKey: string }): Promise<{ kind: string } | undefined> {
    const key = this.norm(target.targetKey)
    if (this.files.has(key)) return { kind: 'file' }
    for (const f of this.files.keys()) { if (f.startsWith(`${key}/`)) return { kind: 'dir' } }
    return undefined
  }
  async readText(target: { targetKey: string }): Promise<string> {
    const v = this.files.get(this.norm(target.targetKey)); if (v === undefined) throw new Error('missing'); return v
  }
  async writeText(target: { targetKey: string }, content: string): Promise<void> {
    const key = this.norm(target.targetKey); this.files.set(key, content)
  }
}

async function harness(): Promise<{ ctx: Context; agent: Agent; fs: FakeFs }> {
  const ctx = new Context()
  const fs = new FakeFs()
  await mountAgentLoopTestDependencies(ctx)
  ctx.provide('fs', fs)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Shield, {})
  const adapter = new MockAdapter([
    textResponse('setting up with C:\\data\\backtest\\params.json, alpha=1.5'),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = ctx.agentLoop.create(SessionId('s1'), { provider: 'mock', model: 'mock' })
  await new Promise<void>((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  })
  return { ctx, agent, fs }
}

function firstUserSeq(agent: Agent): number {
  const e = [...agent.session.events].find((candidate): candidate is SessionEvent<'user/message'> =>
    candidate.type === 'user/message' && candidate.data.source.kind === 'user')
  if (e === undefined) throw new Error('no user message')
  return e.seq
}

function firstAssistantSeq(agent: Agent): number {
  const e = [...agent.session.events].find((candidate): candidate is SessionEvent<'assistant/message'> =>
    candidate.type === 'assistant/message')
  if (e === undefined) throw new Error('no assistant message')
  return e.seq
}

/** session/event listeners are fire-and-forget: poll briefly for the async archive write. */
async function awaitArchived(fs: FakeFs, key: string, timeoutMs = 500): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = fs.files.get(key)
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return fs.files.get(key)
}

function appendCompaction(agent: Agent, seqs: number[]): void {
  const id = CompactionId('shield-1')
  agent.session.append('compaction/start', { compactionId: id, turn: null })
  agent.session.append('compaction/summary', {
    compactionId: id,
    summary: [{ type: 'text', text: 'the setup ran with alpha' }],
    shadowedRange: { start: seqs[0]!, end: seqs[seqs.length - 1]! },
    shadowedSeqs: [...seqs],
    shadowedTokenCount: 120,
    provider: 'mock',
    model: 'mock',
  })
  agent.session.append('compaction/end', { compactionId: id, turn: null })
}

async function preStep(ctx: Context, agent: Agent, messages: unknown[]): Promise<{ kind: string; messages?: unknown[] }> {
  const dispatch = agentEvents(ctx, agent)
  return dispatch.waterfall(
    'agent/pre-step',
    { messages, turn: 2, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter' as const, messages: [] }),
  ) as Promise<{ kind: string; messages?: unknown[] }>
}

describe('anchor extraction', () => {
  it('finds paths, key=value pairs and error codes; filters stopwords', () => {
    const anchors = extractAnchors('failed with C:\\data\\backtest\\params.json, alpha=1.5, ERROR_TIMEOUT; the error is generic', 6)
    expect(anchors).toContain('C:\\data\\backtest\\params.json')
    expect(anchors).toContain('alpha=1.5')
    expect(anchors).toContain('ERROR_TIMEOUT')
    expect(anchors.some(a => a === 'error')).toBe(false)
  })
})

describe('auto-archive at compaction', () => {
  it('writes anchors to the session notes file and injects a one-shot recall hint', async () => {
    const { ctx, agent, fs } = await harness()
    const userSeq = firstUserSeq(agent)
    const assistantSeq = firstAssistantSeq(agent)
    appendCompaction(agent, [userSeq, assistantSeq])

    // Archiving is a fire-and-forget async listener; poll for the write.
    const notesKey = `.dsh-notes/${agent.session.id}.md`
    const archived = await awaitArchived(fs, notesKey)
    expect(archived).toBeDefined()
    expect(archived).toContain('C:\\data\\backtest\\params.json')
    expect(archived).toContain('alpha=1.5')
    expect(archived).toContain('compaction-shield')

    // The recall hint arrives at the next pre-step.
    const decision = await preStep(ctx, agent, [])
    expect(decision.kind).toBe('enter')
    const injected = (decision.messages ?? []).filter((m): m is { source: { kind: string }; content: unknown[] } =>
      m !== null && typeof m === 'object' && (m as { source?: { kind?: string } }).source?.kind === 'plugin')
    expect(injected).toHaveLength(1)
    const text = injected[0]!.content
      .filter((b): b is { type: string; text: string } => (b as { type?: string }).type === 'text')
      .map(b => b.text)
      .join('')
    expect(text).toContain('compaction-shield')
    expect(text).toContain('alpha=1.5')

    // One-shot: a second pre-step carries nothing.
    const second = await preStep(ctx, agent, [])
    expect(second.messages ?? []).toHaveLength(0)
  })

  it('archives without duplicates across repeated compactions', async () => {
    const { ctx, agent, fs } = await harness()
    const seqs = [firstUserSeq(agent), firstAssistantSeq(agent)]
    appendCompaction(agent, seqs)
    const notesKey = `.dsh-notes/${agent.session.id}.md`
    await awaitArchived(fs, notesKey)
    const count = (fs.files.get(notesKey)!.match(/alpha=1\.5/g) ?? []).length
    expect(count).toBe(1)
    const decision = await preStep(ctx, agent, [])
    expect(decision.messages ?? []).toHaveLength(1)
    // hint consumed
    const after = await preStep(ctx, agent, [])
    expect(after.messages ?? []).toHaveLength(0)
  })

  it('skips delivery on a fresh user prompt', async () => {
    const { ctx, agent } = await harness()
    appendCompaction(agent, [firstUserSeq(agent), firstAssistantSeq(agent)])
    const decision = await preStep(ctx, agent, [
      createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
    ])
    expect(decision.messages ?? []).toHaveLength(0)
  })
})
