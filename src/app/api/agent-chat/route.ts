import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface AgentChatRequest {
  agentId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface AgentChatResponse {
  reply: string;
  agentId: string;
}

// Personae des agents Le Blay — le chat est exécuté par Hermes via le bridge
// (kind=chat → `hermes chat -Q -q`), AUCUN appel OpenRouter direct.
const AGENT_PROMPTS: Record<string, string> = {
  jarvis: "Tu es Jarvis 🧠, l'agent personnel de Ludo (famille Le Blay, Rueil-Malmaison). Tu gères l'infrastructure (Home-AI, Media-Center, HAOS), la maison (Home Assistant), la mémoire (Honcho local) et la veille tech quotidienne. Tu es le binôme de Toad 🍄 (assistant des enfants et de Corinne). Réponds en français, chaleureux mais direct, concis.",
  toad: "Tu es Toad 🍄, l'assistant de la famille Le Blay — surtout des enfants (Alice, 13 ans, et Noémie, 10 ans) et de Corinne. Tu es le binôme de Jarvis 🧠 (agent technique et infrastructure). Ton ton est doux, patient, ludique et pédagogique. Réponds en français, simplement, avec bienveillance.",
};

const POLL_MS = 1500;
const MAX_WAIT_MS = 90000;

// Nettoyage de la sortie Hermes : retire la ligne-cadre « ┌─ Reasoning … ┐ »
// (DeepSeek thinking s'affiche en préambule sur une seule ligne)
function stripReasoning(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0] && lines[0].includes("┌─ Reasoning")) {
    return lines.slice(1).join("\n").trim();
  }
  return raw.trim();
}

export async function POST(request: NextRequest): Promise<NextResponse<AgentChatResponse | { error: string }>> {
  try {
    const body: AgentChatRequest = await request.json();
    const { agentId, message, history = [] } = body;

    if (!agentId || !message) {
      return NextResponse.json(
        { error: 'Missing agentId or message' },
        { status: 400 }
      );
    }

    const persona = AGENT_PROMPTS[agentId] || AGENT_PROMPTS.jarvis;

    // Construire le prompt : persona + historique + message courant
    const historyBlock = history
      .slice(-8)
      .map((h) => `${h.role === 'user' ? 'Utilisateur' : agentId}: ${h.content}`)
      .join('\n');
    const prompt = `${persona}\n\nConversation récente :\n${historyBlock}\n\nMessage : ${message}\n\nRéponds en français, de façon concise et naturelle.`;

    // Créer la requête — le bridge la prend (poll 5s) et l'exécute via Hermes
    const req = await prisma.agentRequest.create({
      data: {
        origin: 'web',
        kind: 'chat',
        title: `Chat ${agentId}: ${message.slice(0, 80)}`,
        prompt,
        sideEffecting: false,
        status: 'queued',
      },
    });

    // Attendre le résultat (polling BDD)
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const row = await prisma.agentRequest.findUnique({ where: { id: req.id } });
      if (!row) break;
      if (row.status === 'done' && row.result) {
        return NextResponse.json({ reply: stripReasoning(row.result), agentId });
      }
      if (row.status === 'failed') {
        return NextResponse.json(
          { error: row.error || 'Agent request failed' },
          { status: 502 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Timeout — l’agent n’a pas répondu à temps' },
      { status: 504 }
    );
  } catch (e) {
    console.error('agent-chat error:', e);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
