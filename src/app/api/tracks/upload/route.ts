import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".webm"]);

function storageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "tracks";
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch { return null; }
  return { supabaseUrl, serviceKey, bucket };
}

export async function POST(request: Request) {
  const config = storageConfig();
  if (!config) {
    return NextResponse.json({ error: "Audio storage is not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET to Vercel Environment Variables." }, { status: 503 });
  }

  try {
    const body = await request.json() as { fileName?: unknown; contentType?: unknown; size?: unknown };
    const fileName = typeof body.fileName === "string" ? path.basename(body.fileName) : "";
    const extension = path.extname(fileName).toLowerCase();
    const size = Number(body.size);
    if (!fileName || !ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: "Unsupported audio format. Use MP3, WAV, OGG, M4A, AAC, FLAC, or WEBM." }, { status: 400 });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Each audio file must be larger than 0 bytes and no larger than 50 MB." }, { status: 413 });
    }

    const objectPath = `audio/${randomUUID()}${extension}`;
    const encodedBucket = encodeURIComponent(config.bucket);
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const storageBase = `${config.supabaseUrl}/storage/v1`;
    const signedResponse = await fetch(`${storageBase}/object/upload/sign/${encodedBucket}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      cache: "no-store",
    });
    const responseText = await signedResponse.text();
    let signedData: { url?: string; token?: string; signedURL?: string; message?: string; error?: string } = {};
    try { signedData = JSON.parse(responseText); } catch { /* handled below without leaking credentials */ }
    if (!signedResponse.ok || !(signedData.url || signedData.signedURL)) {
      console.error("Supabase signed-upload URL request failed:", signedResponse.status, responseText.slice(0, 500));
      return NextResponse.json({ error: "Could not prepare audio storage upload. Check the Supabase URL, service role key, and that the storage bucket exists." }, { status: 502 });
    }
    const signedPath = signedData.url || signedData.signedURL || "";
    const uploadUrl = `${storageBase}${signedPath.startsWith("/") ? signedPath : `/${signedPath}`}`;
    const publicUrl = `${storageBase}/object/public/${encodedBucket}/${encodedPath}`;
    return NextResponse.json({ uploadUrl, publicUrl, path: objectPath, contentType: typeof body.contentType === "string" ? body.contentType : "application/octet-stream" });
  } catch (error) {
    console.error("POST /api/tracks/upload failed:", error);
    return NextResponse.json({ error: "Could not prepare this upload. Please try again." }, { status: 500 });
  }
}
