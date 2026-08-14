# @deepseek-ai/dsh-compaction-shield

[中文](README.zh.md) | English

Make compaction **lossless by construction**. Every memory plugin in the ecosystem is a passive store (the model must call `memorize`); every compaction fix saves after the fact. This plugin is the missing proactive half: at `compaction/summary` it extracts the shadowed span's critical literal anchors and **archives them into the session notes file** (lossless bytes) before the summary replaces them, then injects a recall hint telling the model exactly where they live.

## Why

Compaction rewrites the head checkpoint every pass, so summaries are re-summarized generation after generation — key premises (paths, values, error codes) blur away. You cannot reliably recover what the summary dropped, but you CAN move the critical literals to a lossless store before they are shadowed. That is what this plugin does, automatically, with no model discipline required.

## How it works

| Hook | Role |
|---|---|
| `session/event` (`compaction/summary`) | Derives the shadowed span's text from `shadowedSeqs`, extracts distinctive anchors (paths, quoted literals, key=value, error codes), and appends them to `<cwd>/.dsh-notes/<session>.md` — the same file `recall` reads — deduplicated, with a `compaction-shield` marker line. |
| `agent/pre-step` | Injects one recall hint naming the archived anchors, once, at the next step that is not a new user prompt. |

No LLM calls, no new storage vocabulary, best-effort archive (a failed write still delivers the hint).

## Compose

- `dsh-file-memory` — `recall` reads the same notes file; the shield is the automatic writer, file-memory the reader.
- `dsh-premise-guard` — alarms on anchors that STILL vanished from the summary; the shield prevents the vanish in the first place. Together: nothing critical can be lost from the model's perspective.

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxAnchors` | `6` | Anchors archived per compaction. |
| `minAnchorLength` | `6` | Anchors shorter than this are never archived. |

Both must be integers `>= 1`; misconfiguration throws at plugin load.

## Install

Not on npm yet - install from this repository:

```sh
npm install github:ICCuse/dsh-compaction-shield
# or: pnpm add github:ICCuse/dsh-compaction-shield
```

Then mount the bundle (declared in package.json 'dsh.bundle'):

```yaml
- id: compaction-shield
  name: 'dsh-compaction-shield'
```

Compose with dsh-file-memory (recall reads the same notes file) and dsh-premise-guard.
