import type { NextConfig } from "next";
import { config } from "dotenv";
import path from "path";

// Load environment variables from root .env.local
config({ path: path.resolve(__dirname, "../.env.local") });

const nextConfig: NextConfig = {
  // Events + Insights merged into Intelligence (GH #12). Keep the old paths
  // working for bookmarks and any in-flight links. Not permanent — these are
  // product-IA moves, not canonical URL changes, so we keep the option to
  // reshape the routes again without a cached 308 in every browser.
  async redirects() {
    return [
      { source: '/events', destination: '/intelligence', permanent: false },
      { source: '/insights', destination: '/intelligence', permanent: false },
    ];
  },
};

export default nextConfig;
