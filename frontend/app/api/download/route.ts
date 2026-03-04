import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

const DEFAULT_BUCKET = process.env.SUPABASE_UPLOAD_BUCKET || "inventory-files";

export const runtime = "nodejs";

function normalizeMonth(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    throw new Error("Invalid month format. Expected YYYY-MM");
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = normalizeMonth(searchParams.get("month"));

    const supabase = createSupabaseAdminClient();
    const storagePath = `monthly/${month}.csv`;

    const result = await supabase.storage.from(DEFAULT_BUCKET).createSignedUrl(storagePath, 3600);
    if (result.error || !result.data?.signedUrl) {
      throw new Error(result.error?.message || "Failed to create signed URL");
    }

    return NextResponse.json({ month, storagePath, signedUrl: result.data.signedUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create download URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
