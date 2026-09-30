import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: для сервера (Hetzner) достаточно `node .next/standalone/server.js`
  output: "standalone",
  poweredByHeader: false,
  turbopack: { root: path.resolve(".") },
};

export default nextConfig;
