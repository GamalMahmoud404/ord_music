type PrismaLikeError = {
  code?: unknown;
  errorCode?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: unknown;
};

function errorParts(error: unknown) {
  const value = error as PrismaLikeError | null;
  // PrismaClientInitializationError stores P1xxx codes in `errorCode`, while
  // PrismaClientKnownRequestError uses `code`. Check both.
  const code = typeof value?.errorCode === "string"
    ? value.errorCode
    : typeof value?.code === "string"
      ? value.code
      : "";
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
    return "MongoDB is not configured. Add DATABASE_URL in your local .env, or in your hosting provider's environment variables (for Vercel: Project Settings → Environment Variables, for both Production and Preview), then redeploy.";
  }
  if (url.includes("USERNAME:PASSWORD") || url.includes("CLUSTER_HOST") || url.includes("CLUSTER.mongodb.net")) {
    return "DATABASE_URL still contains placeholder values. Replace the username, password, and cluster hostname in the environment used by this deployment.";
  }
  if (databaseUrlLooksIncomplete()) {
    return "DATABASE_URL is missing the database name. Add /orb_music before the query string in your local .env or hosting environment variables, for example: mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/orb_music?retryWrites=true&w=majority";
  }
  return null;
}

export function databaseErrorCode(error: unknown): string | null {
  const { code } = errorParts(error);
  // Only expose stable Prisma error codes, never raw messages or connection strings.
  return /^P\d{4}$/.test(code) ? code : null;
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
    code === "P1002" ||
    code === "P1008" ||
    code === "P1017" ||
    combined.includes("can't reach database server") ||
    combined.includes("cannot reach database server") ||
    combined.includes("server selection") ||
    combined.includes("connect econnrefused") ||
    combined.includes("connect econnreset") ||
    combined.includes("connect timeout") ||
    combined.includes("connection timed out") ||
    combined.includes("connection reset") ||
    combined.includes("operation timed out") ||
    combined.includes("enotfound") ||
    combined.includes("getaddrinfo") ||
    combined.includes("querysrv") ||
    combined.includes("dns resolution") ||
    combined.includes("no record found") ||
    combined.includes("not whitelisted") ||
    combined.includes("whitelist") ||
    combined.includes("network is unreachable")
  ) {
    return "Cannot reach MongoDB Atlas. Verify the exact cluster hostname and Atlas → Network Access. On Vercel, function IPs are dynamic, so add 0.0.0.0/0 to the Atlas IP access list, then redeploy if you changed environment variables.";
  }

  if (code === "P1013" || combined.includes("invalid connection string") || combined.includes("malformed mongodb")) {
    return "DATABASE_URL is invalid. Copy the MongoDB Atlas Drivers connection string into .env or your hosting environment variables, and replace the username, password, and cluster hostname.";
  }

  if (code === "P2021" || code === "P2022" || combined.includes("does not exist in the current database")) {
    return "The database schema is not ready. Confirm DATABASE_URL points to /orb_music and run npm run db:push from your machine using the same connection string.";
  }

  if (combined.includes("could not locate the query engine") || combined.includes("query engine library") || combined.includes("query engine for runtime")) {
    return "Prisma Client could not start in this deployment. Make sure the build command runs prisma generate (npm run build already does) and redeploy.";
  }

  if (databaseUrlLooksIncomplete()) {
    return "DATABASE_URL is incomplete. Use your real Atlas URL and include /orb_music before the query string in .env or your hosting environment variables, for example: mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/orb_music?retryWrites=true&w=majority";
  }

  if (combined.includes("enospc") || combined.includes("no space left on device")) {
    return "The server has no free disk space to save the audio file. Free up disk space and try again.";
  }

  if (combined.includes("eacces") || combined.includes("eperm") || combined.includes("permission denied")) {
    return "The server cannot write the uploaded audio file. Make sure the project folder and public/uploads are writable.";
  }

  // Do not return raw Prisma errors to the browser: they may include connection details.
  console.error("Unclassified database/upload error message:", message || "No error message available");
  return "The request failed. Check the deployment logs (on Vercel: Deployments → Functions → Logs) for the detailed error, then verify DATABASE_URL, Atlas Network Access, database permissions, and that the schema was pushed.";
}
