import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "tracks";
const storageBase = supabaseUrl ? `${supabaseUrl}/storage/v1` : "";
const authHeaders = {
  apikey: serviceKey ?? "",
  Authorization: `Bearer ${serviceKey ?? ""}`,
};

const MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

function fail(message) {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error) return `${error.message} (${cause.message})`;
  if (cause) return `${error.message} (${String(cause)})`;
  return error.message;
}

async function storageFetch(url, options, label) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new Error(`${label} failed. Check your internet connection and SUPABASE_URL. ${describeError(error)}`);
  }
}

function validSupabaseConfig() {
  if (!supabaseUrl || !serviceKey) {
    fail(
      "Missing Supabase configuration.\n" +
      "Add these values to your local .env, then run this script again:\n" +
      "  SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY\n" +
      "  SUPABASE_STORAGE_BUCKET=tracks   # optional\n\n" +
      "Use the service_role key from Supabase → Project Settings → API. Never commit it.",
    );
    return false;
  }

  if (/YOUR_|PLACEHOLDER|your_project_ref/i.test(supabaseUrl) || /YOUR_|PLACEHOLDER/i.test(serviceKey)) {
    fail(
      "Supabase is still using the example placeholder values.\n" +
      "Open .env and replace both values with the real values from your Supabase project:\n" +
      "  Project Settings → API → Project URL\n" +
      "  Project Settings → API → service_role / Secret key\n\n" +
      "The URL must look like https://abcdefghijklmnop.supabase.co (not your_project_ref).",
    );
    return false;
  }

  if (serviceKey.length < 30) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY looks too short to be a real key.\n" +
      "Copy the full service_role / Secret key from Supabase → Project Settings → API.",
    );
    return false;
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    fail("SUPABASE_URL is not a valid URL. Use the Project URL from Supabase, for example https://abcdefghijklmnop.supabase.co");
    return false;
  }

  return true;
}

async function ensureBucket() {
  const bucketUrl = `${storageBase}/bucket/${encodeURIComponent(bucket)}`;
  const response = await storageFetch(bucketUrl, { headers: authHeaders }, "Supabase Storage request");
  const bodyText = await response.text().catch(() => "");
  let info = {};
  try { info = bodyText ? JSON.parse(bodyText) : {}; } catch { /* non-JSON error body */ }

  if (response.ok) {
    if (info.public === false) {
      console.log(`Bucket "${bucket}" is private. Making it public so audio URLs can play...`);
      const update = await storageFetch(bucketUrl, {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ public: true }),
      }, "Making the Supabase bucket public");
      if (!update.ok) {
        const details = (await update.text().catch(() => "")).slice(0, 300);
        throw new Error(
          `Bucket "${bucket}" is private and could not be made public (${update.status}). ` +
          `Open Supabase → Storage → ${bucket} → Settings and make it public. ${details}`,
        );
      }
    }
    return;
  }

  // Supabase sometimes wraps a missing bucket in HTTP 400 with
  // {"code":"NoSuchBucket"} instead of returning HTTP 404.
  const bucketMissing = response.status === 404 ||
    info.code === "NoSuchBucket" ||
    /bucket not found/i.test(bodyText);
  if (!bucketMissing) {
    throw new Error(`Could not read bucket "${bucket}" (${response.status}). ${bodyText.slice(0, 300)}`);
  }

  console.log(`Bucket "${bucket}" does not exist. Creating it as a public bucket...`);
  const create = await storageFetch(`${storageBase}/bucket`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  }, "Creating the Supabase bucket");
  if (!create.ok) {
    const details = (await create.text().catch(() => "")).slice(0, 300);
    throw new Error(`Could not create bucket "${bucket}" (${create.status}). ${details}`);
  }
}

function localFileName(audio) {
  if (!audio.startsWith("/")) return null;
  let pathname = audio;
  try {
    pathname = new URL(audio, "http://local").pathname;
  } catch {
    // Use the original path if URL parsing fails.
  }
  const match = pathname.match(/\/(?:uploads|api\/audio)\/([^/]+)$/i);
  if (!match) return null;
  try {
    return path.basename(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

async function main() {
  if (!validSupabaseConfig()) return;

  await ensureBucket();

  const tracks = await prisma.track.findMany({ orderBy: [{ order: "asc" }, { createdAt: "desc" }] });
  const localTracks = tracks.filter((track) => localFileName(track.audio));
  if (!localTracks.length) {
    console.log("No tracks with local /uploads or /api/audio URLs were found. Nothing to migrate.");
    return;
  }

  console.log(`Found ${localTracks.length} track(s) with local audio URLs.`);
  let updated = 0;
  let failed = 0;

  for (const track of localTracks) {
    const fileName = localFileName(track.audio);
    if (!fileName) continue;
    const extension = path.extname(fileName).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) {
      console.error(`✗ ${track.title}: unsupported audio extension "${extension}".`);
      failed += 1;
      continue;
    }

    const localPath = path.join(process.cwd(), "public", "uploads", fileName);
    try {
      const fileInfo = await stat(localPath);
      if (!fileInfo.isFile()) throw new Error("not a regular file");
    } catch {
      console.error(`✗ ${track.title}: local file not found: ${localPath}`);
      failed += 1;
      continue;
    }

    const bytes = await readFile(localPath);
    const encodedBucket = encodeURIComponent(bucket);
    const encodedPath = ["audio", fileName].map(encodeURIComponent).join("/");
    const uploadUrl = `${storageBase}/object/${encodedBucket}/${encodedPath}`;
    let upload;
    try {
      upload = await storageFetch(uploadUrl, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": contentType,
          "Cache-Control": "31536000",
          "x-upsert": "true",
        },
        body: bytes,
      }, `Uploading "${track.title}"`);
    } catch (error) {
      console.error(`✗ ${track.title}: ${describeError(error)}`);
      failed += 1;
      continue;
    }

    if (!upload.ok) {
      const details = (await upload.text().catch(() => "")).slice(0, 300);
      console.error(`✗ ${track.title}: upload failed (${upload.status}). ${details}`);
      failed += 1;
      continue;
    }

    const publicUrl = `${storageBase}/object/public/${encodedBucket}/${encodedPath}`;
    await prisma.track.update({
      where: { id: track.id },
      data: { audio: publicUrl },
    });
    updated += 1;
    console.log(`✓ ${track.title}`);
    console.log(`  ${publicUrl}`);
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
