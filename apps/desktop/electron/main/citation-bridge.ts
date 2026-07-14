// Local HTTP bridge for a future Word add-in (Zotero-style). Binds to
// 127.0.0.1 on an ephemeral port, guarded by a per-launch token. This round is
// a read-only skeleton: enough for the add-in side to be built against later.
// Endpoints reuse @aurascholar/db (WorksRepo) and @aurascholar/cite (formatting).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { formatEntry, toCslItem } from "@aurascholar/cite";
import { describeSafeError } from "@aurascholar/platform";
import { getMainDb } from "./db";

let port: number | null = null;
const token = randomUUID();
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOW_HEADER = "GET, HEAD, OPTIONS";

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": ALLOW_HEADER,
    "access-control-allow-headers": "content-type",
    "allow": ALLOW_HEADER,
  };
  res.writeHead(status, headers);
  if (req.method === "HEAD" || status === 204) {
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!ALLOWED_METHODS.has(req.method ?? "")) {
    return send(req, res, 405, { error: "method not allowed" });
  }
  if (req.method === "OPTIONS") {
    return send(req, res, 204, {});
  }

  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    return send(req, res, 400, { error: "bad url" });
  }
  if (url.pathname === "/ping") {
    return send(req, res, 200, { ok: true, app: "aurascholar" });
  }

  // Token gate (skip for the unauthenticated /ping used for discovery).
  if (url.searchParams.get("token") !== token) {
    return send(req, res, 401, { error: "bad token" });
  }
  const db = await getMainDb();
  const works = new WorksRepo(db);

  if (url.pathname === "/works/search") {
    const q = url.searchParams.get("q") ?? "";
    const rows = await works.list({ search: q, limit: 25 });
    return send(
      req,
      res,
      200,
      rows.map((w) => ({ id: w.id, title: w.title, year: w.year, doi: w.doi })),
    );
  }

  const cslMatch = url.pathname.match(/^\/works\/([^/]+)\/csl$/);
  if (cslMatch) {
    const work = await works.get(decodeURIComponent(cslMatch[1]!));
    if (!work) return send(req, res, 404, { error: "not found" });
    return send(req, res, 200, toCslItem(work));
  }

  if (url.pathname === "/cite") {
    const id = url.searchParams.get("id");
    const styleId = url.searchParams.get("style") ?? "apa";
    if (!id) return send(req, res, 400, { error: "id required" });
    const work = await works.get(id);
    if (!work) return send(req, res, 404, { error: "not found" });
    return send(req, res, 200, { html: formatEntry(toCslItem(work), styleId) });
  }

  send(req, res, 404, { error: "unknown endpoint" });
}

export function startCitationBridge(): void {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => send(req, res, 500, { error: describeSafeError(e) }));
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
