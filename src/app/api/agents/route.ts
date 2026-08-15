import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Roster 100 % dynamique : construit depuis les VRAIS profils Hermes
// (mirrorés par le bridge dans DataStore key=hermes-profiles via `hermes profile list`).
// Aucun agent codé en dur — si un profil est ajouté/supprimé, la page suit.

// Emojis décoratifs par profil connu (le reste retombe sur 🤖)
const EMOJIS: Record<string, string> = {
  jarvis: "🧠",
  toad: "🍄",
  default: "⚙️",
};

const STATUS_LABEL: Record<string, string> = {
  running: "online",
  stopped: "offline",
  paused: "idle",
  unknown: "idle",
};

export async function GET() {
  try {
    const [store, states, events] = await Promise.all([
      prisma.dataStore.findUnique({ where: { key: "hermes-profiles" } }),
      prisma.agentState.findMany(),
      prisma.agentEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    ]);

    const stateMap: Record<string, any> = {};
    for (const s of states) stateMap[s.id] = s;

    // Dernière activité par agent (events du bridge)
    const activityByAgent: Record<string, any[]> = {};
    for (const e of events) {
      const agent = e.agent || "hermes";
      if (!activityByAgent[agent]) activityByAgent[agent] = [];
      if (activityByAgent[agent].length < 5) activityByAgent[agent].push(e);
    }

    const raw = store?.data as any;
    const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];

    const agents = profiles.map((p: any) => {
      const id = p.id || p.name;
      const s = stateMap[id] || {};
      const recent = activityByAgent[id] || [];
      const gatewayStatus = STATUS_LABEL[p.gateway] || "idle";

      // Statut : priorité au state POST (bridge), sinon gateway, sinon activité
      let status = s.status || gatewayStatus;
      if (recent.length > 0 && status !== "offline") {
        const ageMin = (Date.now() - new Date(recent[0].createdAt).getTime()) / 60000;
        if (ageMin < 2) status = "working";
      }

      return {
        id,
        name: p.name || id,
        emoji: EMOJIS[id] || "🤖",
        role: p.alias ? `${p.alias} · ${p.model || "agent Hermes"}` : p.model || "Agent Hermes",
        status,
        currentTask: s.currentTask || (status === "working" ? recent[0]?.title : undefined),
        lastActive: s.lastActive || recent[0]?.createdAt || undefined,
        tasksCompleted: s.tasksCompleted || recent.filter((e) => e.kind === "run").length || 0,
        totalCost: s.totalCost || 0,
        recentActivity: recent.map((e) => ({
          timestamp: e.createdAt.toISOString(),
          action: e.title,
          result: e.detail || undefined,
        })),
        gateway: p.gateway,
        model: p.model,
        isCurrent: !!p.isCurrent,
      };
    });

    return NextResponse.json(agents, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    console.error("Agents API error:", error);
    return NextResponse.json([], { status: 200 });
  }
}

// POST to update agent state (called by cron jobs)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, action, status, currentTask } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId required" }, { status: 400 });
    }

    const existing = await prisma.agentState.findUnique({ where: { id: agentId } });
    const data = {
      name: agentId,
      status: status || existing?.status || "idle",
      currentTask: currentTask !== undefined ? currentTask : existing?.currentTask,
      lastActive: new Date(),
      ...(action === "complete" ? { tasksCompleted: (existing?.tasksCompleted || 0) + 1 } : {}),
    };

    const state = existing
      ? await prisma.agentState.update({ where: { id: agentId }, data })
      : await prisma.agentState.create({ data: { id: agentId, ...data } });

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    console.error("Agent state update error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
