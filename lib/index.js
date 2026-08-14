import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import "@deepseek-ai/cordis";
//#region ../../llm/llm/src/brand.ts
/**
* Brand a message identifier.
* @param id - the opaque message identifier.
* @returns the same string, branded; no validation is performed.
*/
function MessageId(id) {
	return id;
}
//#endregion
//#region ../../llm/llm/src/call-config.ts
/**
* Deep-freeze a value in place with an iterative traversal, guarding cycles,
* so later mutation throws without imposing a JavaScript call-stack depth cap.
* {@link AbortSignal} objects are deliberately skipped because they are the
* request's live cancellation channel and freezing them breaks abort.
* @param value - the value to freeze in place.
* @returns the same value, frozen.
*/
function deepFreeze(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	const pending = [{
		kind: "visit",
		node: value
	}];
	while (pending.length > 0) {
		const task = pending.pop();
		/* v8 ignore next -- the loop condition guarantees one pending task. */
		if (task === void 0) continue;
		if (task.kind === "property") {
			pending.push({
				kind: "visit",
				node: task.source[task.key]
			});
			continue;
		}
		const node = task.node;
		if (node === null || typeof node !== "object") continue;
		if (node instanceof AbortSignal) continue;
		if (seen.has(node)) continue;
		seen.add(node);
		Object.freeze(node);
		const keys = Object.keys(node);
		for (let index = keys.length - 1; index >= 0; index--) {
			const key = keys[index];
			/* v8 ignore next -- the loop is bounded by the captured key count. */
			if (key === void 0) continue;
			pending.push({
				kind: "property",
				source: node,
				key
			});
		}
	}
	return value;
}
//#endregion
//#region ../../llm/llm/src/message.ts
/** Message value types, identity, and immutable construction helpers. */
/**
* Detach and deep-freeze a message whose identity already exists.
* @param message - complete message, including its stable identity.
* @returns an immutable snapshot that preserves the identity.
*/
function freezeMessage(message) {
	return deepFreeze(structuredClone(message));
}
/**
* Create one identified message and freeze it before publication.
* @param input - complete role, content, and source for a new message.
* @returns an immutable message with a fresh stable identity.
*/
function createMessage(input) {
	return freezeMessage({
		...input,
		id: MessageId(crypto.randomUUID())
	});
}
/**
* Create one identified user-role message and freeze it before publication.
* @param input - complete content and source for a new user message.
* @returns an immutable user message with a fresh stable identity.
*/
function createUserMessage(input) {
	return createMessage({
		...input,
		role: "user"
	});
}
//#endregion
//#region ../../util/timeout/src/index.ts
/** Largest delay Node schedules without clamping it to one millisecond. */
const MAX_TIMER_DELAY_MS = 2147483647;
//#endregion
//#region ../../llm/llm/src/error.ts
/**
* Canonical provider-neutral code for a response that completed normally but
* carried no content blocks at all. Providers occasionally emit a degenerate
* completion (a terminal stop with zero output); adapters classify it as this
* failure instead of yielding an empty assistant message, because an empty
* message silently ends the turn with nothing for the user or the loop to act
* on. The attempt produced nothing durable, so retry policy treats it as safe
* to repeat.
*/
const EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
//#endregion
//#region ../../llm/llm/src/retry-policy.ts
/**
* Provider-owned request-retry policy configuration and resolution.
*
* Adapters expose one resolved policy per registered provider route; the
* optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
*
* @module @deepseek-ai/dsh-llm/retry-policy
*/
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 1e4;
const DEFAULT_JITTER_RATIO = .1;
const DEFAULT_RETRYABLE_CODES = Object.freeze([
	EMPTY_RESPONSE_CODE,
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const backoffSchema = z.object({
	initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
	maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
	jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
const normalPolicySchema = z.object({
	mode: z.const("normal").required(),
	maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
	retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
	backoff: backoffSchema
});
const alwaysPolicySchema = z.object({
	mode: z.const("always").required(),
	backoff: backoffSchema
});
z.union([normalPolicySchema, alwaysPolicySchema]);
//#endregion
//#region ../../llm/llm/src/attribution.ts
/**
* Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
* adapters from drifting. See
* `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
*
* App-attribution vocabulary for provider requests.
* @module @deepseek-ai/dsh-llm/attribution
*/
const { version } = createRequire(import.meta.url)("../package.json");
//#endregion
//#region lib/types/index.js
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
const name = "dsh-compaction-shield";
const Config = z.object({
	maxAnchors: z.number().default(6),
	minAnchorLength: z.number().default(6)
});
const PLUGIN_SOURCE = {
	kind: "plugin",
	plugin: "dsh-compaction-shield"
};
const STOPWORDS = new Set([
	"the",
	"and",
	"that",
	"this",
	"with",
	"from",
	"have",
	"your",
	"what",
	"error",
	"failed",
	"failure",
	"timeout",
	"exception",
	"command",
	"result",
	"output",
	"input",
	"value",
	"status",
	"note",
	"file",
	"path"
]);
function distinctive(anchor) {
	if (STOPWORDS.has(anchor.toLowerCase())) return false;
	return /[0-9./\\_=:%-]/.test(anchor) || anchor.length >= 12;
}
/** Extract distinctive literal anchors from text (same vocabulary as premise-guard). */
function extractAnchors(text, minLength) {
	const seen = /* @__PURE__ */ new Set();
	const anchors = [];
	for (const pattern of [
		/(["'`])([^"'`\n]{4,80})\1/g,
		/(?:[A-Za-z]:[\\/]|(?:\/|\.{1,2}[\\/]))[\w.\\/()-]+\.\w{1,5}/g,
		/\b[\w.-]{2,40}\s*[=:]\s*[\w./:%-]{1,60}/g,
		/\b(?:[A-Z][A-Z0-9_]{3,}|[\w-]*[Ee]rror[\w-]*|[\w-]*(?:exception|failed|timeout)[\w-]*)\b/g,
		/\b[\w-]{2,40}\.[\w.-]{2,40}\b/g
	]) for (const match of text.matchAll(pattern)) {
		const anchor = (match[1] ?? match[0]).trim();
		if (anchor.length < minLength || !distinctive(anchor)) continue;
		if (seen.has(anchor)) continue;
		seen.add(anchor);
		anchors.push(anchor);
	}
	return anchors.sort((a, b) => b.length - a.length);
}
function validateInt(label, value, fallback) {
	const resolved = value === void 0 ? fallback : value;
	if (!Number.isInteger(resolved) || resolved < 1) throw new Error(`dsh-compaction-shield: invalid ${label} ${resolved} — must be an integer >= 1`);
	return resolved;
}
/**
* Install the shield.
* @param ctx - plugin context; listeners disposed with it.
* @param config - validated {@link Config}.
*/
function apply(ctx, config) {
	const maxAnchors = validateInt("maxAnchors", config.maxAnchors, 6);
	const minAnchorLength = validateInt("minAnchorLength", config.minAnchorLength, 6);
	const hints = /* @__PURE__ */ new Map();
	ctx.on("session/event", async (_session, event) => {
		if (event.type !== "compaction/summary") return;
		const anchors = extractAnchors(event.data.shadowedSeqs.map((seq) => _session.deriveEventMessage(_session.events[seq])).filter((message) => message !== null).map((message) => message.content.filter((block) => block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n")).join("\n"), minAnchorLength).slice(0, maxAnchors);
		if (anchors.length === 0) return;
		const cwd = _session.header.cwd;
		const fs = ctx.get("fs");
		if (fs !== void 0) try {
			const rel = `.dsh-notes/${_session.id}.md`;
			const target = cwd === void 0 ? await fs.resolve(rel) : await fs.resolve(rel, { cwd });
			const existing = await fs.stat(target) !== void 0 ? await fs.readText(target) : "";
			const lines = existing === "" ? [] : existing.split("\n");
			const header = "> ⚠️ compaction-shield 自动存档（压缩前关键锚点）";
			const fresh = [];
			if (!lines.includes(header)) fresh.push(header);
			for (const anchor of anchors) if (!lines.includes(anchor) && !fresh.includes(anchor)) fresh.push(anchor);
			if (fresh.length > 0) {
				const joined = lines.concat(fresh).join("\n");
				await fs.writeText(target, `${joined}${joined.endsWith("\n") ? "" : "\n"}`);
			}
		} catch {}
		hints.set(_session.id, {
			anchors,
			count: anchors.length
		});
	});
	ctx.on("agent/pre-step", async ({ agent, messages }, next) => {
		if (messages.some((message) => message.source.kind === "user")) return next();
		const hint = hints.get(agent.id);
		if (hint === void 0) return next();
		hints.delete(agent.id);
		const anchorLines = hint.anchors.map((anchor) => `- ${anchor}`).join("\n");
		const text = `🧠 压缩盾（compaction-shield）：刚发生一次上下文压缩，已将关键锚点自动存档到会话笔记（.dsh-notes/${agent.session.id}.md，无损字节）：\n${anchorLines}\n如需找回完整上下文，用 recall 读取该笔记；配合 premise-guard 的告警使用。`;
		const downstream = await next();
		if (downstream.kind !== "enter") return downstream;
		return {
			kind: "enter",
			messages: [...downstream.messages, createUserMessage({
				content: [{
					type: "text",
					text
				}],
				source: {
					...PLUGIN_SOURCE,
					form: "notice",
					summary: `archived ${hint.count} anchors`
				}
			})]
		};
	});
	ctx.on("agent/disposed", ({ agent }) => {
		hints.delete(agent.id);
	});
}
//#endregion
export { Config, apply, extractAnchors, name };
