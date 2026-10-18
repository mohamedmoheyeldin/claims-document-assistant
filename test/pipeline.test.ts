import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { templateDraft } from "../src/draft.js";
import { rulesExtractor } from "../src/extract/rules.js";
import { generateDocument } from "../src/generate.js";
import { processDocument } from "../src/pipeline.js";
import { createReviewServer } from "../src/review/server.js";
import { ReviewStore } from "../src/review/store.js";
import { validateClaim } from "../src/validate.js";

describe("template draft", () => {
  it("lists every blocking problem when information is needed", async () => {
    const { truth } = await generateDocument(5, 0, "form");
    const fields = { ...truth.fields, providerNpi: null, procedureCode: null };
    const draft = templateDraft(fields, validateClaim(fields));
    expect(draft.status).toBe("information_requested");
    expect(draft.body).toContain("Provider NPI is missing.");
    expect(draft.body).toContain("Procedure code is missing.");
  });
});

describe("pipeline and review queue", () => {
  let dir: string;
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "claims-"));
    const store = new ReviewStore(dir);
    let index = 0;
    let doc = await generateDocument(11, index, "form");
    while (doc.truth.scenario !== "complete") doc = await generateDocument(11, ++index, "form");
    const pdfPath = path.join(dir, "claim.pdf");
    await writeFile(pdfPath, doc.pdf);
    const fields = { ...doc.truth.fields, memberId: null };
    // Simulate an extraction that missed the member ID, so the reviewer has to correct it.
    const claim = await processDocument("claim-001", pdfPath, doc.pdf, { extractor: { name: "stub", extract: async () => ({ fields, extractor: "stub" }) } });
    expect(claim.reviewState).toBe("pending_review");
    expect(claim.draft.status).toBe("information_requested");
    await store.save(claim);
    (globalThis as Record<string, unknown>).truth = doc.truth;
    const server = createReviewServer(store).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("processes a generated PDF end to end with the offline extractor", async () => {
    const { truth, pdf } = await generateDocument(11, 1, "letter");
    const claim = await processDocument("x", "x.pdf", pdf, { extractor: rulesExtractor });
    expect(claim.fields).toMatchObject({ claimNumber: truth.fields.claimNumber });
    expect(claim.draft.draftedBy).toBe("template");
    expect(claim.timingsMs.total).toBeGreaterThanOrEqual(0);
  });

  it("serves the queue, the page and the PDF", async () => {
    expect((await fetch(`${base}/`)).headers.get("content-type")).toContain("text/html");
    const list = await (await fetch(`${base}/api/claims`)).json();
    expect(list).toHaveLength(1);
    const pdf = await fetch(`${base}/files/claim-001.pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });

  it("refuses a decision without a reviewer name", async () => {
    const claim = await (await fetch(`${base}/api/claims/claim-001`)).json();
    const res = await fetch(`${base}/api/claims/claim-001/review`, { method: "POST", body: JSON.stringify({ decision: "approve", reviewer: "", fields: claim.fields, subject: "s", body: "b" }) });
    expect(res.status).toBe(400);
  });

  it("re-validates the reviewer's corrections, logs them and writes the approved reply to the outbox", async () => {
    const truth = (globalThis as Record<string, any>).truth;
    const claim = await (await fetch(`${base}/api/claims/claim-001`)).json();
    const fields = { ...claim.fields, memberId: truth.fields.memberId };
    const res = await fetch(`${base}/api/claims/claim-001/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", reviewer: "Test Examiner", fields, subject: "Claim received", body: "All set." }),
    });
    expect(res.status).toBe(200);
    const { claim: updated, audit } = await res.json();
    expect(updated.reviewState).toBe("approved");
    expect(updated.draft.status).toBe("ready_for_adjudication");
    expect(audit.corrections).toEqual([{ field: "memberId", from: null, to: truth.fields.memberId }]);
    expect(audit.draftEdited).toBe(true);
    expect(await readFile(path.join(dir, "outbox", "claim-001.txt"), "utf8")).toContain("Subject: Claim received");
    expect((await readFile(path.join(dir, "audit.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);

    const again = await fetch(`${base}/api/claims/claim-001/review`, { method: "POST", body: JSON.stringify({ decision: "reject", reviewer: "x", fields, subject: "", body: "" }) });
    expect(again.status).toBe(409);
  });
});
