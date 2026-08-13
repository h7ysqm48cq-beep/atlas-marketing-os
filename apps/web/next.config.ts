import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function resolveAtlasBuild() {
  if (process.env.NEXT_PUBLIC_ATLAS_BUILD) {
    return process.env.NEXT_PUBLIC_ATLAS_BUILD;
  }

  /*
   * Railway exposes Git commit information during deployments
   * when the service is connected to GitHub.
   */
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7);
  }

  /*
   * Local development/build fallback.
   */
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

const atlasBuild = resolveAtlasBuild();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_ATLAS_BUILD: atlasBuild,
  },
};

export default nextConfig;
