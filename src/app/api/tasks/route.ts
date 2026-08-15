import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIKUNJA_URL = process.env.VIKUNJA_URL || "http://192.168.68.87:8082/api/v1";
const VIKUNJA_TOKEN = process.env.VIKUNJA_API_TOKEN || "";

interface VTask {
  id: number;
  title: string;
  description?: string;
  done: boolean;
  due_date?: string;
  priority?: number;
  project_id: number;
  created?: string;
}

interface VProject {
  id: number;
  title: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: "Low",
  1: "Medium",
  2: "High",
  3: "Urgent",
  4: "Critical",
};

async function vk(path: string) {
  const res = await fetch(`${VIKUNJA_URL}${path}`, {
    headers: { Authorization: `Bearer ${VIKUNJA_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Vikunja ${path}: ${res.status}`);
  return res.json();
}

export async function GET() {
  try {
    if (!VIKUNJA_TOKEN) {
      return NextResponse.json({ error: "VIKUNJA_API_TOKEN non configuré" }, { status: 500 });
    }

    const [projects, tasks] = await Promise.all([
      vk("/projects"),
      vk("/tasks?sort_by=updated&order_by=desc&page=1&per_page=100"),
    ]);

    const projectMap = new Map<number, string>();
    for (const p of projects as VProject[]) projectMap.set(p.id, p.title);

    const items = (tasks as VTask[]).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      done: t.done,
      dueDate: t.due_date || null,
      priority: t.priority != null ? PRIORITY_LABELS[t.priority] || "Low" : "None",
      priorityRaw: t.priority ?? 0,
      project: projectMap.get(t.project_id) || `Projet ${t.project_id}`,
      projectId: t.project_id,
      created: t.created || null,
    }));

    // tri : non-done d'abord, puis priorité décroissante, puis updated
    items.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (b.priorityRaw !== a.priorityRaw) return b.priorityRaw - a.priorityRaw;
      return 0;
    });

    return NextResponse.json({
      projects: projects.map((p: VProject) => ({ id: p.id, title: p.title })),
      tasks: items,
      counts: {
        open: items.filter((t) => !t.done).length,
        done: items.filter((t) => t.done).length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Vikunja unreachable: ${e.message}` }, { status: 502 });
  }
}
