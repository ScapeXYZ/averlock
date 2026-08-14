import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel packages Next.js with its native runtime. Keep the standalone
  // server only for self-hosted builds such as the root Dockerfile.
  ...(process.env.VERCEL === "1" ? {} : { output: "standalone" as const }),
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
};

export default nextConfig;
