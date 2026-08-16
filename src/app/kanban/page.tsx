"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  RefreshCw,
  X,
  LayoutGrid,
  ShieldAlert,
  Send,
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

const COLUMN_LABEL: Record<string, string> = {
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  done: "Done",
};
const COLUMN_ORDER = ["ready", "running", "blocked", "done"];
const columnFor = (s: string) =>
  COLUMN_LABEL[s] ? s : ["running", "blocked"].includes(s) ? s : s === "done" ? "done" : "ready";
const columnTone = (c: string) =>
  c === "running" ? "accent" : c === "blocked" ? "warn" : c === "done" ? "up" : "neutral";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
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

// ── Détail d'une carte ────────────────────────────────────
function TaskDetail({ task, onClose, onValidated }: { task: Task; onClose: () => void; onValidated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const unblock = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch("/api/hermes/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "kanban.unblock",
          title: `kanban unblock ${task.id}`,
          prompt: JSON.stringify({ task_id: task.id, reason: "Validée manuellement depuis Hermy" }),
        }),
      });
      if (r.ok) {
        setNote("✅ Validation envoyée — le worker va reprendre dans ~1 min.");
        setTimeout(onValidated, 2500);
      } else {
        setNote("⚠️ Échec de l'envoi de la validation.");
      }
    } catch {
      setNote("⚠️ Erreur réseau.");
    } finally {
      setBusy(false);
    }
  };

  // extrait les comments du détail (sortie `hermes kanban show`)
  const comments = task.detail
    ? [...task.detail.matchAll(/\[(.*?)\] (\w+): ([\s\S]*?)(?=\n\s*\[|\n\n|$)/g)].map((m) => ({
        when: m[1], who: m[2], text: m[3].trim(),
      }))
    : [];

  return (
    <Panel className="p-5 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={task.status === "blocked" ? "warn" : "neutral"}>{task.status}</Pill>
          {task.assignee && <Pill tone="neutral">{task.assignee}</Pill>}
          {task.priority != null && task.priority > 0 && (
            <Pill tone="neutral">P{task.priority}</Pill>
          )}
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

      {comments.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Comments ({comments.length})</Eyebrow>
          <div className="mt-2 space-y-2.5">
            {comments.map((c, i) => (
              <div key={i} className="rounded-[10px] border border-[var(--line)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[10.5px] font-semibold text-[var(--text-2)]">{c.who}</span>
                  <span className="num text-[10px] text-[var(--text-3)]">{c.when}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-[var(--text-2)] leading-snug whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {task.result && (
        <div className="mt-4">
          <Eyebrow>Résultat</Eyebrow>
          <p className="mt-1.5 text-[12.5px] text-[var(--text-2)] leading-snug whitespace-pre-wrap">{task.result}</p>
        </div>
      )}

      {note && <p className="mt-3 text-[12.5px] text-[var(--text-2)]">{note}</p>}

      {task.status === "blocked" && (
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={unblock}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition-colors"
            style={{
              color: "var(--up)",
              border: "1px solid color-mix(in srgb, var(--up) 35%, transparent)",
              background: "color-mix(in srgb, var(--up) 10%, transparent)",
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Check className="w-3.5 h-3.5" />
            {busy ? "Validation…" : "✅ Valider (débloquer)"}
          </button>
        </div>
      )}
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
        flash(`Carte créée — le dispatcher va la prendre (assignee: ${assignee || "triage"}).`);
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
        return (
          <div key={col} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <Eyebrow>{COLUMN_LABEL[col]}</Eyebrow>
              <span className="num text-[11px] text-[var(--text-3)]">{groups[col].length}</span>
            </div>
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start mt-12">
          <Board tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
          <div>
            {selected ? (
              <TaskDetail task={selected} onClose={() => setSelectedId(null)} onValidated={load} />
            ) : (
              <Panel className="p-5 text-[13px] text-[var(--text-3)]">
                Clique sur une carte pour lire les instructions, les commentaires et la raison du blocage avant de valider.
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
