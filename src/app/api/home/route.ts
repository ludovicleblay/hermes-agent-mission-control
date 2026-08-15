import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HERMES_KANBAN_BOARD = process.env.HERMES_BOARD || "default";

function formatHermesKanban(tasks: Array<{ id: string; title: string; assignee?: string | null; status: string; priority?: number | null }>) {
  const counts = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  return {
    board: "Hermes Board",
    slug: HERMES_KANBAN_BOARD,
    total: tasks.length,
    counts,
    tasks: tasks
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, 6)
      .map(task => ({
        id: task.id,
        title: task.title,
        assignee: task.assignee || "unassigned",
        status: task.status,
        priority: task.priority || 0,
      })),
  };
}

async function loadHermesKanban() {
  try {
    const tasks = await prisma.hermesTask.findMany({ orderBy: [{ priority: "desc" }], take: 50 });
    return formatHermesKanban(
      tasks.map(t => ({ id: t.id, title: t.title, assignee: t.assignee, status: t.status, priority: t.priority }))
    );
  } catch {
    return formatHermesKanban([]);
  }
}

// Processus système : dérivés des profils Hermes réels (mirrorés par le bridge)
async function loadProcesses() {
  try {
    const store = await prisma.dataStore.findUnique({ where: { key: "hermes-profiles" } });
    const raw = store?.data as any;
    const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
    return profiles.map((p: any) => ({
      name: p.alias || p.id || p.name,
      status: p.gateway === "running" ? "online" : "offline",
      uptime: p.gateway === "running" ? "up" : "down",
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const [hermesKanban, processes] = await Promise.all([loadHermesKanban(), loadProcesses()]);

  return NextResponse.json({
    processes,
    hermesKanban,
  }, { headers: { "Cache-Control": "no-store, no-cache" } });
}
