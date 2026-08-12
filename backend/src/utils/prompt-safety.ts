/**
 * Helpers for putting untrusted content into an LLM prompt.
 *
 * "Untrusted" here means anything Pericles did not author: news/social feed
 * bodies, customer documents, external API payloads, and end-user questions.
 * `pericles-prompts` requires every such value to be boundary-marked and
 * escaped before it reaches a model, because the content is attacker-
 * influenceable and the model cannot tell narration from instruction on its
 * own.
 *
 * Kept in utils/ rather than next to any one call site: the first
 * implementation of this convention lived inside the event Q&A route in
 * auth-server.ts, which made it invisible to the monitoring pipeline that
 * needed the same protection. (auth-server.ts still carries its own copy —
 * folding it onto these helpers is a follow-up, not something to do inside a
 * monitoring change.)
 */

/**
 * Neutralizes the angle brackets that delimit the boundary tags, so a value
 * cannot close `</untrusted_content>` early and continue as if it were the
 * surrounding trusted prompt. Uses the single-character guillemets rather
 * than dropping or entity-encoding the brackets: the text stays readable to
 * the model (an article really may discuss "<1% of capacity"), it just can no
 * longer be parsed as a tag.
 */
export const escapeForPromptContext = (value: string): string =>
  value.replace(/</g, '‹').replace(/>/g, '›');

/**
 * Caps a single free-text field so one pathological value cannot dominate the
 * prompt. Event titles/descriptions come from external feeds into unbounded
 * `@db.Text` columns, so there is no schema-level ceiling on them.
 */
export const truncateForPromptContext = (value: string, maxChars = 4000): string =>
  value.length > maxChars ? `${value.slice(0, maxChars)}… [truncated]` : value;

/**
 * Wraps untrusted text in the canonical boundary tag, escaped. One tag name
 * across the whole codebase on purpose: an injection audit can then grep for
 * a single convention instead of a different tag per call site.
 */
export const wrapUntrustedContent = (value: string): string =>
  `<untrusted_content>\n${escapeForPromptContext(value)}\n</untrusted_content>`;
