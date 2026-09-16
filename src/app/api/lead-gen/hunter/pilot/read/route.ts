import { NextResponse } from "next/server";
import { authenticateIngestionRequest, IngestionAuthError } from "@/server/ingestion-auth";
import { readHunterPilot } from "@/modules/lead-gen/hunter-pilot-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST carries a bounded search request; every operation is read-only. */
export async function POST(request: Request) {
  try {
    const tenant = await authenticateIngestionRequest(request);
    const raw = await request.text();
    if (raw.length > 8_000) return NextResponse.json({ error: "INPUT_TOO_LARGE" }, { status: 400 });
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    return NextResponse.json({ data: await readHunterPilot(input, tenant) });
  } catch (error) {
    const status = error instanceof IngestionAuthError ? error.status : error instanceof SyntaxError ? 400 : 422;
    // Never return raw provider/Prisma error text or a connection string.
    const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : "PILOT_READ_UNAVAILABLE";
    return NextResponse.json({ error: code }, { status });
  }
}
