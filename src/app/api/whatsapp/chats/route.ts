import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.WHAPI_TOKEN;
  if (!token) return NextResponse.json({ error: "WHAPI_TOKEN no configurado" }, { status: 500 });

  const res = await fetch("https://gate.whapi.cloud/chats?count=20", {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  return NextResponse.json(data);
}
