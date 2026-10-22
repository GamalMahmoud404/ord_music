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

## Deploying to Vercel

If the app opens on Vercel but the library is empty, work through this checklist:

1. **Environment variable:** In Vercel → Project Settings → Environment Variables, add `DATABASE_URL` with exactly the same Atlas connection string you use locally. Add it to **Production** and **Preview** if you open preview URLs. Redeploy after adding or changing it. A local `.env` file is not uploaded to Vercel.
2. **Database name:** keep the `/orb_music` path before the query string. If Vercel points to a different database or cluster than your local setup, it will connect successfully but show no songs.
3. **Network Access:** in MongoDB Atlas → Network Access, allow `0.0.0.0/0`. Vercel functions use dynamic IP addresses, so allowing only your home IP blocks them.
4. **Schema:** run `npm run db:push` once from your machine using the Atlas URL. `npm run build` on Vercel runs `prisma generate`, but it does not push the schema or copy data.
5. **Check the API:** open `https://your-deployment.vercel.app/api/tracks` in a browser. It returns a JSON error describing the problem. Also check Vercel → Deployments → Functions → Logs.
6. **Normalize the value:** paste the URL without surrounding quotes in the Vercel dashboard. URL-encode special characters in the database password.

The app now keeps a visible error panel with a **Retry** button when the library cannot be loaded, instead of hiding the error in a short toast.

**Audio files on Vercel:** database rows are not enough — the audio files must also be reachable. Songs whose `audio` field starts with `/uploads/` point to the local `public/uploads/` folder, which is gitignored and is not present on Vercel; those songs will display but return `404` when played. Configure Supabase Storage (see `FIX_UPLOAD.md`), add the same variables to Vercel, then run `npm run storage:migrate` locally to upload the existing files and update their MongoDB URLs in place. New uploads through the app go straight to Supabase when it is configured.

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
