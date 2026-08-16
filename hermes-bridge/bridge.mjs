#!/usr/bin/env node
/**
 * Hermy HQ ↔ Hermes bridge.
 *
 * Runs on the Mac mini where Hermes lives. Talks to the shared Postgres
 * (the same DATABASE_URL the website uses) — nothing is exposed to the
 * internet. Two jobs:
 *
 *   PULL  (Hermes → website): mirror the kanban board into HermesTask,
 *         cron list + health into DataStore, and emit activity events.
 *   PUSH  (website → Hermes): pick up AgentRequest rows that are `queued`
 *         (safe) or `approved` (human-approved side-effecting), run them
 *         through the `hermes` CLI, and write results back.
 *
 * Requires: the `hermes` binary on PATH, and env DATABASE_URL.
 * Optional env: HERMES_BOARD (default "default"), BRIDGE_POLL_MS (5000),
 *               BRIDGE_MIRROR_MS (30000), HERMES_BIN (default "hermes").
 */
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);
const HERMES = process.env.HERMES_BIN || "hermes";
const BOARD = process.env.HERMES_BOARD || "default";
const POLL_MS = Number(process.env.BRIDGE_POLL_MS || 5000);
const MIRROR_MS = Number(process.env.BRIDGE_MIRROR_MS || 30000);
const RUN_TIMEOUT_MS = Number(process.env.BRIDGE_RUN_TIMEOUT_MS || 240000);
const WIKI_DIR = process.env.HERMES_WIKI || path.join(os.homedir(), ".hermes", "wiki");
const BRIEF_HOUR = Number(process.env.BRIEF_HOUR || 8);   // local hour to auto-generate the daily brief
let lastBriefDate = null;

// Prompt du brief — le modèle est appelé SANS outils (chat simple) : il ne peut
// RIEN lire lui-même. Toutes les données réelles (kanban, activité, dernier brief)
// sont donc injectées DANS le prompt par collectBriefContext(). Plus aucune consigne
// de lecture wiki : le wiki ~/.hermes/wiki est abandonné (remplacé par Outline +
// MEMORY.md + Honcho). Le brief est en français (langue de Ludo).
function buildBriefPrompt(ctx) {
  const kanbanTxt = (ctx.kanban || "Aucune carte active.")
    .split("\n").slice(0, 60).join("\n");
  const activityTxt = (ctx.activity || "Aucune activité récente.")
    .split("\n").slice(0, 30).join("\n");
  const lastBriefTxt = (ctx.lastBrief || "Aucun brief précédent.")
    .split("\n").slice(0, 40).join("\n");
  return (
    "Tu es le chief of staff technique de Ludo (maison Le Blay, infra self-hosted : Home-AI, " +
    "Media-Center, HAOS, Hermes). Produis le brief du jour en français à partir des DONNÉES " +
    "fournies ci-dessous (kanban Hermes + activité récente). Tu n'as accès à AUCUN outil, " +
    "fichier, wiki ou commande : base-toi uniquement sur ces données, ne les invente pas. " +
    "Output ONLY valid JSON (no prose, no code fences, no markdown) " +
    'in exactly this shape: {"greeting":"une ligne chaleureuse en français","summary":"2-3 phrases sur l\'état des lieux",' +
    '"sections":[{"label":"À décider","items":["..."]},{"label":"Priorités","items":["..."]},' +
    '{"label":"Récemment livré","items":["..."]},{"label":"Prochaines actions","items":["..."]}]}. ' +
    "Chaque item court, concret, spécifique, factuel (tiré des données). " +
    "Omets une section si elle n'a rien à mettre. " +
    "Le summary doit refléter les vrais faits : cartes en cours, blocages, livraisons récentes.\n\n" +
    "=== DONNÉES KANBAN (cartes actives) ===\n" + kanbanTxt + "\n\n" +
    "=== ACTIVITÉ RÉCENTE (24h) ===\n" + activityTxt + "\n\n" +
    "=== DERNIER BRIEF (à ne pas répéter — éviter la redite) ===\n" + lastBriefTxt
  );
}

