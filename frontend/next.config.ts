import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "path";

// Load environment variables from root .env.local
config({ path: path.resolve(__dirname, "../.env.local") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
