# Fixing MongoDB / song upload errors

The uploaded project configuration used a MongoDB Atlas URL with no database name in the path (it ended in `mongodb.net/?...`). Prisma may then target a default database instead of `orb_music`, which can fail when the database user is scoped to a specific database. The API now detects this configuration before attempting to list or upload tracks and returns a clear setup message.

1. Rotate your MongoDB Atlas database user's password if it was ever shared or included in an uploaded archive.
2. Copy `.env.example` to `.env`.
3. Put your real connection details in `.env` and make sure the URL contains `/orb_music` before the query string:

   `DATABASE_URL="mongodb+srv://USERNAME:PASSWORD@YOUR_CLUSTER_HOST/orb_music?retryWrites=true&w=majority"`

4. In Atlas Network Access, allow your current IP address. Ensure the database user has read/write access to `orb_music`.
5. Run these commands from the project folder:

   ```powershell
   npm install
   npm run db:push
   npm run dev
   ```

`npm run db:push` must succeed before listing or uploading songs. The ZIP intentionally excludes `.env` and `.next`; never ship real database credentials in `.env.example`.
