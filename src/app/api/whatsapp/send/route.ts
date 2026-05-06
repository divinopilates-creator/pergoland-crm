import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const token = process.env.WHAPI_TOKEN;
  if (!token) return NextResponse.json({ error: "WHAPI_TOKEN no configurado" }, { status: 500 });

  let body: { phone: string; message: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { phone, message } = body;
  if (!phone || !message) return NextResponse.json({ error: "phone y message son requeridos" }, { status: 400 });

  const chatId = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    const res = await fetch("https://gate.whapi.cloud/messages/text", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: chatId, body: message }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Whapi error: ${err}` }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: `Error: ${error instanceof Error ? error.message : "Unknown"}` }, { status: 500 });
  }
}
