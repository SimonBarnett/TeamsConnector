import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcIndex = (pkg) => path.join(repoRoot, "packages", pkg, "src", "index.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: [
    "@teams-audio-join/mcp-host",
    "@teams-audio-join/shared",
    "@teams-audio-join/store",
    "@teams-audio-join/orchestrator",
    "@teams-audio-join/graph",
    "@teams-audio-join/summarizer",
    "@teams-audio-join/workflows",
  ],
  serverExternalPackages: ["pg"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".ts": [".ts", ".js"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@teams-audio-join/shared": srcIndex("shared"),
      "@teams-audio-join/store": srcIndex("store"),
      "@teams-audio-join/orchestrator": srcIndex("orchestrator"),
      "@teams-audio-join/graph": srcIndex("graph"),
      "@teams-audio-join/summarizer": srcIndex("summarizer"),
      "@teams-audio-join/workflows": srcIndex("workflows"),
    };
    return config;
  },
};

export default nextConfig;
