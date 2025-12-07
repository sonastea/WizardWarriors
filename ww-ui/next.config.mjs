import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: process.env.NODE_ENV === "production" ? true : false,
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname, ".."),
    resolveAlias: {
      "@common": path.resolve(__dirname, "../common"),
    },
  },
};

export default nextConfig;
