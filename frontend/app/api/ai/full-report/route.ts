import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function getSupabase() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

/** Collect summary data from dashboard + alerts for the report prompt */
async function collectReportData() {
  const supabase = await getSupabase();
  const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
  const ref = (t: string) => (schema ? supabase.schema(schema).from(t) : supabase.from(t));

  // Latest month from inventory_monthly
  const monthRes = await ref("inventory_monthly")
    .select("month")
    .order("month", { ascending: false })
    .limit(1);
  const latestMonth: string =
    monthRes.data?.[0]?.month
      ? String(monthRes.data[0].month).slice(0, 7)
      : "N/A";

  // KPIs from dashboard_monthly_summary (latest row)
  const kpiRes = await ref("dashboard_monthly_summary")
    .select("*")
    .order("month", { ascending: false })
    .limit(1);
  const kpi = (kpiRes.data?.[0] ?? {}) as Record<string, unknown>;

  // Alert thresholds counts from sku_thresholds + inventory latest month
  const threshRes = await ref("sku_thresholds").select("sku,safety_stock,high_stock").limit(10000);
  const thresholds = (threshRes.data ?? []) as Array<{ sku: string; safety_stock: number; high_stock: number }>;

  // Latest month inventory rows — use SELECT * to avoid missing column errors
  const timeKey = timeColumn || "month";
  const invRes = await ref(table)
    .select("*")
    .eq(timeKey, `${latestMonth}-01`)
    .limit(5000);

  // If eq on full date fails (e.g. stored as "2025-12"), try ilike
  const invRows = ((invRes.data?.length ? invRes.data : (
    await ref(table).select("*").ilike(timeKey, `${latestMonth}%`).limit(5000)
  ).data) ?? []) as Array<Record<string, unknown>>;

  // Compute per-SKU stock vs threshold
  const threshMap = new Map(thresholds.map((t) => [t.sku, t]));
  let oosCount = 0;
  let lowCount = 0;
  let highCount = 0;
  let totalStock = 0;
  let totalSales = 0;
  const stockBySku = new Map<string, number>();

  for (const row of invRows) {
    const sku = String(row[skuColumn] ?? "").trim();
    if (!sku) continue;
    const stock = Number(row[stockColumn] ?? 0);
    const sales = Number(row[salesColumn] ?? 0);
    totalStock += stock;
    totalSales += sales;
    stockBySku.set(sku, (stockBySku.get(sku) ?? 0) + stock);
  }

  const DEFAULT_SS = 10;
  const DEFAULT_HIGH = 200;
  for (const [sku, onHand] of stockBySku.entries()) {
    const t = threshMap.get(sku);
    const ss = t?.safety_stock ?? DEFAULT_SS;
    const high = t?.high_stock ?? DEFAULT_HIGH;
    if (onHand <= 0) oosCount++;
    else if (onHand <= ss) lowCount++;
    else if (onHand >= high) highCount++;
  }

  const totalSkus = stockBySku.size;
  const riskSkus = oosCount + lowCount;
  const healthySkus = totalSkus - riskSkus - highCount;
  const healthyPct = totalSkus > 0 ? ((healthySkus / totalSkus) * 100).toFixed(1) : "0";
  const stockCover = totalSales > 0 ? (totalStock / totalSales).toFixed(1) : "N/A";

  // Slow movers count from inventory_summary (rough proxy: skus with 0 sales in latest 2 months)
  const slowMoversRes = await ref("inventory_monthly")
    .select("sku, month_sales, month_end_stock")
    .order("month", { ascending: false })
    .limit(10000);
  const slowRows = (slowMoversRes.data ?? []) as Array<{ sku: string; month_sales: number; month_end_stock: number }>;
  const skuSalesCount = new Map<string, number>();
  for (const r of slowRows) {
    if (!r.sku) continue;
    if (r.month_sales > 0) skuSalesCount.set(r.sku, (skuSalesCount.get(r.sku) ?? 0) + 1);
  }
  let slowMoverCount = 0;
  for (const [sku, count] of skuSalesCount.entries()) {
    const s = stockBySku.get(sku) ?? 0;
    if (s > 0 && count === 0) slowMoverCount++;
  }

  return {
    latestMonth,
    totalSkus,
    riskSkus,
    healthySkus,
    healthyPct,
    oosCount,
    lowCount,
    highCount,
    totalStock: Math.round(totalStock).toLocaleString(),
    totalSales: Math.round(totalSales).toLocaleString(),
    stockCover,
    thresholdsConfigured: thresholds.length,
    slowMoverCount,
    kpi,
  };
}