// Récupère les données réelles pour le brief : cartes kanban actives (via l'API REST),
// événements des dernières 24h, dernier brief stocké (anti-redite).
async function collectBriefContext() {
  const ctx = { kanban: "", activity: "", lastBrief: "" };
  try {
    const data = await kanbanApi(`/api/plugins/kanban/board?board=${encodeURIComponent(BOARD)}`);
    const cards = (data?.columns || []).flatMap((c) => (c.tasks || []).map((t) => {
      const status = String(t.status ?? "todo");
      if (status === "done" || status === "archived") return null;
      const prio = t.priority != null ? `[prio ${t.priority}]` : "";
      const who = t.assignee ? ` → ${t.assignee}` : "";
      return `${status}${prio} ${String(t.title ?? "untitled").slice(0, 160)}${who}`;
    })).filter(Boolean);
    ctx.kanban = cards.length ? cards.slice(0, 30).join("\n") : "Aucune carte active.";
  } catch (e) {
    ctx.kanban = `(kanban indisponible : ${String(e.message || e).split("\n")[0].slice(0, 120)})`;
  }
  try {
    const { rows } = await q(
      `SELECT kind, title, level, "createdAt" FROM "AgentEvent" WHERE "createdAt" > now() - interval '24 hours' ORDER BY "createdAt" DESC LIMIT 25`
    );
    ctx.activity = rows.length
      ? rows.map((r) => `${new Date(r.createdAt).toISOString().slice(0, 16)} [${r.kind}/${r.level}] ${String(r.title || "").slice(0, 140)}`).join("\n")
      : "Aucune activité dans les dernières 24h.";
  } catch (e) { ctx.activity = "(activité indisponible)"; }
  try {
    const { rows } = await q(`SELECT data FROM "DataStore" WHERE key='hermes-briefing'`);
    if (rows[0]?.data) {
      const b = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
      const parts = [b?.greeting, b?.summary, ...(b?.sections || []).map((s) => `${s.label}: ${(s.items || []).join(" ; ")}`)];
      ctx.lastBrief = parts.filter(Boolean).join("\n").slice(0, 2000);
    }
  } catch { /* pas de brief précédent */ }
  return ctx;
}

const DB_URL = process.env.DATABASE_URL || "";
if (!DB_URL) { console.error("DATABASE_URL is required (use the direct postgres:// URL, not a prisma:// Accelerate URL)"); process.exit(1); }
if (DB_URL.startsWith("prisma://") || DB_URL.startsWith("prisma+")) {
  console.error("DATABASE_URL is a Prisma Accelerate URL; the bridge needs a DIRECT postgres:// connection string (e.g. POSTGRES_URL).");
  process.exit(1);
}
// Cloud Postgres (Prisma Postgres/Neon/Supabase/RDS) needs SSL; localhost doesn't.
// [PATCH LeBlay] + hermyhq-postgres : Postgres dédié local (réseau docker hermyhq) sans SSL.
const isLocal = /@(localhost|127\.0\.0\.1|hermyhq-postgres)/.test(DB_URL);
const pool = new pg.Pool({ connectionString: DB_URL, max: 4, ssl: isLocal ? undefined : { rejectUnauthorized: false } });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const q = (text, params) => pool.query(text, params);

