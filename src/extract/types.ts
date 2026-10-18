import type { ClaimFields } from "../schema.js";

export interface ExtractionResult {
  fields: ClaimFields;
  extractor: string;
  /** Model usage when an LLM was involved. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Set when the model served the request through a fallback model. */
  servedBy?: string;
}

export interface Extractor {
  name: string;
  extract(pdf: Uint8Array): Promise<ExtractionResult>;
}
