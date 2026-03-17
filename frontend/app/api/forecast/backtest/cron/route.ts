/**
 * GET /api/forecast/backtest/cron
 * Vercel Cron Job endpoint — runs every 2 weeks (see vercel.json).
 * Protected by CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Vercel sets Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;
    const res = await fetch(`${baseUrl}/api/forecast/backtest/run?triggered_by=cron&max_skus=500`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const body = await res.json();
    if (!res.ok) {
      console.error("[backtest/cron] run failed:", body);
      return NextResponse.json({ error: body.error ?? "Run failed" }, { status: 500 });
    }

    console.log("[backtest/cron] done:", body);
    return NextResponse.json({ ok: true, ...body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron error";
    console.error("[backtest/cron]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
