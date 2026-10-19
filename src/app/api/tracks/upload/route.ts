import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseConfigurationError, databaseErrorMessage } from "@/lib/database-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".webm"]);
const COLORS = ["#8deaff", "#ff9bd0", "#82f2c7", "#a9c5ff", "#ffc477", "#ffad8c"];

function cleanText(value: FormDataEntryValue | null, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback;
  const clean = value.trim().slice(0, maxLength);
  return clean || fallback;
}

function titleFromFilename(filename: string) {
  return path.basename(filename, path.extname(filename)).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "Untitled track";
}

export async function POST(request: Request) {
  const configurationError = databaseConfigurationError();
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 503 });
  }

  const savedPaths: string[] = [];
  const createdIds: string[] = [];
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) return NextResponse.json({ error: "Choose at least one audio file." }, { status: 400 });
    if (files.length > 30) return NextResponse.json({ error: "Upload up to 30 songs at a time." }, { status: 400 });

    const artist = cleanText(formData.get("artist"), "Unknown artist");
    const album = cleanText(formData.get("album"), "Unknown album");
    const mood = cleanText(formData.get("mood"), "Uncategorized", 40);
    let durations: number[] = [];
    const rawDurations = formData.get("durations");
    if (typeof rawDurations === "string") {
      try { const parsed: unknown = JSON.parse(rawDurations); if (Array.isArray(parsed)) durations = parsed.map((v) => Number(v)); } catch { /* optional browser metadata */ }
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 100 * 1024 * 1024) {
      return NextResponse.json({ error: "The combined upload must be 100 MB or less." }, { status: 413 });
    }

    for (const file of files) {
      const extension = path.extname(file.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return NextResponse.json({ error: `Unsupported audio format: ${file.name}. Use MP3, WAV, OGG, M4A, AAC, FLAC, or WEBM.` }, { status: 400 });
      }
      if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `${file.name} is empty or larger than 50 MB.` }, { status: 413 });
      }
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const existingCount = await prisma.track.count();
    const created = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const extension = path.extname(file.name).toLowerCase();
      const filename = `${randomUUID()}${extension}`;
      const absolutePath = path.join(uploadDir, filename);
      await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      savedPaths.push(absolutePath);

      const baseTitle = titleFromFilename(file.name);
      let title = baseTitle;
      let suffix = 2;
      while (await prisma.track.findUnique({ where: { title }, select: { id: true } })) {
        title = `${baseTitle} (${suffix++})`;
      }
      const durationSeconds = Number(durations[index]);
      const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, "0")}`
        : "0:00";

      const track = await prisma.track.create({
        data: {
          title,
          artist,
          album,
          duration,
          mood,
          color: COLORS[(existingCount + index) % COLORS.length],
          cover: "",
          audio: `/uploads/${filename}`,
          order: existingCount + index + 1,
        },
      });
      created.push(track);
      createdIds.push(track.id);
    }

    return NextResponse.json({ tracks: created, count: created.length }, { status: 201 });
  } catch (error) {
    if (createdIds.length) await prisma.track.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined);
    await Promise.all(savedPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
    console.error("POST /api/tracks/upload failed:", error);
    return NextResponse.json({ error: databaseErrorMessage(error) }, { status: 500 });
  }
}
