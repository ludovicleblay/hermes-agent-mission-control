import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

// PATCH /api/tasks/[id] — update d'une tâche (done, title, description, priority, due_date)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Whitelist des champs modifiables (jamais l'id / project_id)
  const allowed: Record<string, unknown> = {};
  for (const key of ["title", "description", "done", "priority", "due_date"]) {
    if (body[key] !== undefined) allowed[key] = body[key];
  }
  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No editable fields" }, { status: 400 });
  }

  const { status, data } = await vikunjaFetch(`/tasks/${id}`, "POST", allowed);
  if (status >= 400) {
    return NextResponse.json({ error: "Vikunja update failed", detail: data }, { status });
  }
  return NextResponse.json(data);
}
