# Orb Music

Orb Music is a Next.js + TypeScript music library backed by MongoDB through Prisma. The library, mood statistics, selected song, and player are rendered from records returned by the database instead of a hardcoded featured album.

## Requirements

- Node.js 20.9+
- MongoDB Atlas or a compatible MongoDB database
- A writable local project directory for uploaded audio files

## 1. Install dependencies

```powershell
npm install
```

## 2. Configure MongoDB

Copy `.env.example` to `.env` (the ZIP intentionally does not include a `.env` file), then replace the example hostname, username, and password with your real MongoDB Atlas connection string. Do not publish `.env` or commit database credentials. The example URL will not connect until you replace all placeholder values.

```env
DATABASE_URL="mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/orb_music?retryWrites=true&w=majority"
```

The `/orb_music` part is required: without a database path, MongoDB may select a different default database. URL-encode special characters in the database password and allow your development IP in MongoDB Atlas Network Access. In Atlas, create a database user and copy the connection string from **Connect → Drivers**. The hostname must be your actual cluster hostname, not the placeholder `CLUSTER_HOST`.

## 3. Prepare the database

```powershell
npm run db:push
```

The app starts with whatever tracks are already in the database. `npm run db:seed` remains available only if you deliberately want the original demo sample tracks; it is not required for a real, empty library.

If either `/api/tracks` or `/api/tracks/upload` cannot access MongoDB, the API returns a configuration hint. Check the terminal where `npm run dev` is running for the detailed Prisma error. A working `.env` and successful `npm run db:push` are required before listing or uploading tracks.

## 4. Run Orb Music

```powershell
npm run dev
```

Open http://localhost:3000.

## Add songs from your computer

1. Start the app and connect the database.
2. In Orb Music, fill in Artist, Album, and Mood if you know them. These fields apply to the next selected batch; leave them blank if they do not apply.
3. Click **Add songs** and select one or more audio files.
4. The app reads the audio duration in the browser, uploads the audio files either to Supabase Storage (when configured) or to `public/uploads/` on a local server, and saves each track's metadata and audio URL in MongoDB.

Supported extensions: MP3, WAV, OGG/OGA, M4A, AAC, FLAC, and WEBM. Each file is limited to 50 MB and the combined batch to 100 MB. Track titles are generated from the filenames, with a suffix added if a title already exists.

## Security note

Never share `.env` or put real database credentials in `.env.example`. If a database password was shared or uploaded accidentally, rotate it in MongoDB Atlas and update your local `.env`.

## Storage note

The MongoDB record and the audio file are both required for playback. When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set, a local server stores uploaded audio in `public/uploads/`; that works for local development and a persistent server, but may not persist across redeploys. On Vercel (and other read-only/function hosts) the local fallback is disabled: configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and redeploy, otherwise `/api/tracks/upload` returns 503. Supabase uploads use signed URLs and store the public audio URL in MongoDB. See `FIX_UPLOAD.md` for setup instructions. The upload endpoint is intended for local/private use; add real authentication, authorization, and rate limiting before exposing uploads publicly.

## Current limitations

- Account sign-in is still a browser-only profile preview, not secure authentication. Do not enter a real password.
- Favorites are saved in this browser's local storage, not in MongoDB.
- Radio is not connected to a live station provider.
- Without Supabase, uploaded song files are stored locally in `public/uploads/`; keep backups of that folder along with your database. With Supabase, back up the storage bucket instead.
