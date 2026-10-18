#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createClient, MODEL } from "./claude.js";
import { DEFAULT_DATA_DIR, loadDataset, writeDataset } from "./dataset.js";
import { evaluate, reportMarkdown } from "./evaluate.js";
import { createClaudeExtractor } from "./extract/claude.js";
import { rulesExtractor } from "./extract/rules.js";
import type { Extractor } from "./extract/types.js";
import { processDocument } from "./pipeline.js";
import { createReviewServer } from "./review/server.js";
import { ReviewStore } from "./review/store.js";

// Optional .env with ANTHROPIC_API_KEY; real environment variables take precedence.
try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const USAGE = `claims-document-assistant

  generate [--count 60] [--seed 42] [--out data/synthetic]   Write labelled synthetic claim PDFs
  process <pdf|dir> [--extractor claude|rules] [--out out]    Extract, validate and draft; queue for review
  eval [--extractor claude|rules] [--data data/synthetic] [--limit N]   Score an extractor against ground truth
  review [--out out] [--port 4173]                             Open the human review queue

The claude extractor needs ANTHROPIC_API_KEY. The rules extractor runs offline.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    count: { type: "string", default: "60" },
    seed: { type: "string", default: "42" },
    out: { type: "string" },
    data: { type: "string", default: DEFAULT_DATA_DIR },
    extractor: { type: "string" },
    limit: { type: "string" },
    port: { type: "string", default: "4173" },
  },
});
const [command, target] = positionals;

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function pickExtractor(): { extractor: Extractor; claude: boolean } {
  const choice = values.extractor ?? (hasKey() ? "claude" : "rules");
  if (choice === "claude") {
    if (!hasKey()) throw new Error("Set ANTHROPIC_API_KEY to use the Claude extractor, or pass --extractor rules.");
    return { extractor: createClaudeExtractor(createClient()), claude: true };
  }
  if (choice === "rules") return { extractor: rulesExtractor, claude: false };
  throw new Error(`Unknown extractor "${choice}".`);
}

async function main() {
  switch (command) {
    case "generate": {
      const dir = values.out ?? DEFAULT_DATA_DIR;
      const truths = await writeDataset(dir, Number(values.count), Number(values.seed));
      const count = (k: string) => truths.filter((t) => t.layout === k || t.scenario === k).length;
      console.log(`Wrote ${truths.length} documents to ${dir}: ${count("form")} forms, ${count("letter")} letters, ${count("note")} notes; ${count("complete")} complete, ${count("missing")} missing fields, ${count("invalid")} invalid values.`);
      return;
    }
    case "process": {
      if (!target) throw new Error("process needs a PDF file or a directory.");
      const { extractor, claude } = pickExtractor();
      const store = new ReviewStore(values.out ?? "out");
      const stat = await readdir(target).then((names) => names.filter((n) => n.endsWith(".pdf")).sort().map((n) => path.join(target, n))).catch(() => [target]);
      for (const file of stat) {
        const id = path.basename(file, ".pdf");
        const claim = await processDocument(id, path.resolve(file), new Uint8Array(await readFile(file)), { extractor, ...(claude ? { draftClient: createClient() } : {}) });
        await store.save(claim);
        const blocking = claim.issues.filter((i) => i.severity === "blocking").length;
        console.log(`${id}: ${claim.draft.status}${blocking ? ` (${blocking} problem${blocking > 1 ? "s" : ""})` : ""} in ${claim.timingsMs.total} ms`);
      }
      console.log(`Queued ${stat.length} for review. Run "pnpm review" to check them.`);
      return;
    }
    case "eval": {
      const { extractor, claude } = pickExtractor();
      let entries = await loadDataset(values.data);
      if (values.limit) entries = entries.slice(0, Number(values.limit));
      const report = await evaluate(entries, extractor, claude ? { model: MODEL } : {});
      await mkdir("eval", { recursive: true });
      await writeFile(`eval/${extractor.name}.json`, `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(`eval/${extractor.name}.md`, reportMarkdown(report));
      console.log(reportMarkdown(report));
      return;
    }
    case "review": {
      const store = new ReviewStore(values.out ?? "out");
      const port = Number(values.port);
      createReviewServer(store).listen(port, "127.0.0.1", () => console.log(`Review queue: http://127.0.0.1:${port}/`));
      return;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
