import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Prisma's generated client and native query engine out of the server
  // bundle so the correct Linux engine is used on Vercel/serverless hosts.
  serverExternalPackages: ["@prisma/client"],
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] }
};

export default nextConfig;
