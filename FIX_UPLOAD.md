# Fixing audio upload on Vercel (413 and invalid JSON)

On deployments the app no longer sends the audio bytes through a Next.js/Vercel API route. It asks the server for a short-lived Supabase Storage signed upload URL, uploads each audio file directly from the browser to Supabase, then saves only the public audio URL and track metadata in MongoDB. This avoids Vercel's request-body size limit and prevents HTML/text error pages from being blindly parsed as JSON.

For local development, Supabase is optional: if neither `SUPABASE_URL` nor `SUPABASE_SERVICE_ROLE_KEY` is set, `/api/tracks/upload` returns a local upload target and the bytes are written to `public/uploads/`. The fallback is automatically disabled on Vercel, Netlify, and AWS Lambda because those filesystems are read-only or ephemeral.

## 1. Set up Supabase Storage

1. Create a Supabase project at https://supabase.com/.
2. Open **Storage** and create a bucket named `tracks`.
3. Make the bucket **Public** so the audio player can stream files.
4. In Project Settings / API, copy the Project URL and the **service_role** key. Never expose the service role key in client-side code or commit it to GitHub.

## 2. Configure local `.env` and Vercel

Copy `.env.example` to `.env` and fill in your real values. In Vercel, add these under **Settings → Environment Variables** for Production (and Preview if needed):

- `DATABASE_URL` — MongoDB Atlas connection string with `/orb_music` before the query string.
- `SUPABASE_URL` — your Supabase Project URL, e.g. `https://project-ref.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` — your private service role key.
- `SUPABASE_STORAGE_BUCKET` — `tracks` unless you chose another bucket name.

Redeploy after changing environment variables. Do not prefix the service role key with `NEXT_PUBLIC_`.

**If the upload request returns `503`**, the deployment does not have a usable `SUPABASE_URL` and/or `SUPABASE_SERVICE_ROLE_KEY`. The endpoint returns a JSON error naming the missing setting. Adding code alone cannot supply these secret values; add them in Vercel and redeploy. `SUPABASE_STORAGE_BUCKET` is optional because the app defaults it to `tracks`.

## 3. Move songs that were uploaded before Supabase was configured

Songs uploaded while the local fallback was active have URLs such as `/uploads/<uuid>.mp3`. Those files exist only in the local `public/uploads/` folder, which is gitignored, so Vercel returns `404` for them and the player shows **Audio could not start**. Uploading new songs does not repair the old records; they need to be moved to Supabase and their MongoDB URLs updated.

After adding the Supabase values to your local `.env`, run:

```bash
npm run storage:migrate
```

The script creates the public `tracks` bucket if it is missing, uploads each file from `public/uploads/`, and updates the matching MongoDB track **in place** (no duplicate tracks). It is safe to run again; files are uploaded with upsert enabled. Then add the same Supabase variables to Vercel, redeploy, and hard-refresh the page.

If you prefer not to use Supabase for the old files, re-upload those songs through the app after Supabase is configured and delete the old entries that still point to `/uploads/`.

## 4. Limits and testing

The app currently accepts audio files up to 50 MB each (100 MB per selected batch) and sends them one at a time. The Supabase Storage bucket's file size limit must allow at least that size. If you get a storage upload error, check the bucket limit, service key, project URL, and that the bucket name matches exactly. The browser sends the raw audio file bytes to the signed Supabase URL (or to the local upload endpoint) rather than wrapping the file in multipart FormData.

Run `npm install`, then `npm run build` locally before pushing. Make sure `.env` remains ignored by Git.
