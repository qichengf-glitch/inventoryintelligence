import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ThresholdPayload = {
  sku?: string;
  safety_stock?: number | null;
  high_stock?: number | null;
};

function parseIntegerField(name: "safety_stock" | "high_stock", value: unknown) {
  if (value === undefined) return { ok: true as const, value: undefined };
  if (value === null) return { ok: true as const, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return {
      ok: false as const,
      error: `${name} must be an integer >= 0, or null`,
    };
  }
  return { ok: true as const, value };
}

async function getSupabaseForThresholds() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ThresholdPayload;
    const rawSku = String(body?.sku ?? "").trim();
    if (!rawSku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }

    const safetyParsed = parseIntegerField("safety_stock", body?.safety_stock);
    if (!safetyParsed.ok) {
      return NextResponse.json({ error: safetyParsed.error }, { status: 400 });
    }
    const highParsed = parseIntegerField("high_stock", body?.high_stock);
    if (!highParsed.ok) {
      return NextResponse.json({ error: highParsed.error }, { status: 400 });
    }

    const schema = getInventoryConfig().schema;
    const supabase = await getSupabaseForThresholds();
    const tableRef = schema
      ? supabase.schema(schema).from("sku_thresholds")
      : supabase.from("sku_thresholds");

    const payload = {
      sku: rawSku,
      safety_stock: safetyParsed.value ?? null,
      high_stock: highParsed.value ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await tableRef.upsert(payload, { onConflict: "sku" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update thresholds";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
