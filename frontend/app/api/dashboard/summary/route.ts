import { NextResponse } from "next/server";

import { getDashboardSummary } from "@/lib/dashboard/getDashboardSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const summary = await getDashboardSummary();
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build dashboard summary";
    console.error("[api/dashboard/summary] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
