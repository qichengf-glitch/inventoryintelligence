import { NextRequest, NextResponse } from "next/server";

import {
  computeAlertsSnapshot,
  resolveInventoryAlertConfig,
} from "@/lib/alerts/computeAlerts";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALERT_INVENTORY_CONFIG = resolveInventoryAlertConfig();

const INVENTORY_TABLE_NAME = ALERT_INVENTORY_CONFIG.inventoryTableName;
const SKU_COL = ALERT_INVENTORY_CONFIG.skuCol;
const ON_HAND_COL = ALERT_INVENTORY_CONFIG.onHandCol;

async function getSupabaseForAlerts() {
  try {
    return { supabase: createSupabaseAdminClient(), source: "admin" as const };
  } catch {
    return { supabase: createSupabaseClient(), source: "anon" as const };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || "latest";
    const { supabase, source } = await getSupabaseForAlerts();

    const payload = await computeAlertsSnapshot(supabase, {
      month,
      config: ALERT_INVENTORY_CONFIG,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "X-Alerts-Inventory-Table": INVENTORY_TABLE_NAME,
        "X-Alerts-Sku-Col": SKU_COL,
        "X-Alerts-OnHand-Col": ON_HAND_COL,
        "X-Alerts-Source": source,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build inventory alerts";
    console.error("[api/inventory/alerts] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
