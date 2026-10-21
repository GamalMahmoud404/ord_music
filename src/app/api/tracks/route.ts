import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseConfigurationError, databaseErrorMessage } from "@/lib/database-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The track list changes on every upload, so neither the browser nor any CDN
// edge may reuse a previous response (on Vercel this list would otherwise go
// stale after an upload and newly added songs would not appear).
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

export async function GET() {
  const configurationError = databaseConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503, headers: NO_STORE });
  }

  try {
    const tracks = await prisma.track.findMany({ orderBy: [{ order: "asc" }, { createdAt: "desc" }] });
    return NextResponse.json(tracks, { headers: NO_STORE });
  } catch (error) {
    console.error("GET /api/tracks failed:", error);
    return NextResponse.json(
      { error: databaseErrorMessage(error) },
      { status: 500, headers: NO_STORE },
    );
  }
}
