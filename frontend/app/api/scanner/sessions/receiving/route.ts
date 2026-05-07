import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scanner/sessions/receiving
 * Upsert a scan_session_items row for a RECEIVING session.
 * Returns updated totals for this SKU within the session.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      session_id?: string;
      po_reference: string;
      sku: string;
      qty: number;
      movement_id?: string;
    };

    const { session_id, po_reference, sku, qty, movement_id } = body;
    if (!po_reference?.trim()) return NextResponse.json({ error: "po_reference required" }, { status: 400 });
    if (!sku?.trim())          return NextResponse.json({ error: "sku required" },          { status: 400 });
    if (!qty || qty <= 0)      return NextResponse.json({ error: "qty must be positive" },  { status: 400 });

    const supabase = createSupabaseAdminClient();

    // ── Ensure session exists ────────────────────────────────────────────
    let sid = session_id;
    if (!sid) {
      // Look for an active RECEIVING session with this PO reference
      const { data: existing } = await supabase
        .from("scan_sessions")
        .select("id")
        .eq("session_type", "RECEIVING")
        .eq("reference", po_reference.trim())
        .eq("status", "active")
        .maybeSingle();

      if (existing) {
        sid = existing.id as string;
      } else {
        const { data: created, error: createErr } = await supabase
          .from("scan_sessions")
          .insert({ session_type: "RECEIVING", reference: po_reference.trim(), status: "active" })
          .select("id")
          .single();
        if (createErr) throw createErr;
        sid = created.id as string;
      }
    }

    // ── Upsert item row ──────────────────────────────────────────────────
    const { data: existing_item } = await supabase
      .from("scan_session_items")
      .select("id, scanned_qty")
      .eq("session_id", sid)
      .eq("sku", sku.trim())
      .maybeSingle();

    let new_qty = qty;
    if (existing_item) {
      new_qty = (existing_item.scanned_qty as number) + qty;
      const { error } = await supabase
        .from("scan_session_items")
        .update({ scanned_qty: new_qty, ...(movement_id ? { movement_id } : {}) })
        .eq("id", existing_item.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("scan_session_items")
        .insert({ session_id: sid, sku: sku.trim(), scanned_qty: qty, movement_id: movement_id ?? null });
      if (error) throw error;
    }

    // ── Return full session summary ──────────────────────────────────────
    const { data: all_items } = await supabase
      .from("scan_session_items")
      .select("sku, scanned_qty, expected_qty")
      .eq("session_id", sid);

    const po_status =
      new_qty === 0 ? "pending"
      : new_qty > 500 ? "over_received"   // simple heuristic — replace with real PO qty later
      : "received";

    return NextResponse.json({
      session_id: sid,
      sku,
      received_so_far: new_qty,
      po_status,
      session_items: all_items ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
