import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIKUNJA_URL = process.env.VIKUNJA_URL || "http://192.168.68.87:8082/api/v1";
const VIKUNJA_TOKEN = process.env.VIKUNJA_API_TOKEN || "";

async function vikunjaFetch(path: string, method: string, body?: unknown) {
  const res = await fetch(`${VIKUNJA_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${VIKUNJA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const PRIORITY_LABEL: Record<number, string> = { 0: "none", 1: "low", 2: "medium", 3: "high", 4: "urgent" };

// GET /api/tasks — liste des tâches de tous les projets + projets
// NB : GET /tasks global de Vikunja est tronqué (50/page, trié bizarrement)
// → on liste projet par projet pour TOUT récupérer.
export async function GET() {
  try {
    const projectsRes = await vikunjaFetch("/projects", "GET");
    if (projectsRes.status >= 400) {
      return NextResponse.json({ error: "Vikunja unreachable", detail: projectsRes.data }, { status: 502 });
    }
    const projects = (projectsRes.data as Array<Record<string, unknown>>) ?? [];
    const projectNames = new Map<number, string>();
    for (const p of projects) {
      const id = Number(p.id);
      if (id && p.title) projectNames.set(id, String(p.title));
    }

    // Récupère les tâches de chaque projet (3 pages de 250 max par projet)
    const allTasks: Array<Record<string, unknown>> = [];
    for (const p of projects) {
      const pid = Number(p.id);
      for (let page = 1; page <= 3; page++) {
        const res = await vikunjaFetch(`/projects/${pid}/tasks?page=${page}&per_page=250`, "GET");
        if (res.status >= 400) break;
        const batch = (res.data as Array<Record<string, unknown>>) ?? [];
        if (batch.length === 0) break;
        allTasks.push(...batch);
        if (batch.length < 250) break;
      }
    }

    const items = allTasks.map((t) => ({
      id: Number(t.id),
      title: String(t.title ?? ""),
      description: String(t.description ?? ""),
      done: Boolean(t.done),
      priority: Number(t.priority ?? 0),
      priorityLabel: PRIORITY_LABEL[Number(t.priority ?? 0)] ?? "none",
      projectId: Number(t.project_id ?? 0),
      project: projectNames.get(Number(t.project_id ?? 0)) ?? "—",
      dueDate: t.due_date && String(t.due_date).startsWith("0001") ? null : String(t.due_date ?? ""),
      createdAt: String(t.created ?? ""),
    }));

    return NextResponse.json({ items, projects: projects.map((p) => ({ id: Number(p.id), title: String(p.title) })) });
  } catch (e) {
    return NextResponse.json({ error: `Vikunja unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}

// POST /api/tasks — création d'une tâche
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });
  const projectId = body.project_id ?? 5; // défaut Inbox
  const payload: Record<string, unknown> = {
    title,
    project_id: projectId,
    description: body.description || "",
  };
  if (body.priority !== undefined) payload.priority = body.priority;
  const { status, data } = await vikunjaFetch(`/projects/${projectId}/tasks`, "PUT", payload);
  if (status >= 400) {
    return NextResponse.json({ error: "Vikunja create failed", detail: data }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
