import { NextResponse } from "next/server";

export function GET() {
  throw new Error("boom");
  return NextResponse.json({
    status: "ok",
    version: process.env.APP_VERSION ?? "dev",
    timestamp: new Date().toISOString(),
  });
}
