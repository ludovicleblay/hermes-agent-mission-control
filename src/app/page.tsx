"use client";

import { useEffect, useState } from "react";
import { HermesBriefing } from "@/components/hermes-briefing";

// ── Types ─────────────────────────────────────────────────
interface Process { name: string; status: string; uptime: string }
interface KanbanTask { id: string; title: string; assignee: string; status: string; priority: number }
interface HermesKanban { board: string; slug: string; total: number; counts: Record<string, number>; tasks: KanbanTask[] }

interface HomeData {
  processes: Process[];
  hermesKanban: HermesKanban;
}

const EMPTY: HomeData = {
  processes: [],
  hermesKanban: { board: "Hermes", slug: "hermes", total: 0, counts: {}, tasks: [] },
};

// ── Helpers ───────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  const hrs  = Math.floor(diff / 3600000);
  if (days > 0) return `${days}j`;
  if (hrs  > 0) return `${hrs}h`;
  return "à l'instant";
}

// ── Section label ─────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-[var(--hq-hairline)]" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[var(--hq-text-ghost)] text-[13px] py-8 text-center">{children}</p>;
}

// ── Hermes Kanban ─────────────────────────────────────────
function HermesKanbanPanel({ kanban }: { kanban: HermesKanban }) {
  const statusColor = (s: string) => {
    const k = s.toLowerCase();
    if (k.includes("done") || k.includes("complete")) return "var(--hq-up)";
    if (k.includes("progress") || k.includes("doing")) return "var(--accent)";
    if (k.includes("block")) return "var(--hq-down)";
    return "var(--hq-text-faint)";
  };
  const entries = Object.entries(kanban.counts || {});
  return (
    <div className="panel flex flex-col p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <span className="eyebrow">Hermes Board</span>
          <p className="text-[13px] text-[var(--hq-text-dim)] truncate mt-1">{kanban.board}</p>
        </div>
        <span className="num text-[22px] font-semibold text-[var(--hq-text)] shrink-0">{kanban.total}</span>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {entries.map(([status, count]) => (
            <span key={status} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium num"
              style={{ color: statusColor(status), background: `color-mix(in srgb, ${statusColor(status)} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${statusColor(status)} 22%, transparent)` }}>
              {status} {count}
            </span>
          ))}
        </div>
      )}

      {kanban.tasks.length === 0 ? <Empty>Aucune tâche active.</Empty> : (
        <div className="space-y-0">
          {kanban.tasks.slice(0, 6).map((t) => (
            <a key={t.id} href="/tasks" className="flex items-center gap-3 py-2.5 border-b border-[var(--hq-hairline)] last:border-0 hover:opacity-100 transition-opacity">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor(t.status) }} />
              <p className="text-[13px] text-[var(--hq-text-dim)] leading-snug line-clamp-1 flex-1 group-hover:text-[var(--hq-text)]">{t.title}</p>
              {t.assignee && <span className="num text-[10.5px] text-[var(--hq-text-ghost)] shrink-0">{t.assignee}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agents strip ──────────────────────────────────────────
function AgentsStrip({ processes }: { processes: Process[] }) {
  if (processes.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="eyebrow mr-1">System</span>
      {processes.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1.5">
          <span className="relative flex w-1.5 h-1.5">
            {p.status === "online" && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />}
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: p.status === "online" ? "var(--up)" : "var(--down)" }} />
          </span>
          <span className="text-[var(--hq-text-dim)] text-[12px]">{p.name}</span>
          <span className="num text-[var(--hq-text-ghost)] text-[10px]">{p.uptime}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<HomeData>(EMPTY);
  const [time, setTime] = useState(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetch("/api/home")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData({ processes: d.processes || [], hermesKanban: d.hermesKanban || EMPTY.hermesKanban }); })
      .catch(() => {});
    const iv = setInterval(() => {
      fetch("/api/home").then(r => r.ok ? r.json() : null).then(d => { if (d) setData({ processes: d.processes || [], hermesKanban: d.hermesKanban || EMPTY.hermesKanban }); }).catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  if (!mounted) return null;

  const rise = (i: number) => ({ animationDelay: `${i * 60}ms` });

  return (
    <>
      <div className="relative z-10 w-full mx-auto pb-16">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="hq-rise pt-4 pb-10 flex flex-wrap items-end justify-between gap-6" style={rise(0)}>
          <div>
            <div className="eyebrow mb-2.5">{greeting()}</div>
            <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">{process.env.NEXT_PUBLIC_OWNER_NAME || "Ludo"}</h1>
            <p className="num text-[var(--hq-text-ghost)] text-[12.5px] mt-3">
              {time.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              {"  ·  "}
              {time.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--hq-hairline)] bg-white/[0.02] px-2.5 py-1">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--up)" }} />
              </span>
              <span className="eyebrow !text-[9.5px] !text-[var(--hq-text-faint)]">Live</span>
            </div>
          </div>
        </div>

        {/* ── Brief matinal ───────────────────────────────── */}
        <div className="mt-5 hq-rise" style={rise(1)}>
          <HermesBriefing />
        </div>

        {/* ── Hermes board ───────────────────────────────── */}
        <div className="mt-14">
          <SectionLabel>Board</SectionLabel>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="hq-rise" style={rise(3)}><HermesKanbanPanel kanban={data.hermesKanban} /></div>
          </div>
        </div>

        {/* ── Agents strip ────────────────────────────────── */}
        <div className="mt-14">
          <AgentsStrip processes={data.processes} />
        </div>
      </div>
    </>
  );
}
