import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES = ["IN_PURCHASE", "IN_RETURN", "OUT_SALES", "OUT_DAMAGED", "ADJUSTMENT"] as const;
type MovementType = (typeof VALID_TYPES)[number];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku") || "";
    const type = searchParams.get("type") || "";
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const page = Math.max(1, Number(searchParams.get("page") || "1"));
    const limit = 50;
    const offset = (page - 1) * limit;

    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("stock_movements")
      .select("*", { count: "exact" })
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (sku) query = query.ilike("sku", `%${sku}%`);
    if (type && VALID_TYPES.includes(type as MovementType)) query = query.eq("movement_type", type);
    if (from) query = query.gte("movement_date", from);
    if (to) query = query.lte("movement_date", to);

    const { data, error, count } = await query;
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ data: [], total: 0, page, limit, tableReady: false });
      }
      throw error;
    }

    // Summary stats for the filtered results — apply same filters as main query
    let statsQuery = supabase
      .from("stock_movements")
      .select("movement_type, qty");

    if (sku) statsQuery = statsQuery.ilike("sku", `%${sku}%`);
    if (type && VALID_TYPES.includes(type as MovementType)) statsQuery = statsQuery.eq("movement_type", type);
    if (from) statsQuery = statsQuery.gte("movement_date", from);
    if (to) statsQuery = statsQuery.lte("movement_date", to);

    const { data: statsData } = await statsQuery;
    const stats = { total_in: 0, total_out: 0, total_adj: 0, total_movements: count ?? 0 };
    for (const row of statsData ?? []) {
      if (row.movement_type === "IN_PURCHASE" || row.movement_type === "IN_RETURN") stats.total_in += row.qty;
      else if (row.movement_type === "OUT_SALES" || row.movement_type === "OUT_DAMAGED") stats.total_out += Math.abs(row.qty);
      else stats.total_adj += row.qty;
    }

    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit, tableReady: true, stats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch movements" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sku?: string;
      batch?: string;
      movement_type?: string;
      qty?: unknown;
      reference_no?: string;
      notes?: string;
      movement_date?: string;
      created_by?: string;
    };
    const { sku, batch, movement_type, qty, reference_no, notes, movement_date, created_by } = body;

    if (!sku?.trim()) return NextResponse.json({ error: "SKU is required" }, { status: 400 });
    if (!movement_type) return NextResponse.json({ error: "movement_type is required" }, { status: 400 });
    if (!VALID_TYPES.includes(movement_type as MovementType)) {
      return NextResponse.json(
        { error: `movement_type must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const parsedQty = Number(qty);
    if (!Number.isInteger(parsedQty) || parsedQty === 0) {
      return NextResponse.json({ error: "qty must be a non-zero integer" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("stock_movements")
      .insert({
        sku: sku.trim(),
        batch: batch?.trim() || null,
        movement_type,
        qty: parsedQty,
        reference_no: reference_no?.trim() || null,
        notes: notes?.trim() || null,
        movement_date: movement_date || new Date().toISOString().slice(0, 10),
        created_by: created_by?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create movement" },
      { status: 500 }
    );
  }
}
