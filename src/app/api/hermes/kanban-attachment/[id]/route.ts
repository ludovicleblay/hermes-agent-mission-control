import { NextResponse } from "next/server";

// Proxy les pièces jointes kanban depuis l'API dashboard Hermes (plugin kanban).
// Le site est sur le réseau hermes_default (voir compose hermes) et s'authentifie
// en session basic (provider "basic") avant de télécharger le fichier.
const KANBAN_API = process.env.HERMES_KANBAN_API_URL || "http://hermes:9119";
const KANBAN_USER = process.env.HERMES_KANBAN_API_USER || "admin";
const KANBAN_PASS = process.env.HERMES_KANBAN_API_PASSWORD || "";

let cookie = "";
let cookieAt = 0;

async function login() {
  const res = await fetch(`${KANBAN_API}/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "basic", username: KANBAN_USER, password: KANBAN_PASS }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (!setCookies) throw new Error("no session cookie");
  cookie = setCookies;
  cookieAt = Date.now();
}

async function api(path: string): Promise<Response> {
  if (!cookie || Date.now() - cookieAt > 10 * 60 * 1000) await login().catch(() => { cookie = ""; });
  let res = await fetch(`${KANBAN_API}${path}`, { headers: { Cookie: cookie }, cache: "no-store" });
  if (res.status === 401) {
    await login();
    res = await fetch(`${KANBAN_API}${path}`, { headers: { Cookie: cookie }, cache: "no-store" });
  }
  return res;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = "then" in ctx.params ? await ctx.params : ctx.params;
  const board = new URL(_req.url).searchParams.get("board") || "default";
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const res = await api(`/api/plugins/kanban/attachments/${id}?board=${encodeURIComponent(board)}`);
    if (!res.ok) return NextResponse.json({ error: `attachment ${res.status}` }, { status: res.status });
    const buf = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get("content-disposition") || "";
    const name = cd.match(/filename="?([^";]+)"?/i)?.[1] || `attachment-${id}`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 502 });
  }
}
