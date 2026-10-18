import { describe, expect, it } from "vitest";
import { rulesExtractor } from "../src/extract/rules.js";
import { generateDocument } from "../src/generate.js";
import { fieldMatches, toAmount, toIsoDate } from "../src/normalize.js";
import { FIELD_NAMES } from "../src/schema.js";

describe("normalizers", () => {
  it("parses the date formats the documents use", () => {
    expect(toIsoDate("03/04/2026")).toBe("2026-03-04");
    expect(toIsoDate("March 4, 2026")).toBe("2026-03-04");
    expect(toIsoDate("2026-03-04")).toBe("2026-03-04");
    expect(toIsoDate("--")).toBeNull();
  });

  it("parses amounts with symbols and separators", () => {
    expect(toAmount("$1,234.50")).toBe(1234.5);
    expect(toAmount("99.00 USD")).toBe(99);
  });
});

describe("rules extractor", () => {
  for (const layout of ["form", "letter"] as const) {
    it(`reads every field of the known ${layout} template`, async () => {
      for (let i = 0; i < 15; i++) {
        const { truth, pdf } = await generateDocument(99, i, layout);
        const { fields } = await rulesExtractor.extract(pdf);
        const wrong = FIELD_NAMES.filter((f) => !fieldMatches(f, truth.fields, fields));
        expect(wrong, `${truth.id} (${truth.scenario})`).toEqual([]);
      }
    });
  }

  it("returns nulls rather than guesses for a layout it has no rules for", async () => {
    const { pdf } = await generateDocument(99, 0, "note");
    const { fields } = await rulesExtractor.extract(pdf);
    expect(Object.values(fields).every((v) => v === null)).toBe(true);
  });
});
