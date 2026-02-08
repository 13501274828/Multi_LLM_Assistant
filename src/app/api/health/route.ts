import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "multi-llm-assistant",
    timestamp: new Date().toISOString()
  });
}
