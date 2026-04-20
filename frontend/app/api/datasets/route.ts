import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function toMonthLabel(value: string | null) {
  if (!value) return null;
  const month = value.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : value;
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();

    const result = await supabase
      .from("upload_records")
      .select("id, month, row_count, created_at, storage_path")
      .order("month", { ascending: false })
      .order("created_at", { ascending: false });

    if (result.error) {
      throw new Error(result.error.message);
    }

    const datasets = (result.data || []).map((row) => ({
      id: row.id,
      month: toMonthLabel(typeof row.month === "string" ? row.month : null),
      row_count: row.row_count,
      created_at: row.created_at,
      storage_path: row.storage_path,
    }));

    return NextResponse.json({ datasets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list datasets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
