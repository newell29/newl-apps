import { NextResponse } from "next/server";

import { IngestionAuthError } from "@/server/ingestion-auth";
import { IngestionValidationError } from "@/modules/trademining/ingestion";

export function jsonError(error: unknown) {
  if (error instanceof IngestionValidationError) {
    return NextResponse.json(
      {
        error: "Validation failed.",
        details: error.details
      },
      { status: error.status }
    );
  }

  if (error instanceof IngestionAuthError) {
    return NextResponse.json(
      {
        error: error.message
      },
      { status: error.status }
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      error: "Unexpected ingestion API error."
    },
    { status: 500 }
  );
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
