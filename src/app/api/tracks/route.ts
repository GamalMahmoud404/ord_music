import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseConfigurationError, databaseErrorMessage } from "@/lib/database-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configurationError = databaseConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503 });
  }

  try {
    const tracks = await prisma.track.findMany({ orderBy: [{ order: "asc" }, { createdAt: "desc" }] });
    return NextResponse.json(tracks);
  } catch (error) {
    console.error("GET /api/tracks failed:", error);
    return NextResponse.json(
      { error: databaseErrorMessage(error) },
      { status: 500 },
    );
  }
}
