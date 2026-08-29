import { NextRequest } from "next/server";
import { forward } from "./forward";

const forwardRoot = (request: NextRequest) =>
  forward(request, {
    params: Promise.resolve({ path: [] }),
  });

export const GET = forwardRoot;
export const HEAD = forwardRoot;
export const POST = forwardRoot;
export const PUT = forwardRoot;
export const PATCH = forwardRoot;
export const DELETE = forwardRoot;
