import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  const phoneClean = phone.replace(/\D/g, "");
  const agentUrl = process.env.AGENTKIT_URL;

  if (!agentUrl) return NextResponse.json({ error: "AGENTKIT_URL no configurado" }, { status: 500 });

  try {
    const res = await fetch(`${agentUrl}/conversations/${phoneClean}`);
    if (!res.ok) return NextResponse.json({ messages: [] });

    const data = await res.json();
    const messages = (data.messages || []).map((m: { role: string; content: string; timestamp: string }, i: number) => ({
      id: i,
      from_me: m.role === "assistant",
      text: m.content,
      timestamp: Math.floor(new Date(m.timestamp).getTime() / 1000),
    }));

    return NextResponse.json({ messages });
  } catch (error) {
    return NextResponse.json({ error: `Error: ${error instanceof Error ? error.message : "Unknown"}` }, { status: 500 });
  }
}
