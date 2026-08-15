"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Search,
  RefreshCw,
  Users,
  MessageSquare,
  Sparkles,
  Layers,
  ChevronRight,
  Clock,
  CheckCircle2,
} from "lucide-react";
import {
  Panel,
  SectionHeader,
  Button,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui/kit";

// ── Types ─────────────────────────────────────────────────
interface Workspace {
  id: string;
  created_at: string;
}

interface Peer {
  id: string;
  created_at: string;
}

interface Session {
  id: string;
  is_active: boolean;
  created_at: string;
}

interface Conclusion {
  id: string;
  content: string;
  observer_id: string;
  observed_id: string;
  session_id: string;
  level: string;
  created_at: string;
}

interface SearchResult {
  results?: { content?: string; conclusion?: string; message?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

interface CardResponse {
  peer_card?: string[] | string | null;
  card?: string[] | string | null;
  [k: string]: unknown;
}

interface ContextResponse {
  summary?: string;
  card?: unknown;
  representation?: string | Record<string, unknown> | unknown[] | null;
  [k: string]: unknown;
}

interface Msg {
  id: string;
  content?: string;
  role?: string;
  is_user?: boolean;
  created_at?: string;
}

// ── Helpers ───────────────────────────────────────────────
function timeAgo(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function api<T>(action: string, params: Record<string, string> = {}, body?: unknown): Promise<T | null> {
  try {
    if (body !== undefined) {
      const r = await fetch("/api/hermes/honcho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...params, ...body }),
      });
      return r.ok ? ((await r.json()) as T) : null;
    }
    const qs = new URLSearchParams({ action, ...params });
    const r = await fetch(`/api/hermes/honcho?${qs.toString()}`);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function fmtCard(card: string[] | string | null | undefined): string[] {
  if (!card) return [];
  if (Array.isArray(card)) return card;
  return card.split("\n").filter(Boolean);
}

// ── Page ──────────────────────────────────────────────────
export default function MemoryDialecticPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [ws, setWs] = useState("hermes_jarvis_cloud");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conclusions, setConclusions] = useState<Conclusion[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [searchRes, setSearchRes] = useState<SearchResult | null>(null);
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [peerCard, setPeerCard] = useState<CardResponse | null>(null);
  const [peerCtx, setPeerCtx] = useState<ContextResponse | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [sessionMsgs, setSessionMsgs] = useState<Msg[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<unknown[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Load workspaces once ──
  useEffect(() => {
    (async () => {
      const r = await api<{ items: Workspace[] }>("workspaces");
      if (r?.items?.length) {
        setWorkspaces(r.items);
        const preferred = r.items.find((w) => w.id === "hermes_jarvis_cloud");
        setWs(preferred?.id ?? r.items[0].id);
      } else {
        setErr("Impossible de joindre l'API Honcho locale");
      }
      setLoading(false);
    })();
  }, []);

  // ── Load peers + conclusions + sessions when ws changes ──
  const load = useCallback(async (workspace: string) => {
    setLoading(true);
    setErr(null);
    const [p, c, s] = await Promise.all([
      api<{ items: Peer[] }>("peers", { workspace }),
      api<{ items: Conclusion[] }>("conclusions", { workspace }),
      api<{ items: Session[] }>("sessions", { workspace, peer: "jarvis" }),
    ]);
    setPeers(p?.items ?? []);
    setConclusions(c?.items ?? []);
    setSessions(s?.items ?? []);
    setSelectedPeer(null);
    setSelectedSession(null);
    setPeerCard(null);
    setPeerCtx(null);
    setSessionMsgs([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (ws) void load(ws);
  }, [ws, load]);

  // ── Peer detail (card + context) ──
  const openPeer = useCallback(async (peer: string) => {
    setSelectedPeer(peer);
    setDetailLoading(true);
    const [card, ctx] = await Promise.all([
      api<CardResponse>("card", { workspace: ws, peer }),
      api<ContextResponse>("context", { workspace: ws, peer }),
    ]);
    setPeerCard(card);
    setPeerCtx(ctx);
    setDetailLoading(false);
  }, [ws]);

  // ── Session detail (messages + summaries) ──
  const openSession = useCallback(async (session: string) => {
    setSelectedSession(session);
    setDetailLoading(true);
    const [msgs, sums] = await Promise.all([
      api<{ items: Msg[] }>("messages", { workspace: ws, session }),
      api<unknown[]>("summaries", { workspace: ws, session }),
    ]);
    setSessionMsgs(msgs?.items ?? []);
    setSessionSummaries(sums ?? []);
    setDetailLoading(false);
  }, [ws]);

  // ── Search ──
  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    const r = await api<SearchResult>("search", { workspace: ws }, { query: query.trim() });
    setSearchRes(r);
    setSearching(false);
  }, [query, ws]);

  const stats = useMemo(
    () => [
      { label: "Peers", value: peers.length, icon: Users },
      { label: "Conclusions", value: conclusions.length, icon: Sparkles },
      { label: "Sessions (jarvis)", value: sessions.length, icon: MessageSquare },
    ],
    [peers, conclusions, sessions]
  );

  const cardLines = fmtCard(peerCard?.peer_card ?? peerCard?.card);

  const repText = useMemo(() => {
    const r = peerCtx?.representation;
    if (!r) return "";
    return typeof r === "string" ? r : String(JSON.stringify(r));
  }, [peerCtx]);

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <SectionHeader
        label="Honcho local · api.honcho.dev remplacé"
        title="Mémoire Dialectic"
        action={
          <div className="flex items-center gap-2">
            <select
              value={ws}
              onChange={(e) => setWs(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm"
              disabled={loading}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id} className="bg-neutral-900">
                  {w.id}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => ws && void load(ws)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />
      <p className="-mt-3 text-sm text-neutral-400">
        Exploration de la mémoire longue : card, contexte, conclusions, sessions et recherche sémantique — 100 % local.
      </p>

      {err && (
        <Panel className="border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-300">{err}</p>
        </Panel>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Panel key={s.label} className="p-4">
            <div className="flex items-center gap-2 text-neutral-400">
              <s.icon className="h-4 w-4" />
              <span className="text-xs uppercase tracking-wide">{s.label}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-white">
              {loading ? <Skeleton className="h-7 w-10" /> : s.value}
            </p>
          </Panel>
        ))}
      </div>

      {/* Search */}
      <Panel className="p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doSearch()}
            placeholder="Recherche sémantique dans la mémoire… (ex: moto, guitare, TAI)"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-500 focus:outline-none"
          />
          <Button onClick={() => void doSearch()} disabled={searching || !query.trim()}>
            {searching ? "…" : "Chercher"}
          </Button>
        </div>
        {searchRes && (
          <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
            {searchRes.results?.length ? (
              searchRes.results.slice(0, 8).map((r, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] p-3 text-sm">
                  <p className="text-neutral-300">
                    {String(r.content || r.conclusion || r.message || JSON.stringify(r)).slice(0, 220)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-neutral-500">Aucun résultat.</p>
            )}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Peers */}
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Peers</h3>
            <Pill>{peers.length}</Pill>
          </div>
          <div className="space-y-1.5">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : peers.length === 0 ? (
              <EmptyState icon={<Users className="h-5 w-5" />} title="Aucun peer" />
            ) : (
              peers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void openPeer(p.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                    selectedPeer === p.id
                      ? "bg-white/10 text-white"
                      : "text-neutral-300 hover:bg-white/5"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-neutral-500" />
                    {p.id}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-600" />
                </button>
              ))
            )}
          </div>
        </Panel>

        {/* Peer detail */}
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {selectedPeer ? `Peer « ${selectedPeer} »` : "Carte & contexte"}
            </h3>
            <Brain className="h-4 w-4 text-neutral-500" />
          </div>
          {detailLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !selectedPeer ? (
            <EmptyState icon={<Brain className="h-5 w-5" />} title="Sélectionne un peer" />
          ) : (
            <div className="space-y-3">
              {cardLines.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">Card</p>
                  <ul className="space-y-1">
                    {cardLines.map((l, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-sm text-neutral-300">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400/70" />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {peerCtx?.summary && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">Résumé</p>
                  <p className="rounded-lg bg-white/[0.03] p-2.5 text-sm text-neutral-300">
                    {peerCtx.summary.slice(0, 400)}
                  </p>
                </div>
              )}
              {repText && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
                    Représentation dérivée
                  </p>
                  <pre className="max-h-[380px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-2.5 font-mono text-[11px] leading-relaxed text-neutral-300">
                    {repText}
                  </pre>
                </div>
              )}
              {cardLines.length === 0 && !peerCtx?.summary && !repText && (
                <p className="text-sm text-neutral-500">Pas encore de carte pour ce peer.</p>
              )}
            </div>
          )}
        </Panel>

        {/* Conclusions */}
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Conclusions</h3>
            <Pill>{conclusions.length}</Pill>
          </div>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : conclusions.length === 0 ? (
              <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Aucune conclusion" />
            ) : (
              conclusions.slice(0, 30).map((c) => (
                <div key={c.id} className="rounded-lg bg-white/[0.03] p-2.5">
                  <p className="text-sm leading-snug text-neutral-300">{c.content}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-neutral-500">
                    <Clock className="h-3 w-3" /> {timeAgo(c.created_at)} · {c.level}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* Sessions */}
      <Panel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Sessions (peer jarvis)</h3>
          <Layers className="h-4 w-4 text-neutral-500" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Session list */}
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => void openSession(s.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  selectedSession === s.id ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/5"
                }`}
              >
                <span className="truncate font-mono text-xs">{s.id}</span>
                <span className="ml-2 flex shrink-0 items-center gap-2">
                  {s.is_active && <Pill className="!px-1.5 !py-0 text-[9px]">active</Pill>}
                  <span className="text-[10px] text-neutral-500">{timeAgo(s.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
          {/* Session detail */}
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {detailLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !selectedSession ? (
              <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="Sélectionne une session" />
            ) : (
              <>
                {sessionSummaries.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">
                      Résumés ({sessionSummaries.length})
                    </p>
                    {sessionSummaries.slice(-3).map((sum, i) => (
                      <div key={i} className="mb-1.5 rounded-lg bg-white/[0.03] p-2 text-xs text-neutral-400">
                        {typeof sum === "string" ? sum.slice(0, 200) : String(JSON.stringify(sum)).slice(0, 200)}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] uppercase tracking-widest text-neutral-500">
                  Messages ({sessionMsgs.length})
                </p>
                {sessionMsgs.slice(-15).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-2 text-xs leading-snug ${
                      m.is_user ? "bg-blue-500/10 text-blue-200" : "bg-white/[0.03] text-neutral-300"
                    }`}
                  >
                    {(m.content || String(m.role || "")).slice(0, 260)}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
