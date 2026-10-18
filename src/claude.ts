import Anthropic from "@anthropic-ai/sdk";

/** Model used for extraction and drafting. Override with CLAIMS_MODEL. */
export const MODEL = process.env.CLAIMS_MODEL ?? "claude-opus-5-5";

/**
 * Server-side refusal fallback: if a safety classifier declines a request,
 * the API re-runs it on a fallback model inside the same call instead of
 * returning an empty answer.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createClient(): Anthropic {
  return new Anthropic();
}

export class ModelRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ""}; route the document to manual review.`);
  }
}
