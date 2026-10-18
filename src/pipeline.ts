import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeDraft, templateDraft, type StatusDraft } from "./draft.js";
import type { Extractor } from "./extract/types.js";
import type { ClaimFields, Issue } from "./schema.js";
import { validateClaim } from "./validate.js";

export type ReviewState = "pending_review" | "approved" | "rejected" | "escalated";

export interface ProcessedClaim {
  id: string;
  sourceFile: string;
  sha256: string;
  processedAt: string;
  extractor: string;
  servedBy?: string;
  usage?: { inputTokens: number; outputTokens: number };
  fields: ClaimFields;
  issues: Issue[];
  draft: StatusDraft;
  /** Nothing leaves the system until a person approves it in the review queue. */
  reviewState: ReviewState;
  timingsMs: { extract: number; validate: number; draft: number; total: number };
  error?: string;
}

export interface ProcessOptions {
  extractor: Extractor;
  /** When set, Claude writes the reply draft; otherwise the template does. */
  draftClient?: Anthropic;
}

export async function processDocument(id: string, sourceFile: string, pdf: Uint8Array, options: ProcessOptions): Promise<ProcessedClaim> {
  const started = performance.now();
  const extraction = await options.extractor.extract(pdf);
  const extracted = performance.now();
  const issues = validateClaim(extraction.fields);
  const validated = performance.now();
  let draft: StatusDraft;
  let error: string | undefined;
  if (options.draftClient) {
    try {
      draft = await claudeDraft(options.draftClient, extraction.fields, issues);
    } catch (err) {
      // Fall back to the template so the examiner still gets a draft.
      error = `Draft fell back to template: ${(err as Error).message}`;
      draft = templateDraft(extraction.fields, issues);
    }
  } else {
    draft = templateDraft(extraction.fields, issues);
  }
  const done = performance.now();
  return {
    id,
    sourceFile,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    processedAt: new Date().toISOString(),
    extractor: extraction.extractor,
    ...(extraction.servedBy ? { servedBy: extraction.servedBy } : {}),
    ...(extraction.usage ? { usage: extraction.usage } : {}),
    fields: extraction.fields,
    issues,
    draft,
    reviewState: "pending_review",
    timingsMs: {
      extract: Math.round(extracted - started),
      validate: Math.round((validated - extracted) * 100) / 100,
      draft: Math.round(done - validated),
      total: Math.round(done - started),
    },
    ...(error ? { error } : {}),
  };
}
