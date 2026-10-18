import { readFile } from "node:fs/promises";
import type { DatasetEntry } from "./dataset.js";
import { claimStatus } from "./draft.js";
import type { Extractor } from "./extract/types.js";
import { fieldMatches } from "./normalize.js";
import { processDocument } from "./pipeline.js";
import { FIELD_NAMES, type FieldName, type Layout } from "./schema.js";

interface Tally {
  documents: number;
  tp: number;
  fp: number;
  fn: number;
  fieldsCorrect: number;
  fieldsTotal: number;
  documentsExact: number;
}

export interface EvalReport {
  extractor: string;
  model?: string;
  documents: number;
  generatedAt: string;
  fieldAccuracy: number;
  documentExactMatch: number;
  byLayout: Record<string, { documents: number; fieldAccuracy: number; documentExactMatch: number; flagPrecision: number; flagRecall: number }>;
  byField: Record<FieldName, number>;
  issueDetection: { precision: number; recall: number; truePositives: number; falsePositives: number; falseNegatives: number };
  routingAccuracy: number;
  timingMs: { meanPerDocument: number; p95PerDocument: number; total: number };
  tokens?: { input: number; output: number };
  errors: { id: string; message: string }[];
  misses: { id: string; layout: Layout; field: FieldName; expected: unknown; actual: unknown }[];
}

const ratio = (a: number, b: number) => (b === 0 ? 1 : Math.round((a / b) * 10000) / 10000);

/**
 * Scores an extractor against the labelled synthetic set. Every number in the
 * report comes from comparing pipeline output with the generator's ground
 * truth; nothing is estimated.
 */
export async function evaluate(entries: DatasetEntry[], extractor: Extractor, options: { model?: string } = {}): Promise<EvalReport> {
  const blank = (): Tally => ({ documents: 0, fieldsCorrect: 0, fieldsTotal: 0, documentsExact: 0, tp: 0, fp: 0, fn: 0 });
  const overall = blank();
  const layouts = new Map<string, Tally>();
  const fieldHits = Object.fromEntries(FIELD_NAMES.map((f) => [f, 0])) as Record<FieldName, number>;
  let routedRight = 0;
  const tokens = { input: 0, output: 0 };
  const timings: number[] = [];
  const errors: EvalReport["errors"] = [];
  const misses: EvalReport["misses"] = [];

  for (const { pdfPath, truth } of entries) {
    const pdf = new Uint8Array(await readFile(pdfPath));
    let result;
    try {
      result = await processDocument(truth.id, pdfPath, pdf, { extractor });
    } catch (err) {
      errors.push({ id: truth.id, message: (err as Error).message });
      continue;
    }
    timings.push(result.timingsMs.total);
    if (result.usage) {
      tokens.input += result.usage.inputTokens;
      tokens.output += result.usage.outputTokens;
    }
    const tally = layouts.get(truth.layout) ?? blank();
    layouts.set(truth.layout, tally);
    let correct = 0;
    for (const field of FIELD_NAMES) {
      if (fieldMatches(field, truth.fields, result.fields)) {
        correct++;
        fieldHits[field]++;
      } else {
        misses.push({ id: truth.id, layout: truth.layout, field, expected: truth.fields[field], actual: result.fields[field] });
      }
    }
    for (const t of [overall, tally]) {
      t.documents++;
      t.fieldsCorrect += correct;
      t.fieldsTotal += FIELD_NAMES.length;
      if (correct === FIELD_NAMES.length) t.documentsExact++;
    }

    const key = (i: { code: string; field: string }) => `${i.code}:${i.field}`;
    const expected = new Set(truth.expectedIssues.map(key));
    const predicted = new Set(result.issues.filter((i) => i.severity === "blocking").map(key));
    for (const t of [overall, tally]) {
      for (const k of predicted) (expected.has(k) ? t.tp++ : t.fp++);
      for (const k of expected) if (!predicted.has(k)) t.fn++;
    }
    const expectedStatus = truth.expectedIssues.length ? "information_requested" : "ready_for_adjudication";
    if (claimStatus(result.issues) === expectedStatus) routedRight++;
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const total = timings.reduce((s, t) => s + t, 0);
  return {
    extractor: extractor.name,
    ...(options.model ? { model: options.model } : {}),
    documents: overall.documents,
    generatedAt: new Date().toISOString(),
    fieldAccuracy: ratio(overall.fieldsCorrect, overall.fieldsTotal),
    documentExactMatch: ratio(overall.documentsExact, overall.documents),
    byLayout: Object.fromEntries(
      [...layouts].sort().map(([layout, t]) => [layout, { documents: t.documents, fieldAccuracy: ratio(t.fieldsCorrect, t.fieldsTotal), documentExactMatch: ratio(t.documentsExact, t.documents), flagPrecision: ratio(t.tp, t.tp + t.fp), flagRecall: ratio(t.tp, t.tp + t.fn) }]),
    ),
    byField: Object.fromEntries(FIELD_NAMES.map((f) => [f, ratio(fieldHits[f], overall.documents)])) as Record<FieldName, number>,
    issueDetection: { precision: ratio(overall.tp, overall.tp + overall.fp), recall: ratio(overall.tp, overall.tp + overall.fn), truePositives: overall.tp, falsePositives: overall.fp, falseNegatives: overall.fn },
    routingAccuracy: ratio(routedRight, overall.documents),
    timingMs: {
      meanPerDocument: Math.round(total / Math.max(1, timings.length)),
      p95PerDocument: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
      total: Math.round(total),
    },
    ...(tokens.input ? { tokens } : {}),
    errors,
    misses,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function reportMarkdown(report: EvalReport): string {
  const lines = [
    `# Evaluation: ${report.extractor} extractor${report.model ? ` (${report.model})` : ""}`,
    "",
    `Run on ${report.generatedAt.slice(0, 10)} over ${report.documents} labelled synthetic documents.`,
    "",
    "| Metric | Result |",
    "|---|---|",
    `| Field accuracy (all ${report.documents} documents) | ${pct(report.fieldAccuracy)} |`,
    `| Documents with every field correct | ${pct(report.documentExactMatch)} |`,
    `| Missing/invalid-information flags: precision | ${pct(report.issueDetection.precision)} |`,
    `| Missing/invalid-information flags: recall | ${pct(report.issueDetection.recall)} |`,
    `| Claims routed to the right status | ${pct(report.routingAccuracy)} |`,
    `| Time per document (mean / p95) | ${report.timingMs.meanPerDocument} ms / ${report.timingMs.p95PerDocument} ms |`,
    ...(report.tokens ? [`| Tokens (input / output, all documents) | ${report.tokens.input.toLocaleString()} / ${report.tokens.output.toLocaleString()} |`] : []),
    ...(report.errors.length ? [`| Documents that errored | ${report.errors.length} |`] : []),
    "",
    "## By layout",
    "",
    "| Layout | Documents | Field accuracy | Every field correct | Flag precision | Flag recall |",
    "|---|---|---|---|---|---|",
    ...Object.entries(report.byLayout).map(([layout, t]) => `| ${layout} | ${t.documents} | ${pct(t.fieldAccuracy)} | ${pct(t.documentExactMatch)} | ${pct(t.flagPrecision)} | ${pct(t.flagRecall)} |`),
    "",
  ];
  return lines.join("\n");
}
