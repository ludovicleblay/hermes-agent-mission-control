import { NextResponse } from "next/server";

// ── Proxy lecture seule vers l'API Honcho locale (v3) ──────────────────────
// Le site (réseau hermyhq) joint honcho-api (réseau hermes_default) via l'IP
// hôte .107:8000. Whitelist stricte : AUCUN endpoint d'écriture/sensible.
const HONCHO_BASE = process.env.HONCHO_BASE_URL || "http://192.168.68.107:8000";

// Ajoute ?page=&size= en query string (l'API Honcho v3 ignore le body pour paginer)
function paginate(base: string, p: Record<string, string>): string {
  const params = new URLSearchParams();
  if (p.page) params.set("page", p.page);
  if (p.size) params.set("size", p.size);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

const ACTIONS: Record<string, { path: (p: Record<string, string>) => string; method: string; body?: unknown }> = {
  workspaces: { path: () => "/v3/workspaces/list", method: "POST", body: {} },
  peers: {
    path: (p) => `/v3/workspaces/${p.workspace}/peers/list`,
    method: "POST",
    body: {},
  },
  sessions: {
    path: (p) => {
      const base = `/v3/workspaces/${p.workspace}/peers/${p.peer}/sessions`;
      return paginate(base, p);
    },
    method: "POST",
    body: {},
  },
  messages: {
    path: (p) => `/v3/workspaces/${p.workspace}/sessions/${p.session}/messages/list`,
    method: "POST",
    body: {},
  },
  conclusions: {
    path: (p) => {
      const base = `/v3/workspaces/${p.workspace}/conclusions/list`;
      return paginate(base, p);
    },
    method: "POST",
    body: {},
  },
  conclusions_query: {
    path: (p) => `/v3/workspaces/${p.workspace}/conclusions/query`,
    method: "POST",
    body: {}, // body fourni par la requête : { query, top_k }
  },
  chat: {
    path: (p) => `/v3/workspaces/${p.workspace}/peers/${p.peer}/chat`,
    method: "POST",
    body: {}, // body fourni par la requête : { query, reasoning_level, session_id, ... }
  },
  conclusion: {
    path: (p) => `/v3/workspaces/${p.workspace}/conclusions/${p.id}`,
    method: "GET",
  },
  card: {
    path: (p) => {
      // Card d'un peer ; si target est fourni → card locale de l'observateur
      // sur la cible (ex. jarvis→ludo : GET /peers/jarvis/card?target=ludo)
      const base = `/v3/workspaces/${p.workspace}/peers/${p.peer}/card`;
      return p.target ? `${base}?target=${encodeURIComponent(p.target)}` : base;
    },
    method: "GET",
  },
  context: {
    path: (p) => `/v3/workspaces/${p.workspace}/peers/${p.peer}/context`,
    method: "GET",
  },
  summaries: {
    path: (p) => `/v3/workspaces/${p.workspace}/sessions/${p.session}/summaries`,
    method: "GET",
  },
  representation: {
    path: (p) => `/v3/workspaces/${p.workspace}/peers/${p.peer}/representation`,
    method: "POST",
    body: {},
  },
  search: {
    path: (p) => `/v3/workspaces/${p.workspace}/search`,
    method: "POST",
    body: null, // body fourni par la requête
  },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const params = Object.fromEntries(url.searchParams.entries());
  const spec = ACTIONS[action];
  if (!spec) {
    return NextResponse.json(
      { error: `unknown action '${action}'`, actions: Object.keys(ACTIONS) },
      { status: 400 }
    );
  }
  try {
    const path = spec.path(params);
    const init: RequestInit = { method: spec.method, headers: { "Content-Type": "application/json" } };
    if (spec.method === "POST") {
      init.body = JSON.stringify(spec.body ?? {});
    }
    const r = await fetch(`${HONCHO_BASE}${path}`, init);
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ error: `honcho ${r.status}`, detail: text }, { status: r.status });
    }
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ raw: text });
    }
  } catch (e) {
    return NextResponse.json({ error: "honcho unreachable", detail: String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const action = b.action || "";
  const params = { ...b, action: undefined };
  const spec = ACTIONS[action];
  if (!spec) {
    return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
  }
  try {
    const path = spec.path(params);
    const init: RequestInit = { method: spec.method, headers: { "Content-Type": "application/json" } };
    if (spec.method === "POST") {
      // Conserve les champs utiles du body (query, top_k, reasoning_level, ...) en plus de spec.body
      const { action: _a, workspace: _w, peer: _p, id: _i, session: _s, page: _pg, size: _sz, ...extra } = b;
      const payload = { ...(spec.body ?? {}), ...extra };
      init.body = JSON.stringify(payload);
    }
    const r = await fetch(`${HONCHO_BASE}${path}`, init);
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ error: `honcho ${r.status}`, detail: text }, { status: r.status });
    }
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ raw: text });
    }
  } catch (e) {
    return NextResponse.json({ error: "honcho unreachable", detail: String(e) }, { status: 502 });
  }
}
