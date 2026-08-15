"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, Circle, Clock, FolderKanban, CalendarDays, ListTodo } from "lucide-react";
import { Panel, Pill, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface Task {
  id: number;
  title: string;
  description: string;
  done: boolean;
  dueDate: string | null;
  priority: string;
  priorityRaw: number;
  project: string;
  projectId: number;
  created: string | null;
}

interface Project {
  id: number;
  title: string;
}

const PRIORITY_TONE: Record<string, string> = {
  Critical: "var(--hq-down)",
  Urgent: "var(--hq-down)",
  High: "var(--hq-warn)",
  Medium: "var(--hq-warn)",
  Low: "var(--hq-text-faint)",
  None: "var(--hq-text-ghost)",
};

const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  todo: { label: "À faire", tone: "accent" },
  doing: { label: "En cours", tone: "warn" },
  done: { label: "Terminé", tone: "up" },
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

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks || []);
      setProjects(data.projects || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

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

      {/* Filtres */}
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
      </div>

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
              {t.done ? (
                <CheckCircle2 className="w-4.5 h-4.5 shrink-0 mt-0.5" style={{ color: "var(--hq-up)" }} />
              ) : (
                <Circle className="w-4.5 h-4.5 shrink-0 mt-0.5" style={{ color: "var(--hq-text-faint)" }} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-medium text-[var(--hq-text)] leading-snug">{t.title}</span>
                  <Pill tone="neutral" className="!text-[10px]">{t.project}</Pill>
                  {t.priorityRaw > 0 && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium num border border-[var(--hq-hairline)]"
                      style={{ color: PRIORITY_TONE[t.priority] }}>{t.priority}</span>
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
              </div>
              <span className="num text-[10.5px] text-[var(--hq-text-ghost)] shrink-0 mt-0.5">#{t.id}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