async function hermes(args, { timeout = 30000 } = {}) {
  const { stdout } = await execFileP(HERMES, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

// Chat via l'API HTTP Hermes (API_SERVER :8642) — évite docker exec + SIGABRT
// du CLI. Fallback sur le CLI si l'API n'est pas joignable.
const HERMES_API_URL = process.env.HERMES_API_URL || "";
let hermesApiKey = null;

async function getApiKey() {
  if (hermesApiKey) return hermesApiKey;
  // API_SERVER_KEY vit dans /opt/data/.env du conteneur hermes
  const { stdout } = await execFileP("docker", ["exec", "hermes", "sh", "-c", "grep API_SERVER_KEY /opt/data/.env | cut -d= -f2-"], { timeout: 10000 }).catch(() => ({ stdout: "" }));
  hermesApiKey = stdout.trim();
  return hermesApiKey;
}

async function hermesChat(prompt, { timeout = 90000 } = {}) {
  // 1) Essayer l'API HTTP (propre, pas de SIGABRT)
  if (HERMES_API_URL) {
    try {
      const key = await getApiKey();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(`${HERMES_API_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || "";
        if (content.trim()) return content.trim();
      }
      log("chat API non disponible, fallback CLI:", res.status);
    } catch (e) {
      log("chat API échec, fallback CLI:", e.message.split("\n")[0]);
    }
  }
  // 2) Fallback : CLI (comportement d'origine)
  return (await hermes(["chat", "-Q", "-q", prompt], { timeout })).trim();
}

/* ─────────────── Kanban API REST (dashboard Hermes :9119) ───────────────
 * L'API REST du plugin kanban (même code que le CLI, zero-patch) — session
 * login password (provider basic) → cookies → appels HTTP. Fallback CLI si
 * l'API est injoignable (dashboard down). */
const KANBAN_API = process.env.HERMES_KANBAN_API_URL || "http://hermes:9119";
const KANBAN_USER = process.env.HERMES_KANBAN_API_USER || "admin";
const KANBAN_PASS = process.env.HERMES_KANBAN_API_PASSWORD || "";
let kanbanCookie = "";
let kanbanCookieAt = 0;

async function kanbanLogin() {
  const res = await fetch(`${KANBAN_API}/auth/password-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "basic", username: KANBAN_USER, password: KANBAN_PASS }),
  });
  if (!res.ok) throw new Error(`kanban login failed: ${res.status}`);
  const setCookies = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (!setCookies) throw new Error("kanban login: no session cookie");
  kanbanCookie = setCookies;
  kanbanCookieAt = Date.now();
  return setCookies;
}

async function kanbanApi(path, { method = "GET", body = null } = {}) {
  // Cookie de session absent ou vieux (>10 min) → re-login (TTL session ~12h)
  if (!kanbanCookie || Date.now() - kanbanCookieAt > 10 * 60 * 1000) {
    await kanbanLogin().catch((e) => { throw new Error(`kanban re-login failed: ${e.message}`); });
  }
  let res;
  try {
    res = await fetch(`${KANBAN_API}${path}`, {
      method,
      headers: {
        Cookie: kanbanCookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`kanban API ${path} unreachable: ${e.message.split("\n")[0]}`);
  }
  if (res.status === 401) {
    // Session expirée côté serveur → re-login une fois puis retry
    await kanbanLogin();
    res = await fetch(`${KANBAN_API}${path}`, {
      method,
      headers: { Cookie: kanbanCookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`kanban API ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function emit(kind, title, { detail = null, agent = "hermes", level = "info", meta = null } = {}) {
  await q(
    `INSERT INTO "AgentEvent" (id, kind, title, detail, agent, level, meta, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [randomUUID(), kind, title.slice(0, 200), detail, agent, level, meta ? JSON.stringify(meta) : null]
  );
}

async function setStore(key, data) {
  await q(
    `INSERT INTO "DataStore" (key, data, "updatedAt") VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, "updatedAt" = now()`,
    [key, JSON.stringify(data)]
  );
}

/* ─────────────── PULL: mirror Hermes → Postgres ─────────────── */
let lastDetailAt = {}; // id -> ts du dernier détail récupéré
let lastStatus = {};   // id -> statut au dernier détail

async function mirrorKanban() {
  let tasks = [];
  let apiMode = true;
  try {
    // L'API board renvoie {columns:[{name, tasks:[...]}]} — on aplatit.
    const data = await kanbanApi(`/api/plugins/kanban/board?board=${encodeURIComponent(BOARD)}`);
    tasks = (data?.columns || []).flatMap((c) => c.tasks || []);
  } catch (e) {
    apiMode = false;
    log("kanban board API failed, fallback CLI:", e.message.split("\n")[0]);
    try {
      // NB: this Hermes CLI wants --board BEFORE the subcommand.
      const out = await hermes(["kanban", "--board", BOARD, "list", "--json"], { timeout: 15000 });
      const parsed = JSON.parse(out || "[]");
      tasks = Array.isArray(parsed) ? parsed : parsed.tasks || [];
    } catch (e2) { log("kanban list failed:", e2.message.split("\n")[0]); return; }
  }

  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id ?? t.task_id ?? "");
    if (!id) continue;
    seen.add(id);
    const status = String(t.status ?? "todo");
    const result = t.result ?? t.latest_summary ?? null;
    await q(
      `INSERT INTO "HermesTask" (id, board, title, body, assignee, status, priority, result, "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, body=EXCLUDED.body, assignee=EXCLUDED.assignee, status=EXCLUDED.status,
         priority=EXCLUDED.priority, result=EXCLUDED.result, "syncedAt"=now()`,
      [id, BOARD, String(t.title ?? "untitled").slice(0, 300), t.body ? String(t.body).slice(0, 4000) : null,
       t.assignee ?? null, status, t.priority != null ? Number(t.priority) : null,
       result ? String(result).slice(0, 2000) : null]
    );

    // ── Détail complet (comments + runs + events + attachments) pour TOUTES les cartes ──
    // Refetch si : jamais fetché, statut changé, ou carte active (non-done) il y a > 60 s.
    // Les cartes done ne sont fetchées qu'une fois (elles ne bougent plus).
    const now = Date.now();
    const statusChanged = lastStatus[id] !== undefined && lastStatus[id] !== status;
    const isActive = status !== "done" && status !== "archived";
    const needDetail = !lastDetailAt[id] || statusChanged || (isActive && now - lastDetailAt[id] > 60_000);
    if (needDetail) {
      try {
        let detailJson;
        if (apiMode) {
          const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(id)}?board=${encodeURIComponent(BOARD)}`);
          detailJson = JSON.stringify(d);
        } else {
          const out = await hermes(["kanban", "--board", BOARD, "show", "--json", id], { timeout: 15000 });
          detailJson = out.trim();
        }
        await q(`UPDATE "HermesTask" SET detail=$1, "syncedAt"=now() WHERE id=$2`, [String(detailJson).slice(0, 30000), id]);
        lastDetailAt[id] = now;
        lastStatus[id] = status;
      } catch (e) { log("kanban detail failed:", String(e.message || e).split("\n")[0]); }
    } else {
      lastStatus[id] = status;
    }
  }
  // prune tasks that vanished from the board
  if (seen.size) {
    await q(`DELETE FROM "HermesTask" WHERE board=$1 AND id <> ALL($2::text[])`, [BOARD, [...seen]]);
  } else {
    await q(`DELETE FROM "HermesTask" WHERE board=$1`, [BOARD]);
  }
  // nettoyage cache mémoire des cartes disparues
  for (const k of Object.keys(lastDetailAt)) if (!seen.has(k)) { delete lastDetailAt[k]; delete lastStatus[k]; }
}

async function mirrorCrons() {
  try {
    const out = await hermes(["cron", "list", "--all"], { timeout: 15000 });
    const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
    await setStore("hermes-crons", { jobs: lines, raw: out.slice(0, 8000), syncedAt: new Date().toISOString() });
  } catch (e) { log("cron list failed:", e.message.split("\n")[0]); }
}

async function mirrorCost() {
  for (const args of [["insights", "--days", "7"], ["insights"]]) {
    try {
      const out = await hermes(args, { timeout: 15000 });
      await setStore("hermes-cost", { summary: out.slice(0, 4000), syncedAt: new Date().toISOString() });
      return;
    } catch { /* try next arg shape */ }
  }
}

async function mirrorHealth() {
  let online = false, gateway = "unknown", detail = "";
  try {
    const out = await hermes(["status"], { timeout: 12000 });
    detail = out.slice(0, 4000);
    online = /online|running|connected/i.test(out);
    gateway = /gateway[^\n]*(running|online)/i.test(out) ? "running" : "stopped";
  } catch (e) { detail = e.message.split("\n")[0]; }
  await setStore("hermes-health", { online, gateway, detail, lastSeen: new Date().toISOString() });
}

/* ─────────────── Memory Wiki (warm tier: git-tracked markdown) ─────────────── */
function parseEntry(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = {}; let body = md;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!kv) continue;
      const v = kv[2].trim();
      if (v.startsWith("[") && v.endsWith("]")) fm[kv[1]] = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      else fm[kv[1]] = v === "null" || v === "" ? null : v;
    }
  }
  return { fm, body: body.trim() };
}
function walkMd(dir, out = []) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) { if (it.name !== ".git") walkMd(full, out); }
    else if (it.name.endsWith(".md") && it.name !== "INDEX.md") out.push(full);
  }
  return out;
}
async function mirrorWiki() {
  if (!fs.existsSync(WIKI_DIR)) return;
  const seen = new Set();
  for (const file of walkMd(WIKI_DIR)) {
    const rel = path.relative(WIKI_DIR, file);
    const id = rel.replace(/\.md$/, "");
    seen.add(id);
    let raw = ""; try { raw = fs.readFileSync(file, "utf8"); } catch { continue; }
    const { fm, body } = parseEntry(raw);
    await q(
      `INSERT INTO "HermesMemory" (id, path, type, title, status, confidence, provenance, tags, links, body, "validFrom", "validTo", "updatedAt", "syncedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
       ON CONFLICT (id) DO UPDATE SET path=EXCLUDED.path, type=EXCLUDED.type, title=EXCLUDED.title,
         status=EXCLUDED.status, confidence=EXCLUDED.confidence, provenance=EXCLUDED.provenance,
         tags=EXCLUDED.tags, links=EXCLUDED.links, body=EXCLUDED.body,
         "validFrom"=EXCLUDED."validFrom", "validTo"=EXCLUDED."validTo", "syncedAt"=now()`,
      [id, rel, fm.type || "fact", fm.title || id, fm.status || "active", fm.confidence || null,
       fm.provenance || null, Array.isArray(fm.tags) ? fm.tags : [], Array.isArray(fm.links) ? fm.links : [],
       body, fm.valid_from || null, fm.valid_to || null]
    );
  }
  if (seen.size) await q(`DELETE FROM "HermesMemory" WHERE id <> ALL($1::text[])`, [[...seen]]);
  else await q(`DELETE FROM "HermesMemory"`);
}
function writeWikiEntry(e) {
  const rel = e.path || `${e.type || "note"}s/${e.id}.md`;
  const full = path.join(WIKI_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    "---", `id: ${e.id}`, `type: ${e.type || "note"}`, `title: ${e.title}`,
    `status: ${e.status || "active"}`,
    e.confidence ? `confidence: ${e.confidence}` : null,
    `provenance: ${e.provenance || "dashboard"}`,
    `tags: [${(e.tags || []).join(", ")}]`, `links: [${(e.links || []).join(", ")}]`,
    `updated: ${now}`, "---", "", e.body || "", "",
  ].filter((l) => l !== null);
  fs.writeFileSync(full, lines.join("\n"), "utf8");
  return rel;
}
async function gitCommitWiki(msg) {
  try {
    if (!fs.existsSync(path.join(WIKI_DIR, ".git"))) await execFileP("git", ["-C", WIKI_DIR, "init"]).catch(() => {});
    await execFileP("git", ["-C", WIKI_DIR, "add", "-A"]).catch(() => {});
    await execFileP("git", ["-C", WIKI_DIR, "commit", "-m", msg]).catch(() => {});
  } catch { /* ignore */ }
}

/* ─────────────── Chief-of-staff daily brief ─────────────── */
// Généré via l'API HTTP Hermes (hermesChat) : réponse propre, sans le cadre
// `┌─ Reasoning ┐` que le CLI DeepSeek colle dans le stdout (c'était la cause du
// brief cassé : parse JSON → échec → fallback = reasoning brut dans summary).
async function generateBriefing() {
  const ctx = await collectBriefContext().catch(() => ({ kanban: "", activity: "", lastBrief: "" }));
  const prompt = buildBriefPrompt(ctx);
  const raw = (await hermesChat(prompt, { timeout: RUN_TIMEOUT_MS })).trim();
  let brief;
  try {
    // stripReasoning : retire un éventuel cadre `┌─ Reasoning … ┐` (fallback CLI)
    let cleaned = raw;
    const m = cleaned.match(/^┌─ Reasoning[\s\S]*?(?:┘|$)/);
    if (m) cleaned = cleaned.slice(m[0].length).trim();
    if (cleaned.startsWith("┌─")) cleaned = cleaned.split("\n").slice(1).join("\n").trim();
    const jsonStr = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const jm = jsonStr.match(/\{[\s\S]*\}/);
    brief = JSON.parse(jm ? jm[0] : jsonStr);
    if (!brief || typeof brief !== "object" || !brief.summary) throw new Error("shape");
    brief.sections = Array.isArray(brief.sections) ? brief.sections : [];
  } catch {
    // Fallback PROPRE : jamais de reasoning brut dans summary — un message clair.
    brief = { summary: "Le brief n'a pas pu être généré (réponse du modèle illisible). Regénère ou consulte le rapport matinal sur Telegram/Outline.", sections: [] };
  }
  brief.generatedAt = new Date().toISOString();
  await setStore("hermes-briefing", brief);
  await emit("status", "Daily brief generated", { level: "up" });
}
async function maybeDailyBrief() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (now.getHours() >= BRIEF_HOUR && lastBriefDate !== today) {
    lastBriefDate = today;
    try { await generateBriefing(); } catch (e) { log("daily brief err", e.message); }
  }
}

/* ─────────────── PUSH: run website requests via Hermes ─────────────── */
async function runRequest(r) {
  await q(`UPDATE "AgentRequest" SET status='running', "startedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id]);
  await emit("run", `Started: ${r.title}`, { level: "info", meta: { requestId: r.id, kind: r.kind } });
  try {
    let result = "";
    if (r.kind === "oneshot" || r.kind === "chat") {
      result = await hermesChat(r.prompt || r.title, { timeout: RUN_TIMEOUT_MS });
    } else if (r.kind === "kanban") {
      // prompt = JSON {body?, assignee?, priority?} encodé par la route /api/hermes/dispatch
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = { body: r.prompt }; }
      // Assignee par défaut : jarvis (le profil worker qui a le skill kanban-risk-validation).
      // "" (triage) ou absent → jarvis, sinon le profil demandé (ex. toad).
      const worker = String(meta.assignee ?? "").trim() || "jarvis";
      const payload = {
        title: r.title,
        body: meta.body ? String(meta.body) : undefined,
        assignee: worker,
        priority: meta.priority != null ? Number(meta.priority) : 0,
        // Consigne systémique de validation des tâches risquées — épinglée à chaque carte
        skills: ["kanban-risk-validation"],
      };
      const d = await kanbanApi(`/api/plugins/kanban/tasks?board=${encodeURIComponent(BOARD)}`, { method: "POST", body: payload });
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.unblock") {
      // Validation humaine : débloque une carte bloquée (needs_input) — prompt = JSON {task_id, reason?, direction?}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.unblock");
      // Consigne libre de l'humain → postée comme commentaire sur la carte avant déblocage
      if (meta.direction && String(meta.direction).trim()) {
        const dir = String(meta.direction).trim().slice(0, 4000);
        await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}/comments?board=${encodeURIComponent(BOARD)}`, {
          method: "POST", body: { body: dir, author: "Ludo" },
        }).catch((e) => log("kanban comment (direction) failed:", String(e.message || e).split("\n")[0]));
      }
      // unblock → status ready (le dispatcher relance un worker)
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}?board=${encodeURIComponent(BOARD)}`, {
        method: "PATCH", body: { status: "ready" },
      });
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.block") {
      // Blocage manuel (utilisé par l'UI pour suspendre une carte) — prompt = JSON {task_id, reason?}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.block");
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}?board=${encodeURIComponent(BOARD)}`, {
        method: "PATCH", body: { status: "blocked", block_reason: meta.reason ? String(meta.reason) : "Blocage manuel depuis Hermy" },
      });
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.show") {
      // Détail complet d'une carte (body, comments, events, runs) — prompt = JSON {task_id}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.show");
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}?board=${encodeURIComponent(BOARD)}`);
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.comment") {
      // Commenter une carte — prompt = JSON {task_id, body, author?}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.comment");
      if (!meta.body || !String(meta.body).trim()) throw new Error("body required for kanban.comment");
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}/comments?board=${encodeURIComponent(BOARD)}`, {
        method: "POST", body: { body: String(meta.body).trim().slice(0, 4000), author: meta.author ? String(meta.author) : "Ludo" },
      });
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.reassign") {
      // Réassigner une carte — prompt = JSON {task_id, profile}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.reassign");
      if (!meta.profile) throw new Error("profile required for kanban.reassign");
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}?board=${encodeURIComponent(BOARD)}`, {
        method: "PATCH", body: { assignee: String(meta.profile) },
      });
      result = JSON.stringify(d);
    } else if (r.kind === "kanban.complete") {
      // Compléter une carte — prompt = JSON {task_id, summary?}
      let meta = {};
      try { meta = r.prompt ? JSON.parse(r.prompt) : {}; } catch { meta = {}; }
      if (!meta.task_id) throw new Error("task_id required for kanban.complete");
      const d = await kanbanApi(`/api/plugins/kanban/tasks/${encodeURIComponent(meta.task_id)}?board=${encodeURIComponent(BOARD)}`, {
        method: "PATCH", body: { status: "done", summary: meta.summary ? String(meta.summary).slice(0, 2000) : undefined },
      });
      result = JSON.stringify(d);
    } else if (r.kind.startsWith("cron.")) {
      const op = r.kind.split(".")[1];
      const a = JSON.parse(r.prompt || "{}");
      const argv =
        op === "create" ? ["cron", "create", a.schedule, a.prompt || a.name].filter(Boolean)
        : op === "run"    ? ["cron", "run", a.id || a.name]
        : op === "pause"  ? ["cron", "pause", a.id || a.name]
        : op === "resume" ? ["cron", "resume", a.id || a.name]
        : op === "remove" ? ["cron", "remove", a.id || a.name]
        : op === "edit"   ? ["cron", "edit", a.id || a.name]
        : null;
      if (!argv) throw new Error(`unknown cron op ${op}`);
      result = (await hermes(argv, { timeout: 20000 })).trim();
      await mirrorCrons();
    } else if (r.kind === "memory.write") {
      const e = JSON.parse(r.prompt || "{}");
      const rel = writeWikiEntry(e);
      await gitCommitWiki(`wiki: update ${rel} (via dashboard)`);
      await mirrorWiki();
      result = `wrote ${rel}`;
    } else if (r.kind === "briefing.generate") {
      await generateBriefing();
      lastBriefDate = new Date().toISOString().slice(0, 10);
      result = "brief updated";
    } else {
      throw new Error(`unknown kind ${r.kind}`);
    }
    await q(`UPDATE "AgentRequest" SET status='done', result=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`,
      [r.id, result.slice(0, 8000)]);
    await emit("run", `Done: ${r.title}`, { level: "up", detail: result.slice(0, 400), meta: { requestId: r.id } });
  } catch (e) {
    const msg = (e.stderr || e.message || "error").toString().split("\n")[0].slice(0, 600);
    await q(`UPDATE "AgentRequest" SET status='failed', error=$2, "finishedAt"=now(), "updatedAt"=now() WHERE id=$1`, [r.id, msg]);
    await emit("run", `Failed: ${r.title}`, { level: "down", detail: msg, meta: { requestId: r.id } });
    log("request failed:", r.id, msg);
  }
}

async function processQueue() {
  const { rows } = await q(
    `SELECT * FROM "AgentRequest" WHERE status IN ('queued','approved') ORDER BY "createdAt" ASC LIMIT 3`
  );
  for (const r of rows) await runRequest(r);
}

async function mirrorProfiles() {
  try {
    const out = await hermes(["profile", "list"], { timeout: 15000 });
    // Parse la table texte : lignes de données = 5 colonnes séparées par ≥2 espaces
    const profiles = [];
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length < 3) continue;
      if (/^─+$/.test(parts[0])) continue;
      if (parts[0] === "Profile") continue;
      const name = parts[0].replace(/^◆/, "").trim();
      if (!name) continue;
      profiles.push({
        id: name,
        name,
        model: parts[1] || null,
        gateway: (parts[2] || "unknown").toLowerCase(),
        alias: parts[3] && parts[3] !== "—" ? parts[3] : null,
        distribution: parts[4] && parts[4] !== "—" ? parts[4] : null,
        isCurrent: parts[0].startsWith("◆"),
      });
    }
    await setStore("hermes-profiles", { profiles, syncedAt: new Date().toISOString() });
  } catch (e) { log("profile list failed:", e.message.split("\n")[0]); }
}

/* ─────────────── loops ─────────────── */
async function mirrorTick() {
  try { await mirrorKanban(); } catch (e) { log("mirrorKanban err", e.message); }
  try { await mirrorCrons(); } catch (e) { log("mirrorCrons err", e.message); }
  try { await mirrorHealth(); } catch (e) { log("mirrorHealth err", e.message); }
  try { await mirrorWiki(); } catch (e) { log("mirrorWiki err", e.message); }
  try { await mirrorCost(); } catch (e) { log("mirrorCost err", e.message); }
  try { await mirrorProfiles(); } catch (e) { log("mirrorProfiles err", e.message); }
  try { await maybeDailyBrief(); } catch (e) { log("maybeDailyBrief err", e.message); }
}

async function main() {
  log(`hermes-bridge up · board=${BOARD} · poll=${POLL_MS}ms · mirror=${MIRROR_MS}ms`);
  await emit("status", "Bridge connected", { level: "up" });
  await mirrorTick();
  setInterval(() => mirrorTick().catch((e) => log("mirror loop", e.message)), MIRROR_MS);
  // queue loop
  const tick = async () => { try { await processQueue(); } catch (e) { log("queue loop", e.message); } finally { setTimeout(tick, POLL_MS); } };
  tick();
}
main().catch((e) => { console.error("fatal", e); process.exit(1); });
