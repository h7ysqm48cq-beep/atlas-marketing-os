import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

export const WORKER_CAPABILITY_HEADER = "x-atlas-worker-capability";

export function isSupervisorWorkerPath(path: string[]): boolean {
  return path[0] === "engineering" && path[1] === "supervisor" && path[2] === "worker";
}

export function getForwardAuthorization({
  path,
  workerCapability,
  sessionAccessToken,
}: {
  path: string[];
  workerCapability: string;
  sessionAccessToken: string;
}):
  | { authorization: string }
  | { error: "worker_capability_required" | "session_required" } {
  if (isSupervisorWorkerPath(path)) {
    return workerCapability.trim()
      ? { authorization: `Bearer ${workerCapability.trim()}` }
      : { error: "worker_capability_required" };
  }

  return sessionAccessToken.trim()
    ? { authorization: `Bearer ${sessionAccessToken.trim()}` }
    : { error: "session_required" };
}

function getApiBaseUrl() {
  const configured =
    process.env.ATLAS_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configured) {
    throw new Error("ATLAS_API_URL is not configured.");
  }

  return configured.replace(/\/+$/, "");
}

export async function forward(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const workerPath = isSupervisorWorkerPath(path);
  const workerCapability = request.headers.get(WORKER_CAPABILITY_HEADER) ?? "";

  let sessionAccessToken = "";
  let hasClaims = false;
  if (!workerPath) {
    const supabase = await createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const { data: claimsData } = await supabase.auth.getClaims();
    sessionAccessToken = sessionData.session?.access_token ?? "";
    hasClaims = Boolean(claimsData?.claims);
  }

  const auth = getForwardAuthorization({
    path,
    workerCapability,
    sessionAccessToken,
  });
  if ("error" in auth || (!workerPath && !hasClaims)) {
    return NextResponse.json(
      {
        message:
          "error" in auth && auth.error === "worker_capability_required"
            ? "Worker capability is required."
            : "Authentication is required.",
      },
      { status: 401 },
    );
  }

  const target = new URL(
    path.length ? `/${path.join("/")}` : "/",
    getApiBaseUrl(),
  );
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete(WORKER_CAPABILITY_HEADER);
  headers.set("authorization", auth.authorization);

  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.arrayBuffer();

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
