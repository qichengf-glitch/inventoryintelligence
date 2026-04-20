import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type TableStatus = "ok" | "missing" | "error";

type TableInfo = {
  name: string;
  rowCount: number | null;
  status: TableStatus;
  error?: string;
};

function normalizeTableList() {
  const fromEnv = (process.env.INVENTORY_TABLE || "").trim();
  const fixed = ["upload_records", "inventory_batches", "inventory_sku_monthly"];
  return Array.from(new Set(fromEnv ? [...fixed, fromEnv] : fixed));
}

function classifyError(message: string, code: string | null): TableStatus {
  const lower = message.toLowerCase();
  if (code === "42P01" || code === "PGRST205" || lower.includes("does not exist")) {
    return "missing";
  }
  return "error";
}

async function fetchTableInfo(table: string): Promise<TableInfo> {
  const supabase = createSupabaseAdminClient();
  const result = await supabase.from(table).select("*", { head: true, count: "exact" });

  if (result.error) {
    return {
      name: table,
      rowCount: null,
      status: classifyError(result.error.message, result.error.code || null),
      error: result.error.message,
    };
  }

  return {
    name: table,
    rowCount: result.count ?? 0,
    status: "ok",
  };
}

export async function GET() {
  try {
    const tables = normalizeTableList();
    const infos = await Promise.all(tables.map((table) => fetchTableInfo(table)));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      tables: infos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load data tables";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
