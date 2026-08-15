"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, Circle, Clock, FolderKanban, CalendarDays, ListTodo, Plus, X, Check, Loader2 } from "lucide-react";
import { Panel, Pill, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface Task {
  id: number;
  title: string;
  description: string;
  done: boolean;
  priority: number;
  priorityLabel: string;
  project: string;
  projectId: number;
  dueDate: string | null;
  createdAt: string;
}

interface Project {
  id: number;
  title: string;
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: "var(--hq-down)",
  high: "var(--hq-warn)",
  medium: "var(--hq-warn)",
  low: "var(--hq-text-faint)",
  none: "var(--hq-text-ghost)",
};

const PRIORITY_LABEL_FR: Record<string, string> = {
  urgent: "Urgente",
  high: "Haute",
  medium: "Moyenne",
  low: "Basse",
  none: "",
};

function fmtDate(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [projectFilter, setProjectFilter] = useState<number | null>(null);

  // édition inline
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // création
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newProject, setNewProject] = useState<number>(5);
  const [creating, setCreating] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data.items || []);
      setProjects(data.projects || []);
      if (data.projects?.length && !data.projects.some((p: Project) => p.id === newProject)) {
        setNewProject(data.projects[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [newProject]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Toggle done — clic sur le rond
  const toggleDone = async (t: Task) => {
    const prev = tasks;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !t.done }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setTasks(prev); // rollback optimiste
    }
  };

  // Sauvegarde édition
  const saveEdit = async (t: Task) => {
    if (editing !== t.id) return;
    const patch: Record<string, string> = {};
    if (editTitle.trim() !== t.title) patch.title = editTitle.trim();
    if (editDesc !== t.description) patch.description = editDesc;
    if (Object.keys(patch).length === 0) { setEditing(null); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchTasks();
      setEditing(null);
    } catch (e) {
      alert("Échec de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  // Création
  const createTask = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), description: newDesc, project_id: newProject }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewTitle(""); setNewDesc(""); setShowCreate(false);
      await fetchTasks();
    } catch (e) {
      alert("Échec de la création");
    } finally {
      setCreating(false);
    }
  };

  const visible = tasks.filter((t) => {
    if (filter === "open" && t.done) return false;
    if (filter === "done" && !t.done) return false;
    if (projectFilter && t.projectId !== projectFilter) return false;
    return true;
  });

  const openCount = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - openCount;
  const projectCounts = new Map<number, number>();
  for (const t of tasks) if (!t.done) projectCounts.set(t.projectId, (projectCounts.get(t.projectId) || 0) + 1);

  return (
    <>
      <div className="hq-rise pt-4 pb-10" style={rise(0)}>
        <div className="eyebrow mb-2.5">Vikunja</div>
        <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">Tâches</h1>
        <p className="text-[var(--hq-text-ghost)] text-[13px] mt-3">
          {openCount} ouvertes · {doneCount} terminées
        </p>
      </div>

      {/* Filtres + création */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(["open", "done", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium num transition-colors ${
              filter === f ? "bg-[var(--hq-text)] text-[var(--hq-bg)]" : "border border-[var(--hq-hairline)] text-[var(--hq-text-dim)] hover:border-[var(--hq-text-faint)]"
            }`}>
            {f === "open" ? "Ouvertes" : f === "done" ? "Terminées" : "Toutes"}
          </button>
        ))}

        <span className="w-px h-5 bg-[var(--hq-hairline)] mx-1" />

        {projects.map((p) => {
          const active = projectFilter === p.id;
          const n = projectCounts.get(p.id) || 0;
          return (
            <button key={p.id} onClick={() => setProjectFilter(active ? null : p.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] transition-colors ${
                active ? "bg-[var(--accent)] text-[var(--hq-bg)]" : "border border-[var(--hq-hairline)] text-[var(--hq-text-dim)] hover:border-[var(--hq-text-faint)]"
              }`}>
              <FolderKanban className="w-3.5 h-3.5" />
              {p.title}
              {n > 0 && <span className="num opacity-70">({n})</span>}
            </button>
          );
        })}

        <span className="flex-1" />

        <button onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors bg-[var(--accent)] text-[var(--hq-bg)] hover:opacity-90">
          <Plus className="w-3.5 h-3.5" /> Nouvelle tâche
        </button>
      </div>

      {/* Formulaire création */}
      {showCreate && (
        <Panel className="p-4 mb-4 space-y-3">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTask()}
            placeholder="Titre de la tâche…"
            className="w-full bg-transparent text-[14px] font-medium text-[var(--hq-text)] placeholder:text-[var(--hq-text-ghost)] outline-none"
          />
          <textarea
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optionnel)…"
            rows={2}
            className="w-full bg-transparent text-[12.5px] text-[var(--hq-text-dim)] placeholder:text-[var(--hq-text-ghost)] outline-none resize-none"
          />
          <div className="flex items-center gap-2 justify-between">
            <div className="flex gap-1.5 flex-wrap">
              {projects.map((p) => (
                <button key={p.id} onClick={() => setNewProject(p.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
                    newProject === p.id ? "bg-[var(--hq-text)] text-[var(--hq-bg)]" : "border border-[var(--hq-hairline)] text-[var(--hq-text-dim)]"
                  }`}>
                  {p.title}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-full text-[12px] border border-[var(--hq-hairline)] text-[var(--hq-text-dim)] hover:border-[var(--hq-text-faint)]">
                Annuler
              </button>
              <button onClick={createTask} disabled={creating || !newTitle.trim()}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-[var(--accent)] text-[var(--hq-bg)] disabled:opacity-50">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Créer"}
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : error ? (
        <Panel className="p-8"><EmptyState icon={<ListTodo className="w-5 h-5" />} title={`Vikunja inaccessible : ${error}`} /></Panel>
      ) : visible.length === 0 ? (
        <Panel className="p-8"><EmptyState icon={<CheckCircle2 className="w-5 h-5" />} title="Aucune tâche ici." /></Panel>
      ) : (
        <div className="space-y-2">
          {visible.map((t, i) => (
            <div key={t.id} className="hq-rise panel flex items-start gap-3.5 p-4" style={rise(Math.min(i + 1, 8))}>
              {/* Rond cliquable — toggle done */}
              <button
                onClick={() => toggleDone(t)}
                title={t.done ? "Marquer non terminée" : "Marquer terminée"}
                className="shrink-0 mt-0.5 p-0.5 rounded-full transition-transform hover:scale-110 focus:outline-none"
              >
                {t.done ? (
                  <CheckCircle2 className="w-[18px] h-[18px]" style={{ color: "var(--hq-up)" }} />
                ) : (
                  <Circle className="w-[18px] h-[18px]" style={{ color: "var(--hq-text-faint)" }} />
                )}
              </button>

              <div className="flex-1 min-w-0">
                {editing === t.id ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(t); if (e.key === "Escape") setEditing(null); }}
                      className="w-full bg-transparent text-[14px] font-medium text-[var(--hq-text)] outline-none border-b border-[var(--hq-hairline)] focus:border-[var(--accent)] pb-1"
                    />
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      rows={2}
                      placeholder="Description…"
                      className="w-full bg-transparent text-[12.5px] text-[var(--hq-text-dim)] placeholder:text-[var(--hq-text-ghost)] outline-none resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveEdit(t)} disabled={saving}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11.5px] font-medium bg-[var(--accent)] text-[var(--hq-bg)] disabled:opacity-50">
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Enregistrer
                      </button>
                      <button onClick={() => setEditing(null)} className="px-3 py-1 rounded-full text-[11.5px] border border-[var(--hq-hairline)] text-[var(--hq-text-dim)] hover:border-[var(--hq-text-faint)]">
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap" onDoubleClick={() => { setEditing(t.id); setEditTitle(t.title); setEditDesc(t.description); }}>
                      <span className={`text-[14px] font-medium leading-snug ${t.done ? "text-[var(--hq-text-ghost)] line-through" : "text-[var(--hq-text)]"}`}>{t.title}</span>
                      <Pill tone="neutral" className="!text-[10px]">{t.project}</Pill>
                      {t.priority > 0 && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium num border border-[var(--hq-hairline)]"
                          style={{ color: PRIORITY_TONE[t.priorityLabel] }}>{PRIORITY_LABEL_FR[t.priorityLabel]}</span>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-[12.5px] text-[var(--hq-text-ghost)] mt-1 line-clamp-2">{t.description}</p>
                    )}
                    {t.dueDate && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <CalendarDays className="w-3 h-3" style={{ color: "var(--hq-text-faint)" }} />
                        <span className="num text-[11px] text-[var(--hq-text-faint)]">échéance {fmtDate(t.dueDate)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {editing !== t.id && (
                <button
                  onClick={() => { setEditing(t.id); setEditTitle(t.title); setEditDesc(t.description); }}
                  title="Éditer (double-clic aussi)"
                  className="shrink-0 text-[var(--hq-text-ghost)] hover:text-[var(--hq-text)] transition-colors mt-0.5 opacity-0 group-hover:opacity-100"
                  style={{ fontSize: 0 }}
                >
                  <span className="text-[10.5px] num">#{t.id}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
