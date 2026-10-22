import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".webm"]);
// Files written by the local fallback always use a generated UUID name.
const LOCAL_OBJECT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

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

// Vercel and most function hosts mount the deployment bundle read-only and
// discard writes, so local persistence is only offered on a normal server.
function localStorageAvailable() {
  return !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.NETLIFY;
}

export async function POST(request: Request) {
  let body: { fileName?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "The upload request was not valid JSON." }, { status: 400, headers: NO_STORE });
  }

  const fileName = typeof body.fileName === "string" ? path.basename(body.fileName) : "";
  const extension = path.extname(fileName).toLowerCase();
  const size = Number(body.size);
  if (!fileName || !ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: "Unsupported audio format. Use MP3, WAV, OGG, M4A, AAC, FLAC, or WEBM." }, { status: 400, headers: NO_STORE });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Each audio file must be larger than 0 bytes and no larger than 50 MB." }, { status: 413, headers: NO_STORE });
  }
  const contentType = typeof body.contentType === "string" && body.contentType.trim()
    ? body.contentType.trim().slice(0, 100)
    : "application/octet-stream";

  const config = storageConfig();
  const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL?.trim());
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());

  if (!config) {
    // A partially configured Supabase setup is almost always a mistake. Report
    // it instead of silently writing songs to a filesystem that may be lost.
    if (hasSupabaseUrl || hasServiceKey || !localStorageAvailable()) {
      const missing = [
        !hasSupabaseUrl ? "SUPABASE_URL" : null,
        !hasServiceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
      ].filter((name): name is string => Boolean(name));
      console.error("Audio upload unavailable: missing or invalid Supabase server configuration", { missing });
      return NextResponse.json({
        error: `Audio storage is not configured on the server. Add ${missing.length ? missing.join(" and ") : "valid Supabase settings"} in the deployment environment (for Vercel: Settings → Environment Variables), then redeploy. SUPABASE_STORAGE_BUCKET is optional and defaults to tracks.`,
        code: "AUDIO_STORAGE_NOT_CONFIGURED",
      }, { status: 503, headers: NO_STORE });
    }

    // Local fallback: the browser PUTs the bytes to this same route and the file
    // is written to public/uploads, which Next.js serves as a static asset.
    const objectName = `${randomUUID()}${extension}`;
    return NextResponse.json({
      uploadUrl: `/api/tracks/upload?fileName=${encodeURIComponent(objectName)}`,
      publicUrl: `/api/audio/${objectName}`,
      path: objectName,
      contentType,
      mode: "local",
    }, { headers: NO_STORE });
  }

  try {
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
    let signedData: { url?: string; token?: string; signedURL?: string; signedUrl?: string; message?: string; error?: string } = {};
    try { signedData = JSON.parse(responseText); } catch { /* handled below without leaking credentials */ }
    const rawSignedUrl = signedData.url || signedData.signedURL || signedData.signedUrl;
    if (!signedResponse.ok || !rawSignedUrl) {
      console.error("Supabase signed-upload URL request failed:", signedResponse.status, responseText.slice(0, 500));
      return NextResponse.json({ error: "Supabase could not create a signed upload URL. Verify SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and that the storage bucket exists." }, { status: 502, headers: NO_STORE });
    }
    // Supabase versions may return an absolute URL, a /storage/v1/... path,
    // or an /object/... path relative to the Storage API base.
    const normalizedSignedUrl = rawSignedUrl.startsWith("http://") || rawSignedUrl.startsWith("https://")
      ? rawSignedUrl
      : rawSignedUrl.startsWith("/storage/v1/")
        ? `${config.supabaseUrl}${rawSignedUrl}`
        : rawSignedUrl.startsWith("/object/")
          ? `${storageBase}${rawSignedUrl}`
          : `${storageBase}/${rawSignedUrl.replace(/^\//, "")}`;
    const parsedUploadUrl = new URL(normalizedSignedUrl);
    // Some responses return the token separately instead of in the signed URL.
    if (signedData.token && !parsedUploadUrl.searchParams.has("token")) {
      parsedUploadUrl.searchParams.set("token", signedData.token);
    }
    const uploadUrl = parsedUploadUrl.toString();
    const publicUrl = `${storageBase}/object/public/${encodedBucket}/${encodedPath}`;
    return NextResponse.json({
      uploadUrl,
      publicUrl,
      path: objectPath,
      contentType,
      mode: "supabase",
    }, { headers: NO_STORE });
  } catch (error) {
    console.error("POST /api/tracks/upload failed:", error);
    return NextResponse.json({ error: "Could not prepare this upload. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

export async function PUT(request: Request) {
  if (!localStorageAvailable()) {
    return NextResponse.json({ error: "Local audio uploads are disabled on this host. Configure Supabase Storage instead." }, { status: 503, headers: NO_STORE });
  }

  const objectName = new URL(request.url).searchParams.get("fileName") ?? "";
  const extension = path.extname(objectName).toLowerCase();
  if (!LOCAL_OBJECT_PATTERN.test(objectName) || !ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: "Invalid local upload target." }, { status: 400, headers: NO_STORE });
  }

  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Each audio file must be no larger than 50 MB." }, { status: 413, headers: NO_STORE });
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "The audio file could not be read." }, { status: 400, headers: NO_STORE });
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Each audio file must be larger than 0 bytes and no larger than 50 MB." }, { status: 413, headers: NO_STORE });
  }

  const uploadDirectory = path.join(process.cwd(), "public", "uploads");
  const targetPath = path.join(uploadDirectory, objectName);
  try {
    await mkdir(uploadDirectory, { recursive: true });
    // "wx" refuses to overwrite an existing object, so a guessed URL cannot
    // replace another song's audio file.
    await writeFile(targetPath, Buffer.from(bytes), { flag: "wx" });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "EEXIST") {
      return NextResponse.json({ error: "This upload target already exists. Please try again." }, { status: 409, headers: NO_STORE });
    }
    console.error("PUT /api/tracks/upload failed:", error);
    return NextResponse.json({ error: "The server could not save the audio file. Check that public/uploads is writable." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json({ path: `/uploads/${objectName}` }, { status: 201, headers: NO_STORE });
}
