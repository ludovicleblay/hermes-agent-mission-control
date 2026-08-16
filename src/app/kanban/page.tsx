"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  RefreshCw,
  X,
  LayoutGrid,
  ShieldAlert,
  Send,
  Paperclip,
  MessageSquare,
  UserCog,
  Flag,
  CircleCheck,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Panel,
  SectionHeader,
  Button,
  Pill,
  EmptyState,
  Skeleton,
  Eyebrow,
} from "@/components/ui/kit";

// ── Types ─────────────────────────────────────────────────
type Task = {
  id: string;
  board: string;
  title: string;
  body: string | null;
  detail: string | null;
  assignee: string | null;
  status: string;
  priority: number | null;
  result: string | null;
  syncedAt: string;
};

type DetailJSON = {
  task?: Record<string, unknown>;
  latest_summary?: string | null;
  comments?: { author: string; body: string; created_at: number }[];
  events?: { kind: string; payload: Record<string, unknown> | null; created_at: number; run_id: number | null }[];
  attachments?: { id: number; filename: string; size: number; uploaded_by: string; created_at: number }[];
  runs?: {
    id: number; profile: string; status: string; outcome: string;
    worker_pid: number | null; started_at: number | null; ended_at: number | null;
    summary: string | null; error: string | null;
  }[];
  child_results?: { id: string; title: string; status: string; latest_summary: string | null }[];
};

const COLUMN_LABEL: Record<string, string> = {
  triage: "Triage",
  todo: "To do",
  ready: "Ready",
  running: "Running",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};
const COLUMN_ORDER = ["triage", "todo", "ready", "running", "review", "blocked", "done"];
const columnFor = (s: string) =>
  COLUMN_LABEL[s] ? s : ["running", "blocked", "review"].includes(s) ? s : s === "done" ? "done" : "ready";
