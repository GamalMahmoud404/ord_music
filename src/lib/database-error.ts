type PrismaLikeError = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: unknown;
};

function errorParts(error: unknown) {
  const value = error as PrismaLikeError | null;
  const code = typeof value?.code === "string" ? value.code : "";
  const message = typeof value?.message === "string" ? value.message : "";
  const name = typeof value?.name === "string" ? value.name : "";
  return { code, message, combined: `${code} ${name} ${message}`.toLowerCase() };
}

function databaseUrlLooksIncomplete() {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url || url.includes("USERNAME:PASSWORD") || url.includes("CLUSTER_HOST") || url.includes("CLUSTER.mongodb.net")) {
    return true;
  }

  // MongoDB Atlas URLs should name the target database, e.g. /orb_music?retryWrites=true.
  // A URL with no path often connects to the default `test` database instead.
  const afterHost = url.match(/^mongodb(?:\+srv)?:\/\/[^/]+(\/[^?]*)?/i);
  return !afterHost?.[1] || afterHost[1] === "/";
}

export function databaseConfigurationError(): string | null {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) {
    return "MongoDB is not configured. Copy .env.example to .env, enter your real MongoDB Atlas connection string, then run npm run db:push.";
  }
  if (url.includes("USERNAME:PASSWORD") || url.includes("CLUSTER_HOST") || url.includes("CLUSTER.mongodb.net")) {
    return "Replace the placeholder values in .env with your real MongoDB Atlas username, password, and cluster hostname.";
  }
  if (databaseUrlLooksIncomplete()) {
    return "DATABASE_URL is missing the database name. Add /orb_music before the query string, for example: mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/orb_music?retryWrites=true&w=majority";
  }
  return null;
}

export function databaseErrorMessage(error: unknown): string {
  const { code, message, combined } = errorParts(error);

  if (code === "P1000" || combined.includes("authentication failed") || combined.includes("bad auth")) {
    return "MongoDB rejected the login. Check the database username and password in .env; URL-encode special characters in the password.";
  }

  if (code === "P1010" || combined.includes("not authorized") || combined.includes("unauthorized") || combined.includes("not authorized on")) {
    return "MongoDB connected, but this database user does not have permission for the selected database. Set the URL database path to /orb_music and grant the user read/write access to that database.";
  }

  if (
    code === "P1001" ||
    combined.includes("server selection timed out") ||
    combined.includes("connect econnrefused") ||
    combined.includes("enotfound") ||
    combined.includes("querysrv") ||
    combined.includes("dns resolution") ||
    combined.includes("no record found")
  ) {
    return "Cannot reach MongoDB Atlas. Copy the exact hostname from Atlas → Connect → Drivers, check your internet connection, and add your current IP in Atlas Network Access.";
  }

  if (code === "P1013" || combined.includes("invalid connection string") || combined.includes("malformed mongodb")) {
    return "DATABASE_URL is invalid. Copy the MongoDB Atlas Drivers connection string and replace the username, password, and cluster hostname.";
  }

  if (code === "P2021" || code === "P2022" || combined.includes("does not exist in the current database")) {
    return "The database schema is not ready. Confirm DATABASE_URL points to /orb_music, stop the dev server, and run: npm run db:push";
  }

  if (databaseUrlLooksIncomplete()) {
    return "DATABASE_URL is incomplete. In .env, use your real Atlas URL and include /orb_music before the query string, for example: mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/orb_music?retryWrites=true&w=majority";
  }

  if (combined.includes("enospc") || combined.includes("no space left on device")) {
    return "The server has no free disk space to save the audio file. Free up disk space and try again.";
  }

  if (combined.includes("eacces") || combined.includes("eperm") || combined.includes("permission denied")) {
    return "The server cannot write the uploaded audio file. Make sure the project folder and public/uploads are writable.";
  }

  // Do not return raw Prisma errors to the browser: they may include connection details.
  console.error("Unclassified database/upload error message:", message || "No error message available");
  return "The request failed. Check the terminal running npm run dev for the detailed error; verify MongoDB connection, schema, and write access to public/uploads.";
}
