import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseConfigurationError, databaseErrorMessage } from "@/lib/database-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLORS = ["#8deaff", "#ff9bd0", "#82f2c7", "#a9c5ff", "#ffc477", "#ffad8c"];
function cleanText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}
function safeDuration(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const configurationError = databaseConfigurationError();
  if (configurationError) return NextResponse.json({ error: configurationError }, { status: 503 });
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "tracks";
  if (!supabaseUrl) return NextResponse.json({ error: "Audio storage is not configured." }, { status: 503 });

  try {
    const body = await request.json() as {
      fileName?: unknown; artist?: unknown; album?: unknown; mood?: unknown;
      durationSeconds?: unknown; audio?: unknown;
    };
    const audio = typeof body.audio === "string" ? body.audio : "";
    const expectedPrefix = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/audio/`;
    if (!audio.startsWith(expectedPrefix) || audio.includes("..")) {
      return NextResponse.json({ error: "The uploaded audio URL is invalid. Please upload the song again." }, { status: 400 });
    }
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const baseTitle = fileName.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "Untitled track";
    const existingCount = await prisma.track.count();
    const trackData = {
      artist: cleanText(body.artist, "Unknown artist"),
      album: cleanText(body.album, "Unknown album"),
      duration: safeDuration(body.durationSeconds),
      mood: cleanText(body.mood, "Uncategorized", 40),
      cover: "",
      audio,
    };
    // Concurrent uploads (parallel requests, double submits, same filename twice)
    // can race a separate findUnique→create pair across serverless instances and
    // fail with a P2002 unique-constraint error. Create first and retry with the
    // next title suffix on collision so a duplicate never loses the song.
    let title = baseTitle;
    let suffix = 2;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      try {
        const track = await prisma.track.create({
          data: {
            ...trackData,
            title,
            color: COLORS[(existingCount + attempt) % COLORS.length],
            order: existingCount + 1 + attempt,
          },
        });
        return NextResponse.json({ track }, { status: 201 });
      } catch (error) {
        if ((error as { code?: unknown }).code !== "P2002") throw error;
        title = `${baseTitle} (${suffix++})`;
      }
    }
    return NextResponse.json(
      { error: "Too many tracks already use this title. Rename the audio file and upload it again." },
      { status: 409 },
    );
  } catch (error) {
    console.error("POST /api/tracks/register failed:", error);
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
