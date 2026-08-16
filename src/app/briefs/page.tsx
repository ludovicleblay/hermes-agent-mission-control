"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Newspaper, Search, Loader2, ArrowLeft, CalendarDays, FileText } from "lucide-react";
import { Panel, Skeleton, EmptyState, Pill } from "@/components/ui/kit";

interface Brief {
  id: string;
  title: string;
  text: string;
  updatedAt: string;
  url: string;
}

function fmtDate(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function parseTitle(title: string): { date: string; label: string } {
  const m = title.match(/Brief matinal — (\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [y, mo, da] = m[1].split("-");
    const d = new Date(Number(y), Number(mo) - 1, Number(da));
    return {
      date: m[1],
      label: d.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    };
  }
  return { date: "", label: title };
}

// Rendu markdown léger : headers, gras, listes, séparateurs → blocs simples
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${key++}`} className="space-y-1 my-2">
          {list.map((li, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed">
              <span className="text-[var(--accent)] shrink-0">•</span>
              <span>{li}</span>
            </li>
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const li = line.match(/^[-*•]\s+(.*)/);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flushList();
    const clean = line
      .replace(/\*\*(.*?)\*\*/g, (_, s) => `**${s}**`)
      .replace(/`(.*?)`/g, "$1");
    if (/^#{1,3}\s/.test(clean)) {
      const m = clean.match(/^(#{1,3})\s/);
      const level = m ? m[1].length : 1;
      const text = clean.replace(/^#{1,3}\s/, "");
      if (level === 1) {
        out.push(
          <h2 key={key++} className="text-[15px] font-bold mt-5 mb-2 text-[var(--text)] tracking-[-0.01em]">
            {text}
          </h2>
        );
      } else {
        out.push(
          <h3 key={key++} className="text-[13.5px] font-semibold mt-4 mb-1.5 text-[var(--text-2)]">
            {text}
          </h3>
        );
      }
    } else if (/^---+\s*$/.test(clean)) {
      out.push(<hr key={key++} className="my-3 border-[var(--line)]" />);
    } else {
      out.push(
        <p key={key++} className="text-[13.5px] leading-relaxed my-1">
          {clean}
        </p>
      );
    }
  }
  flushList();
  return out;
}

export default function BriefsPage() {
  const [items, setItems] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<Brief | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce recherche (400ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebounced(query), 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const fetchBriefs = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetch(`/api/briefs${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e: any) {
      setError(e.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBriefs(debounced);
  }, [debounced, fetchBriefs]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--surface-2)] flex items-center justify-center">
            <Newspaper className="w-[18px] h-[18px] text-[var(--text)]" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">
              Briefs matinaux
            </h1>
            <p className="text-[12px] text-[var(--text-3)]">
              Historique des rapports quotidiens — archivé sur Outline
            </p>
          </div>
        </div>
        <Pill tone="neutral">{items.length} brief{items.length > 1 ? "s" : ""}</Pill>
      </div>

      {/* Search */}
      <div className="px-6 pb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-3)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher dans les briefs (contenu plein texte)…"
            className="w-full bg-[var(--surface-1)] border border-[var(--line)] rounded-xl pl-9 pr-4 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-8">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : error ? (
          <EmptyState
            title="Outline injoignable"
            hint={error}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={debounced ? "Aucun résultat" : "Pas encore de briefs"}
            hint={
              debounced
                ? `Rien ne correspond à « ${debounced} »`
                : "Le premier brief archivé apparaîtra ici (archivage automatique chaque matin à 07h20)."
            }
          />
        ) : selected ? (
          /* Vue détail */
          <div className="max-w-3xl">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour à la liste
            </button>
            <Panel className="!p-6">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-[var(--text-3)]" />
                <span className="text-[12px] text-[var(--text-3)]">
                  {fmtDate(selected.updatedAt)}
                </span>
              </div>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text)] mb-4">
                {selected.title}
              </h2>
              <div className="space-y-0.5">
                {renderMarkdown(selected.text || "")}
              </div>
              {selected.url && (
                <a
                  href={`https://outline.leblay.cloud${selected.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-5 text-[12px] text-[var(--accent)] hover:underline"
                >
                  Ouvrir dans Outline ↗
                </a>
              )}
            </Panel>
          </div>
        ) : (
          /* Vue liste */
          <div className="space-y-1.5 max-w-3xl">
            {items.map((b) => {
              const meta = parseTitle(b.title);
              return (
                <button
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--surface-1)] border border-[var(--line)] hover:border-[var(--accent)] transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                    <CalendarDays className="w-4 h-4 text-[var(--text-2)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text)] truncate">
                      {meta.label || meta.date || b.title}
                    </div>
                    <div className="text-[11.5px] text-[var(--text-3)] truncate">
                      {(b.text || "").split("\n").find((l) => l.trim().startsWith("☀️") || l.trim().startsWith("#"))?.replace(/^#+\s*/, "") || meta.date}
                    </div>
                  </div>
                  <span className="text-[11px] text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0">
                    {meta.date || ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
