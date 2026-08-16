import { NextRequest, NextResponse } from "next/server";

const OUTLINE_API_URL =
  process.env.OUTLINE_API_URL || "https://outline.leblay.cloud";
const OUTLINE_API_KEY = process.env.OUTLINE_API_KEY || "";
const COLLECTION_ID =
  process.env.OUTLINE_BRIEFS_COLLECTION || "";

async function outlineApi(path: string, payload: Record<string, unknown>) {
  const res = await fetch(`${OUTLINE_API_URL}/api/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OUTLINE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Outline ${path} → ${res.status}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  try {
    // documents.list ne renvoie pas les docs créés via l'API dans une
    // collection (comportement Outline) → on passe par documents.search,
    // qui indexe titre + contenu et respecte le filtre collectionId.
    const query = q || "Brief matinal";
    const data = await outlineApi("documents.search", {
      query,
      collectionId: COLLECTION_ID,
      limit: 50,
    });
    const docs = (data.data || [])
      .map((hit: any) => hit.document || hit)
      .filter((d: any) => d && !d.archivedAt)
      .map((d: any) => ({
        id: d.id,
        title: d.title,
        text: d.text,
        updatedAt: d.updatedAt,
        url: d.url,
      }));
    return NextResponse.json({ items: docs, query }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Outline unreachable" },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
