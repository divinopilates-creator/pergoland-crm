import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelineStages, deals } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const activeDeals = db.select().from(deals).where(eq(deals.stageId, id)).all();
  if (activeDeals.length > 0) {
    return NextResponse.json({ error: "No se puede eliminar una etapa con deals activos" }, { status: 400 });
  }

  db.delete(pipelineStages).where(eq(pipelineStages.id, id)).run();
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  db.update(pipelineStages)
    .set({ ...(body.order !== undefined && { order: body.order }), ...(body.name && { name: body.name }) })
    .where(eq(pipelineStages.id, id))
    .run();

  return NextResponse.json({ success: true });
}
