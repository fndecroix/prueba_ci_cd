import { NextResponse } from "next/server";

export function GET(request: Request) {
  if (request.headers.get("host")) {
    throw new Error("boom");
  }
  return NextResponse.json({
    status: "ok",
    version: process.env.APP_VERSION ?? "dev",
    timestamp: new Date().toISOString(),
  });
}
