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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "dsh-compaction-shield";
export interface Config {
    /** Maximum anchors archived per compaction (default 6). */
    maxAnchors?: number;
    /** Minimum anchor length to archive (default 6). */
    minAnchorLength?: number;
}
export declare const Config: z<Config>;
/** Extract distinctive literal anchors from text (same vocabulary as premise-guard). */
export declare function extractAnchors(text: string, minLength: number): string[];
/**
 * Install the shield.
 * @param ctx - plugin context; listeners disposed with it.
 * @param config - validated {@link Config}.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map