function buildReportPrompt(data: Awaited<ReturnType<typeof collectReportData>>, lang: "zh" | "en") {
  const d = data;

  if (lang === "zh") {
    return `你是一位资深库存管理顾问，请根据以下数据生成一份供管理层和客户阅读的月度库存管理报告。
报告要求：
- 语言：中文，正式商务风格
- 结构：执行摘要、库存健康状况分析、核心风险与机会、销售与库存匹配度、优化建议与行动计划、结语
- 长度：800-1200字
- 格式：使用 Markdown（标题用 ##，重点用加粗，建议用列表）
- 数据驱动，每个分析结论必须引用数据
- 避免套话，给出可执行的具体建议

当月数据：
- 统计月份：${d.latestMonth}
- SKU 总数：${d.totalSkus}
- 风险 SKU（缺货+低库存）：${d.riskSkus}（占比 ${d.totalSkus > 0 ? ((d.riskSkus / d.totalSkus) * 100).toFixed(1) : 0}%）
- 健康 SKU：${d.healthySkus}（占比 ${d.healthyPct}%）
- 缺货 SKU：${d.oosCount}
- 低库存 SKU：${d.lowCount}
- 高库存 SKU：${d.highCount}
- 当前总库存：${d.totalStock} 件
- 本月总销售：${d.totalSales} 件
- 库存覆盖周期：约 ${d.stockCover} 个月
- 已配置阈值的 SKU 数：${d.thresholdsConfigured}
- 疑似滞销 SKU（有库存但无销售记录）：${d.slowMoverCount}`;
  }

  return `You are a senior inventory management consultant. Generate a monthly inventory management report for management and clients based on the data below.
Report requirements:
- Language: Professional English business style
- Structure: Executive Summary, Inventory Health Analysis, Key Risks & Opportunities, Sales-Inventory Alignment, Optimization Recommendations & Action Plan, Closing Remarks
- Length: 800-1200 words
- Format: Markdown (## headings, **bold** for key points, bullet lists for recommendations)
- Data-driven: each analytical conclusion must cite numbers
- Avoid filler language; give specific, actionable recommendations

Current month data:
- Reporting month: ${d.latestMonth}
- Total SKUs: ${d.totalSkus}
- At-risk SKUs (OOS + Low stock): ${d.riskSkus} (${d.totalSkus > 0 ? ((d.riskSkus / d.totalSkus) * 100).toFixed(1) : 0}%)
- Healthy SKUs: ${d.healthySkus} (${d.healthyPct}%)
- Out of stock SKUs: ${d.oosCount}
- Low stock SKUs: ${d.lowCount}
- High stock SKUs: ${d.highCount}
- Total current stock: ${d.totalStock} units
- Monthly sales: ${d.totalSales} units
- Stock cover: ~${d.stockCover} months
- SKUs with configured thresholds: ${d.thresholdsConfigured}
- Potential slow movers (stock with no recent sales): ${d.slowMoverCount}`;
}

export async function POST(req: NextRequest) {
  try {
    const { lang = "zh" } = (await req.json()) as { lang?: "zh" | "en" };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const resolvedLang: "zh" | "en" = lang === "en" ? "en" : "zh";

    let reportData: Awaited<ReturnType<typeof collectReportData>>;
    try {
      reportData = await collectReportData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Failed to collect report data: ${msg}` }, { status: 500 });
    }

    const prompt = buildReportPrompt(reportData, resolvedLang);

    // Always use gpt-4.1 for the formal report (best quality)
    const model = "gpt-4.1";

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        input: prompt,
      }),
    });

    if (!openaiRes.ok) {
      const raw = await openaiRes.text();
      try {
        const parsed = JSON.parse(raw);
        return NextResponse.json({ error: parsed?.error?.message ?? raw }, { status: 502 });
      } catch {
        return NextResponse.json({ error: raw }, { status: 502 });
      }
    }

    const data = await openaiRes.json();
    const directText = typeof data?.output_text === "string" ? data.output_text.trim() : "";
    const outputArray = Array.isArray(data?.output) ? data.output : [];
    const fromOutput = outputArray
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((c: any) => (c?.type === "output_text" && typeof c?.text === "string" ? c.text : ""))
      .join("\n")
      .trim();
    const report = directText || fromOutput;

    if (!report) {
      return NextResponse.json({ error: "Model returned no text" }, { status: 502 });
    }

    return NextResponse.json({
      report,
      model,
      lang: resolvedLang,
      month: reportData.latestMonth,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
