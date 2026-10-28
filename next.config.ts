import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    authInterrupts: true,
  },
  // The contract PDF embeds this file at runtime (nodejs route).
  outputFileTracingIncludes: {
    "/app/personas/[id]/contratos/[contractId]/pdf": [
      "./src/lib/contracts/fonts/**/*",
    ],
  },
};

export default nextConfig;