const columnTone = (c: string) =>
  c === "running" ? "accent" : c === "blocked" ? "warn" : c === "done" ? "up" : c === "review" ? "warn" : "neutral";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function epochAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const s = Math.max(0, (Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function fmtDur(start: number | null, end: number | null): string {
  if (!start) return "—";
  const e = end || Math.floor(Date.now() / 1000);
  const s = Math.max(0, e - start);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m${s % 60}s`;
  return `${Math.round(s / 3600)}h${Math.round((s % 3600) / 60)}m`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function parseDetail(detail: string | null): DetailJSON {
  if (!detail) return {};
  try {
    const d = JSON.parse(detail);
    return typeof d === "object" && d !== null ? (d as DetailJSON) : {};
  } catch {
    return {};
  }
}

function runTone(r: { status: string; outcome: string; error: string | null }): { label: string; tone: "up" | "down" | "warn" | "neutral" | "accent" } {
  if (r.outcome === "completed" || r.status === "done") return { label: "completed", tone: "up" };
  if (r.outcome === "crashed" || r.outcome === "failed" || r.error || r.outcome === "errored") return { label: r.error ? "failed" : r.outcome, tone: "down" };
  if (r.outcome === "reclaimed" || r.outcome === "terminated" || r.outcome === "killed") return { label: r.outcome, tone: "warn" };
  if (r.status === "running" || r.outcome === "running") return { label: "running", tone: "accent" };
  return { label: r.outcome || r.status, tone: "neutral" };
}

// ── Détail d'une carte ────────────────────────────────────
function TaskDetail({ task, onClose, onValidated }: { task: Task; onClose: () => void; onValidated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [direction, setDirection] = useState("");
  const [comment, setComment] = useState("");
  const [newAssignee, setNewAssignee] = useState(task.assignee || "jarvis");
  const detail = parseDetail(task.detail);
  const comments = detail.comments || [];
  const runs = detail.runs || [];
  const events = detail.events || [];
  const attachments = detail.attachments || [];
  const children = detail.child_results || [];
  const latestSummary = detail.latest_summary || task.result;

  const dispatch = async (kind: string, prompt: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/hermes/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: `${kind} ${task.id}`, prompt: JSON.stringify(prompt) }),
      });
      if (r.ok) {
        setNote(`✅ ${okMsg} — synchronisation dans ~1 min.`);
        setTimeout(onValidated, 2000);
      } else {
        setNote("⚠️ Échec de l'envoi.");
      }
    } catch {
      setNote("⚠️ Erreur réseau.");
    } finally {
      setBusy(false);
    }
  };

  const unblock = () =>
    dispatch(
      "kanban.unblock",
      { task_id: task.id, reason: direction.trim() ? `Validée manuellement — ${direction.trim()}` : "Validée manuellement depuis Hermy", direction: direction.trim() || undefined },
      "Validation envoyée — le worker va reprendre dans ~1 min."
    );

  const addComment = () => {
    if (!comment.trim()) return;
    dispatch("kanban.comment", { task_id: task.id, body: comment.trim(), author: "Ludo" }, "Commentaire envoyé.").then(() => setComment(""));
  };

  const reassign = () => {
    if (!newAssignee) return;
    dispatch("kanban.reassign", { task_id: task.id, profile: newAssignee }, `Réassignation à ${newAssignee} envoyée.`);
  };

  const complete = () =>
    dispatch("kanban.complete", { task_id: task.id, summary: latestSummary || undefined }, "Carte marquée done.");

  const block = () =>
    dispatch("kanban.block", { task_id: task.id, reason: direction.trim() || "Blocage manuel depuis Hermy" }, "Carte bloquée.");

  const isBlocked = task.status === "blocked";
  const isDone = task.status === "done";
  const isRunning = task.status === "running";

  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={task.status === "blocked" ? "warn" : task.status === "running" ? "accent" : task.status === "done" ? "up" : "neutral"}>{task.status}</Pill>
          {task.assignee && <Pill tone="neutral">{task.assignee}</Pill>}
          {task.priority != null && task.priority > 0 && <Pill tone="neutral">P{task.priority}</Pill>}
          {runs.length > 0 && <Pill tone="neutral">{runs.length} run{runs.length > 1 ? "s" : ""}</Pill>}
          {attachments.length > 0 && <Pill tone="neutral">{attachments.length} 📎</Pill>}
          {children.length > 0 && <Pill tone="neutral">{children.length} enfants</Pill>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost w-8 h-8 inline-flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
      </div>

      <h2 className="text-[16px] font-semibold text-[var(--text)] leading-snug">{task.title}</h2>
      <span className="num text-[10.5px] text-[var(--text-3)]">{task.id} · synced {timeAgo(task.syncedAt)}</span>

      {task.body && (
        <div className="mt-4">
          <Eyebrow>Instructions</Eyebrow>
          <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug whitespace-pre-wrap">{task.body}</p>
        </div>
      )}

      {/* Résumé du worker */}
      {latestSummary && (
        <div className="mt-4">
          <Eyebrow>Résumé</Eyebrow>
          <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug whitespace-pre-wrap">{latestSummary}</p>
        </div>
      )}

      {/* Runs — historique d'exécution (crash détectable ici) */}
      {runs.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Runs ({runs.length})</Eyebrow>
          <div className="mt-2 space-y-2">
            {runs.map((r) => {
              const t = runTone(r);
              return (
                <div key={r.id} className="rounded-[10px] border border-[var(--line)] p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: t.tone === "down" ? "var(--down)" : t.tone === "warn" ? "var(--warn)" : t.tone === "up" ? "var(--up)" : t.tone === "accent" ? "var(--accent)" : "var(--text-3)" }}
                      />
                      <span className="num text-[11px] font-semibold text-[var(--text-2)]">#{r.id} · {r.profile}</span>
                      <span className="num text-[10.5px] text-[var(--text-3)]">pid {r.worker_pid || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num text-[10.5px]" style={{ color: t.tone === "down" ? "var(--down)" : t.tone === "warn" ? "var(--warn)" : t.tone === "up" ? "var(--up)" : "var(--text-2)" }}>
                        {t.label}
                      </span>
                      <span className="num text-[10.5px] text-[var(--text-3)]">{fmtDur(r.started_at, r.ended_at)}</span>
                      <span className="num text-[10px] text-[var(--text-3)]">il y a {epochAgo(r.ended_at || r.started_at)}</span>
                    </div>
                  </div>
                  {r.error && (
                    <p className="mt-2 text-[12px] text-[var(--down)] leading-snug whitespace-pre-wrap break-words">❌ {r.error}</p>
                  )}
                  {r.summary && !r.error && (
                    <p className="mt-2 text-[12px] text-[var(--text-2)] leading-snug whitespace-pre-wrap line-clamp-4">{r.summary}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pièces jointes */}
      {attachments.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Pièces jointes ({attachments.length})</Eyebrow>
          <div className="mt-2 space-y-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] px-3 py-2">
                <Paperclip className="w-3.5 h-3.5 shrink-0 text-[var(--text-3)]" />
                <a
                  href={`/api/hermes/kanban-attachment/${a.id}?board=${encodeURIComponent(task.board || "default")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] text-[var(--accent)] hover:underline truncate flex-1"
                >
                  {a.filename}
                </a>
                <span className="num text-[10.5px] text-[var(--text-3)] shrink-0">{fmtSize(a.size)}</span>
                <span className="num text-[10px] text-[var(--text-3)] shrink-0">par {a.uploaded_by}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commentaires */}
      {comments.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Comments ({comments.length})</Eyebrow>
          <div className="mt-2 space-y-2.5">
            {comments.map((c, i) => (
              <div key={i} className="rounded-[10px] border border-[var(--line)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[10.5px] font-semibold text-[var(--text-2)]">{c.author}</span>
                  <span className="num text-[10px] text-[var(--text-3)]">il y a {epochAgo(c.created_at)}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-[var(--text-2)] leading-snug whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Événements récents (condensés) */}
      {events.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Événements ({events.length})</Eyebrow>
          <div className="mt-2 flex flex-col gap-1 max-h-[180px] overflow-auto">
            {events.slice(-25).map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-[11.5px]">
                <span className="num text-[10px] text-[var(--text-3)] shrink-0">{epochAgo(e.created_at)}</span>
                <span className="num text-[10.5px] text-[var(--text-2)] shrink-0">{e.kind}</span>
                <span className="text-[11px] text-[var(--text-3)] truncate">
                  {e.payload
                    ? Object.entries(e.payload).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enfants */}
      {children.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Enfants ({children.length})</Eyebrow>
          <div className="mt-2 space-y-1.5">
            {children.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-[8px] border border-[var(--line)] px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.status === "done" ? "var(--up)" : c.status === "running" ? "var(--accent)" : c.status === "blocked" ? "var(--warn)" : "var(--text-3)" }} />
                <span className="num text-[10.5px] text-[var(--text-3)] shrink-0">{c.id}</span>
                <span className="text-[12px] text-[var(--text-2)] truncate flex-1">{c.title}</span>
                <span className="num text-[10.5px] text-[var(--text-3)] shrink-0">{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 pt-4 border-t border-[var(--line)]">
        <div className="flex flex-col gap-3">
          {/* Commenter */}
          <div className="flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(); } }}
              placeholder="Laisser un commentaire… (auteur : Ludo)"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text-2)] placeholder:text-[var(--text-3)] px-3.5 py-2 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none"
            />
            <button
              type="button"
              onClick={addComment}
              disabled={busy || !comment.trim()}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-semibold transition-colors"
              style={{ color: "var(--text-2)", border: "1px solid var(--line)", opacity: busy || !comment.trim() ? 0.5 : 1 }}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Commenter
            </button>
          </div>

          {/* Réassigner */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[var(--text-3)] flex items-center gap-1"><UserCog className="w-3.5 h-3.5" /> Assigné :</span>
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              className="bg-transparent text-[12px] text-[var(--text-2)] px-2.5 py-1.5 rounded-[8px] border border-[var(--line)] outline-none"
            >
              <option value="jarvis">jarvis 🧠</option>
              <option value="toad">toad 🍄</option>
              <option value="">non assignée</option>
            </select>
            <button
              type="button"
              onClick={reassign}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
              style={{ color: "var(--text-2)", border: "1px solid var(--line)", opacity: busy ? 0.5 : 1 }}
            >
              Réassigner
            </button>
            {!isDone && !isRunning && (
              <button
                type="button"
                onClick={complete}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ml-auto"
                style={{ color: "var(--up)", border: "1px solid color-mix(in srgb, var(--up) 35%, transparent)", opacity: busy ? 0.5 : 1 }}
              >
                <CircleCheck className="w-3.5 h-3.5" /> Marquer done
              </button>
            )}
            {!isDone && !isBlocked && !isRunning && (
              <button
                type="button"
                onClick={block}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors"
                style={{ color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 35%, transparent)", opacity: busy ? 0.5 : 1 }}
              >
                <Flag className="w-3.5 h-3.5" /> Bloquer
              </button>
            )}
          </div>

          {/* Zone validation (carte bloquée) */}
          {isBlocked && (
            <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_6%,transparent)] p-3">
              <Eyebrow>Décision requise</Eyebrow>
              <textarea
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                rows={2}
                placeholder="Consigne pour l'agent (ex : méthode B, ou précision sur ce que tu veux)… optionnel"
                className="w-full mt-2 bg-transparent text-[13px] text-[var(--text-2)] placeholder:text-[var(--text-3)] px-3.5 py-2.5 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none resize-y"
              />
              <button
                type="button"
                onClick={unblock}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors"
                style={{
                  color: "var(--up)",
                  border: "1px solid color-mix(in srgb, var(--up) 35%, transparent)",
                  background: "color-mix(in srgb, var(--up) 10%, transparent)",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Check className="w-3.5 h-3.5" />
                {busy ? "Validation…" : direction.trim() ? "Valider avec cette consigne" : "✅ Valider (débloquer)"}
              </button>
            </div>
          )}

          {note && <p className="text-[12.5px] text-[var(--text-2)]">{note}</p>}
        </div>
      </div>
    </Panel>
  );
}

// ── Création de carte kanban ─────────────────────────────
function CreateCard({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("jarvis");
  const [priority, setPriority] = useState(3);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        kind: "kanban",
        title: t,
        assignee,
        priority,
      };
      if (body.trim()) payload.body = body.trim();
      const r = await fetch("/api/hermes/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        setTitle("");
        setBody("");
        flash(`Carte créée — le dispatcher va la prendre (assignee: ${assignee || "jarvis"}).`);
        setTimeout(onDone, 2500);
      } else {
        flash("Échec de la création. Réessaie.");
      }
    } catch {
      flash("Échec de la création. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder="Titre de la carte kanban…"
          className="w-full bg-transparent text-[14px] text-[var(--text)] placeholder:text-[var(--text-3)] px-3.5 py-2.5 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none transition-colors"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="bg-transparent text-[12.5px] text-[var(--text-2)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none"
          >
            <option value="jarvis">jarvis 🧠</option>
            <option value="toad">toad 🍄</option>
            <option value="">non assignée (triage)</option>
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="bg-transparent text-[12.5px] text-[var(--text-2)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none"
          >
            {[5, 4, 3, 2, 1].map((p) => (
              <option key={p} value={p}>Priorité P{p}</option>
            ))}
          </select>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Description / instructions pour l'agent…"
          className="w-full bg-transparent text-[13px] text-[var(--text-2)] placeholder:text-[var(--text-3)] px-3.5 py-2.5 rounded-[10px] border border-[var(--line)] focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] outline-none resize-y"
        />
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={submit} disabled={busy || !title.trim()}>
            <Send className="w-3.5 h-3.5" />
            {busy ? "Création…" : "Créer la carte"}
          </Button>
        </div>
      </div>
      {toast && (
        <p className="mt-3 text-[12.5px] text-[var(--text-2)] flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" style={{ color: "var(--up)" }} />
          {toast}
        </p>
      )}
    </Panel>
  );
}

// ── Board ─────────────────────────────────────────────────
function Board({ tasks, selectedId, onSelect }: { tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    const col = columnFor(t.status);
    (groups[col] ||= []).push(t);
  }
  const cols = COLUMN_ORDER.filter((c) => groups[c]?.length);

  // Colonnes repliées par défaut : « done » est repliée (elle prend de la place,
  // on suit surtout le travail en cours). Cliquer sur l'en-tête replie/déplie.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true });
  const toggleCol = (col: string) => setCollapsed((c) => ({ ...c, [col]: !c[col] }));

  if (tasks.length === 0) {
    return (
      <Panel className="p-2">
        <EmptyState
          icon={<LayoutGrid className="w-6 h-6" />}
          title="Aucune carte sur le board"
          hint="Crée une carte depuis Hermes → DispatchBar, ou pose-la dans un autre profil."
        />
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cols.map((col) => {
        const tone = columnTone(col);
        const isCollapsed = !!collapsed[col];
        return (
          <div key={col} className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => toggleCol(col)}
              title={isCollapsed ? `Déplier ${COLUMN_LABEL[col]}` : `Replier ${COLUMN_LABEL[col]}`}
              className="flex items-center justify-between px-1 w-full text-left group cursor-pointer"
            >
              <span className="flex items-center gap-1">
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-3)] group-hover:text-[var(--text-2)] transition-colors" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-3)] group-hover:text-[var(--text-2)] transition-colors" />
                )}
                <Eyebrow>{COLUMN_LABEL[col]}</Eyebrow>
              </span>
              <span className="num text-[11px] text-[var(--text-3)]">{groups[col].length}</span>
            </button>
            {!isCollapsed && (
              <div className="flex flex-col gap-2.5">
                {groups[col]
                  .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onSelect(t.id)}
                      className="panel p-3.5 text-left cursor-pointer transition-opacity hover:opacity-90"
                      style={{
                        borderLeft: `2px solid color-mix(in srgb, ${
                          tone === "neutral" ? "var(--text-3)" : `var(--${tone})`
                        } 55%, transparent)`,
                        outline: selectedId === t.id ? "1px solid color-mix(in srgb, var(--accent) 50%, transparent)" : undefined,
                      }}
                    >
                      <p className="text-[13px] text-[var(--text)] leading-snug line-clamp-2">{t.title}</p>
                      <div className="flex items-center gap-2 mt-2.5">
                        {t.assignee && (
                          <span className="num text-[10.5px] text-[var(--text-3)]">{t.assignee}</span>
                        )}
                        {t.status === "blocked" && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--warn, #eab308)]">
                            <ShieldAlert className="w-3 h-3" /> en attente
                          </span>
                        )}
                        {t.priority != null && t.priority > 0 && (
                          <span className="num text-[10.5px] text-[var(--text-3)] ml-auto">P{t.priority}</span>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────
export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const tk = await getJSON<{ tasks: Task[]; total: number; lastSync: string }>("/api/hermes/tasks");
    if (tk) {
      setTasks(tk.tasks ?? []);
      setTotal(tk.total ?? tk.tasks?.length ?? 0);
      setLastSync(tk.lastSync ?? null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, [load]);

  // Sélection depuis l'URL (ex. lien du Dashboard : /kanban?task=<id>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const task = params.get("task");
    if (task) setSelectedId(task);
  }, []);

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      {/* Header */}
      <div className="hq-rise pt-4 pb-8 flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Agent runtime</Eyebrow>
          <h1 className="mt-2.5 text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            Kanban
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="num text-[12px] text-[var(--text-2)]">{total} cartes</span>
          <span className="num text-[11px] text-[var(--text-3)]">synced {timeAgo(lastSync)}</span>
          <button type="button" onClick={manualRefresh} aria-label="Refresh" className="btn-ghost inline-flex items-center justify-center w-9 h-9">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Création de carte */}
      <div className="hq-rise">
        <CreateCard onDone={load} />
      </div>

      {!loaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6 mt-12">
          {/* Board : cartes par statut */}
          <Board tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />

          {/* Détail de la carte sélectionnée (pleine largeur, sous le board) */}
          {selected ? (
            <TaskDetail task={selected} onClose={() => setSelectedId(null)} onValidated={load} />
          ) : (
            <Panel className="p-5 text-[13px] text-[var(--text-3)]">
              Clique sur une carte pour lire les instructions, le résumé, les runs (crashs inclus), les pièces jointes et les commentaires — et pour agir (commenter, réassigner, valider, bloquer).
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
