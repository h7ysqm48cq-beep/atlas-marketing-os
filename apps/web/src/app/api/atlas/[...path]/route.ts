import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function getApiBaseUrl() {
  const configured =
    process.env.ATLAS_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!configured) {
    throw new Error("ATLAS_API_URL is not configured.");
  }

  return configured.replace(/\/+$/, "");
}

async function forward(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!sessionData.session?.access_token || !claimsData?.claims) {
    return NextResponse.json(
      { message: "Authentication is required." },
      { status: 401 },
    );
  }

  const { path } = await context.params;
  const target = new URL(`/${path.join("/")}`, getApiBaseUrl());
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("authorization", `Bearer ${sessionData.session.access_token}`);

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

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
