import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { REVIEW_PAGE } from "./page.js";
import { ReviewError, type ReviewStore } from "./store.js";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new ReviewError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewError(400, "Body must be JSON.");
  }
}

/** Local-only review UI. Binds to 127.0.0.1; there is no authentication because it is a demo for one examiner. */
export function createReviewServer(store: ReviewStore): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(type === "application/json" ? JSON.stringify(body) : (body as string | Uint8Array));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const claimMatch = url.pathname.match(/^\/api\/claims\/([\w.-]+)(\/review)?$/);
      const pdfMatch = url.pathname.match(/^\/files\/([\w.-]+)\.pdf$/);
      if (req.method === "GET" && url.pathname === "/") return send(200, REVIEW_PAGE, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/claims") return send(200, await store.list());
      if (req.method === "GET" && claimMatch && !claimMatch[2]) {
        const claim = await store.get(claimMatch[1]!);
        return claim ? send(200, claim) : send(404, { error: "Not found" });
      }
      if (req.method === "POST" && claimMatch?.[2]) {
        const result = await store.decide(claimMatch[1]!, (await readJson(req)) as never);
        return send(200, result);
      }
      if (req.method === "GET" && pdfMatch) {
        const claim = await store.get(pdfMatch[1]!);
        if (!claim) return send(404, { error: "Not found" });
        return send(200, new Uint8Array(await readFile(claim.sourceFile)), "application/pdf");
      }
      send(404, { error: "Not found" });
    } catch (err) {
      if (err instanceof ReviewError) return send(err.status, { error: err.message });
      send(500, { error: "Internal error" });
    }
  });
}
