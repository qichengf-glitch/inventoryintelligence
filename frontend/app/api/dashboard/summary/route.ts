import { NextResponse } from "next/server";

import { getDashboardSummary } from "@/lib/dashboard/getDashboardSummary";

export async function GET() {
  const summary = await getDashboardSummary();
  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
