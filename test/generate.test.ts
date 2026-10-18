import { describe, expect, it } from "vitest";
import { generateDataset, generateDocument } from "../src/generate.js";
import { pdfToText } from "../src/extract/rules.js";
import { validateClaim } from "../src/validate.js";

describe("synthetic generator", () => {
  it("is deterministic for a seed", async () => {
    const [a, b] = await Promise.all([generateDocument(42, 5), generateDocument(42, 5)]);
    expect(a.truth).toEqual(b.truth);
  });

  it("produces every layout and scenario in a modest dataset", async () => {
    const docs = await generateDataset(40, 42);
    expect(new Set(docs.map((d) => d.truth.layout))).toEqual(new Set(["form", "letter", "note"]));
    expect(new Set(docs.map((d) => d.truth.scenario))).toEqual(new Set(["complete", "missing", "invalid"]));
  });

  it("labels expected issues consistently with the scenario", async () => {
    for (const { truth } of await generateDataset(40, 42)) {
      if (truth.scenario === "complete") expect(truth.expectedIssues).toEqual([]);
      else expect(truth.expectedIssues.length).toBeGreaterThan(0);
      const blocking = validateClaim(truth.fields).filter((i) => i.severity === "blocking").map(({ code, field }) => ({ code, field }));
      expect(blocking).toEqual(truth.expectedIssues);
    }
  });

  it("stamps every PDF as synthetic", async () => {
    const { pdf } = await generateDocument(1, 0, "note");
    expect(await pdfToText(pdf)).toContain("SYNTHETIC TEST DOCUMENT - NOT A REAL CLAIM");
  });
});
