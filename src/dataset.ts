import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateDataset } from "./generate.js";
import type { GroundTruth } from "./schema.js";

export const DEFAULT_DATA_DIR = "data/synthetic";

export async function writeDataset(dir: string, count: number, seed: number): Promise<GroundTruth[]> {
  await mkdir(dir, { recursive: true });
  const docs = await generateDataset(count, seed);
  for (const doc of docs) {
    await writeFile(path.join(dir, `${doc.truth.id}.pdf`), doc.pdf);
    await writeFile(path.join(dir, `${doc.truth.id}.truth.json`), `${JSON.stringify(doc.truth, null, 2)}\n`);
  }
  return docs.map((doc) => doc.truth);
}

export interface DatasetEntry {
  pdfPath: string;
  truth: GroundTruth;
}

export async function loadDataset(dir: string): Promise<DatasetEntry[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".truth.json")).sort();
  return Promise.all(
    names.map(async (name) => ({
      pdfPath: path.join(dir, name.replace(/\.truth\.json$/, ".pdf")),
      truth: JSON.parse(await readFile(path.join(dir, name), "utf8")) as GroundTruth,
    })),
  );
}
