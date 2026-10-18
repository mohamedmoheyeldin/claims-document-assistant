import type { ClaimFields, FieldName } from "./schema.js";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Converts MM/DD/YYYY, YYYY-MM-DD or "Month D, YYYY" to YYYY-MM-DD. */
export function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1]!.toLowerCase());
    if (month >= 0) return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  return null;
}

export function toAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Field comparison used by the evaluation: dates and amounts exact, text case- and space-insensitive. */
export function fieldMatches(field: FieldName, expected: ClaimFields, actual: ClaimFields): boolean {
  let want = expected[field];
  let got = actual[field];
  // A single-day service may legitimately be written without an end date.
  if (field === "serviceDateTo") {
    want = want ?? expected.serviceDateFrom;
    got = got ?? actual.serviceDateFrom;
  }
  if (want === null || want === undefined) return got === null || got === undefined || got === "";
  if (got === null || got === undefined) return false;
  if (typeof want === "number") return typeof got === "number" && Math.abs(want - got) < 0.005;
  return squash(String(want)) === squash(String(got));
}
