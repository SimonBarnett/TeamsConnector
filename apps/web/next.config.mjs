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
    return config;
  },
};

export default nextConfig;
