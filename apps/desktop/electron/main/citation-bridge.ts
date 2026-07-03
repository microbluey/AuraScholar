// Local HTTP bridge for a future Word add-in (Zotero-style). Binds to
// 127.0.0.1 on an ephemeral port, guarded by a per-launch token. This round is
// a read-only skeleton: enough for the add-in side to be built against later.
// Endpoints reuse @aurascholar/db (WorksRepo) and @aurascholar/cite (formatting).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { formatEntry, toCslItem } from "@aurascholar/cite";
import { getMainDb } from "./db";

let port: number | null = null;
const token = randomUUID();

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  // Token gate (skip for the unauthenticated /ping used for discovery).
  if (url.pathname !== "/ping" && url.searchParams.get("token") !== token) {
    return send(res, 401, { error: "bad token" });
  }
  const db = await getMainDb();
  const works = new WorksRepo(db);

  if (url.pathname === "/ping") return send(res, 200, { ok: true, app: "aurascholar" });

  if (url.pathname === "/works/search") {
    const q = url.searchParams.get("q") ?? "";
    const rows = await works.list({ search: q, limit: 25 });
    return send(
      res,
      200,
      rows.map((w) => ({ id: w.id, title: w.title, year: w.year, doi: w.doi })),
    );
  }

  const cslMatch = url.pathname.match(/^\/works\/([^/]+)\/csl$/);
  if (cslMatch) {
    const work = await works.get(decodeURIComponent(cslMatch[1]!));
    if (!work) return send(res, 404, { error: "not found" });
    return send(res, 200, toCslItem(work));
  }

  if (url.pathname === "/cite") {
    const id = url.searchParams.get("id");
    const styleId = url.searchParams.get("style") ?? "apa";
    if (!id) return send(res, 400, { error: "id required" });
    const work = await works.get(id);
    if (!work) return send(res, 404, { error: "not found" });
    return send(res, 200, { html: formatEntry(toCslItem(work), styleId) });
  }

  send(res, 404, { error: "unknown endpoint" });
}

export function startCitationBridge(): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 500, { error: String(e) }));
  });
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;
  });
}

export function citationBridgePort(): number | null {
  return port;
}

export function citationBridgeToken(): string {
  return token;
}
