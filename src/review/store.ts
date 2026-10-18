import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { templateDraft } from "../draft.js";
import type { ProcessedClaim, ReviewState } from "../pipeline.js";
import { ClaimFieldsSchema, FIELD_NAMES, type FieldName } from "../schema.js";
import { validateClaim } from "../validate.js";

export interface ReviewDecision {
  reviewer: string;
  decision: "approve" | "reject" | "escalate";
  fields: unknown;
  subject: string;
  body: string;
  note?: string;
}

export interface AuditEntry {
  at: string;
  claimId: string;
  reviewer: string;
  decision: ReviewDecision["decision"];
  corrections: { field: FieldName; from: unknown; to: unknown }[];
  draftEdited: boolean;
  statusSent?: string;
  note?: string;
}

/**
 * File-backed review queue. Results live in <dir>/results, every decision is
 * appended to <dir>/audit.jsonl, and an approved reply is written to
 * <dir>/outbox for a person or a downstream system to send. The assistant
 * itself never sends anything.
 */
export class ReviewStore {
  constructor(private readonly dir: string) {}

  get resultsDir() {
    return path.join(this.dir, "results");
  }

  async save(claim: ProcessedClaim): Promise<void> {
    await mkdir(this.resultsDir, { recursive: true });
    await writeFile(path.join(this.resultsDir, `${claim.id}.json`), `${JSON.stringify(claim, null, 2)}\n`);
  }

  async list(): Promise<ProcessedClaim[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.resultsDir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      return [];
    }
    return Promise.all(names.map(async (n) => JSON.parse(await readFile(path.join(this.resultsDir, n), "utf8")) as ProcessedClaim));
  }

  async get(id: string): Promise<ProcessedClaim | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(this.resultsDir, `${id}.json`), "utf8")) as ProcessedClaim;
    } catch {
      return null;
    }
  }

  async decide(id: string, input: ReviewDecision): Promise<{ claim: ProcessedClaim; audit: AuditEntry }> {
    const claim = await this.get(id);
    if (!claim) throw new ReviewError(404, `No claim ${id}.`);
    if (claim.reviewState !== "pending_review") throw new ReviewError(409, `Claim ${id} was already ${claim.reviewState}.`);
    if (!input.reviewer?.trim()) throw new ReviewError(400, "A reviewer name is required for the audit trail.");
    if (!["approve", "reject", "escalate"].includes(input.decision)) throw new ReviewError(400, "Unknown decision.");
    const parsed = ClaimFieldsSchema.safeParse(input.fields);
    if (!parsed.success) throw new ReviewError(400, `Invalid fields: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);

    const fields = parsed.data;
    const corrections = FIELD_NAMES.filter((f) => JSON.stringify(fields[f]) !== JSON.stringify(claim.fields[f])).map((f) => ({ field: f, from: claim.fields[f], to: fields[f] }));
    // Re-run the rules on the reviewer's corrected values so the status that goes out matches them.
    const issues = validateClaim(fields);
    const status = templateDraft(fields, issues).status;
    const draftEdited = input.subject !== claim.draft.subject || input.body !== claim.draft.body;
    const state: ReviewState = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "escalated";

    const updated: ProcessedClaim = { ...claim, fields, issues, draft: { ...claim.draft, status, subject: input.subject, body: input.body }, reviewState: state };
    const audit: AuditEntry = {
      at: new Date().toISOString(),
      claimId: id,
      reviewer: input.reviewer.trim(),
      decision: input.decision,
      corrections,
      draftEdited,
      ...(state === "approved" ? { statusSent: status } : {}),
      ...(input.note ? { note: input.note } : {}),
    };

    await this.save(updated);
    await appendFile(path.join(this.dir, "audit.jsonl"), `${JSON.stringify(audit)}\n`);
    if (state === "approved") {
      await mkdir(path.join(this.dir, "outbox"), { recursive: true });
      await writeFile(path.join(this.dir, "outbox", `${id}.txt`), `Subject: ${input.subject}\n\n${input.body}\n`);
    }
    return { claim: updated, audit };
  }
}

export class ReviewError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
