import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i;
const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};
const CACHE_HEADERS = { "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "bytes" };

type RouteContext = { params: Promise<{ file: string }> };

async function findAudioFile(file: string) {
  if (!FILE_PATTERN.test(file)) return null;
  const localPath = path.join(process.cwd(), "public", "uploads", file);
  try {
    const info = await stat(localPath);
    if (!info.isFile()) return null;
    const contentType = MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return { localPath, size: info.size, contentType };
  } catch {
    return null;
  }
}

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(startText);
  let end = endText ? Number(endText) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || start > end) return null;
  if (end >= size) end = size - 1;
  return { start, end };
}

export async function GET(request: Request, { params }: RouteContext) {
  const { file } = await params;
  const audio = await findAudioFile(file);
  if (!audio) return new Response("Audio file not found.", { status: 404 });

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, audio.size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { ...CACHE_HEADERS, "Content-Range": `bytes */${audio.size}` },
      });
    }
    const stream = createReadStream(audio.localPath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": audio.contentType,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${audio.size}`,
      },
    });
  }

  const stream = createReadStream(audio.localPath);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      ...CACHE_HEADERS,
      "Content-Type": audio.contentType,
      "Content-Length": String(audio.size),
    },
  });
}

export async function HEAD(_request: Request, { params }: RouteContext) {
  const { file } = await params;
  const audio = await findAudioFile(file);
  if (!audio) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      ...CACHE_HEADERS,
      "Content-Type": audio.contentType,
      "Content-Length": String(audio.size),
    },
  });
}
