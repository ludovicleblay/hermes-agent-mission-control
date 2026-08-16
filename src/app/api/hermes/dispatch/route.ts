import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST { kind?, title, prompt?, sideEffecting?, assignee?, priority?, body? } → queue work for Hermes.
// kind: "oneshot" (chat ponctuel) | "kanban" (carte traitée par le dispatcher natif) | autres
// Pour kind=kanban : assignee/priority/body sont encodés dans prompt (JSON) pour le bridge.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || b.prompt || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });
  const sideEffecting = Boolean(b.sideEffecting);
  const kind = (b.kind || "oneshot").toString();

  let prompt: string | null = (b.prompt ?? b.title ?? "").toString() || null;
  if (kind === "kanban") {
    // Encode body/assignee/priority en JSON pour le bridge (le schéma AgentRequest n'a que title+prompt)
    const meta: Record<string, unknown> = {};
    if (b.body) meta.body = b.body.toString();
    if (b.assignee) meta.assignee = b.assignee.toString();
    if (b.priority != null) meta.priority = Number(b.priority);
    prompt = JSON.stringify(meta);
  }

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title: title.slice(0, 200),
      prompt,
      sideEffecting,
      status: sideEffecting ? "awaiting_approval" : "queued",
    },
  });
  return NextResponse.json({ request: row });
}
