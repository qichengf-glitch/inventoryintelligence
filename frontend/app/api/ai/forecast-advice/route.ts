import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { buildSelect, getInventoryConfig } from "@/lib/inventoryConfig";

type ForecastSummary = {
  sku?: string;
  model?: string;
  horizonMonths?: number;
  leadTimeMonths?: number;
  currentStock?: number;
  safetyStock?: number;
  leadDemand?: number;
  reorderQty?: number;
  projectedStockoutMonth?: string | null;
  risk?: { label?: string; desc?: string; suggestion?: string };
  models?: Array<{ name: string; nextMonths: Array<{ month: string; value: number }> }>;
  generatedAt?: string;
};

type ChatTurn = { role: "user" | "assistant"; text: string };

type DashboardContext = {
  totalRows: number;
  sampledRows: number;
  truncated: boolean;
  totalSkus: number;
  latestMonth: string | null;
  recentMonthlyStats: Array<{ month: string; totalSales: number; totalStock: number }>;
  lowStockSkus: Array<{ sku: string; stock: number; safetyStock: number; gap: number }>;
  topSalesSkus: Array<{ sku: string; sales: number; stock: number }>;
};

function toNum(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseMonth(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 7);
  if (typeof value === "number") {
    if (value >= 190001 && value <= 210012) {
      const s = String(Math.trunc(value));
      return s.length === 6 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : null;
    }
    if (value >= 19000101 && value <= 21001231) {
      const s = String(Math.trunc(value));
      return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : null;
    }
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[年月]/g, "-").replace(/日/g, "").replace(/[./]/g, "-");
    const m = normalized.match(/(\d{4})-(\d{1,2})/);
    if (!m) return null;
    return `${m[1]}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

async function collectDashboardContext(): Promise<DashboardContext> {
  const supabase = createSupabaseClient();
  const { schema, table, skuColumn, timeColumn, salesColumn, stockColumn } = getInventoryConfig();
  const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
  const timeKey = timeColumn || "Time";

  const pageSize = 1000;
  const maxRows = 8000;
  let offset = 0;
  const rows: any[] = [];

  while (rows.length < maxRows) {
    const { data, error } = await tableRef
      .select(buildSelect([skuColumn, timeKey, salesColumn, stockColumn, "safety_stock", "category"]))
      .order(timeKey, { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Dashboard context query failed: ${error.message}`);
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }

  const sampledRows = rows.length;
  const truncated = sampledRows >= maxRows;
  const skuSet = new Set<string>();
  const monthSales = new Map<string, number>();
  const monthStock = new Map<string, number>();
  const monthRows = new Map<string, any[]>();

  for (const row of rows) {
    const sku = String(row?.[skuColumn] ?? "").trim();
    if (sku) skuSet.add(sku);
    const month = parseMonth(row?.[timeKey]);
    if (!month) continue;
    monthSales.set(month, (monthSales.get(month) || 0) + toNum(row?.[salesColumn]));
    monthStock.set(month, (monthStock.get(month) || 0) + toNum(row?.[stockColumn]));
    if (!monthRows.has(month)) monthRows.set(month, []);
    monthRows.get(month)!.push(row);
  }

  const sortedMonths = Array.from(monthSales.keys()).sort();
  const latestMonth = sortedMonths.length ? sortedMonths[sortedMonths.length - 1] : null;
  const recentMonthlyStats = sortedMonths.slice(-6).map((month) => ({
    month,
    totalSales: Math.round(monthSales.get(month) || 0),
    totalStock: Math.round(monthStock.get(month) || 0),
  }));

  const latestRows = latestMonth ? monthRows.get(latestMonth) || [] : [];
  const lowStockSkus = latestRows
    .map((r) => {
      const sku = String(r?.[skuColumn] ?? "").trim();
      const stock = toNum(r?.[stockColumn]);
      const safety = toNum(r?.safety_stock);
      return { sku, stock, safetyStock: safety, gap: Math.round(safety - stock) };
    })
    .filter((x) => x.sku && (x.stock <= 0 || (x.safetyStock > 0 && x.stock < x.safetyStock)))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 8);

  const topSalesSkus = latestRows
    .map((r) => ({
      sku: String(r?.[skuColumn] ?? "").trim(),
      sales: Math.round(toNum(r?.[salesColumn])),
      stock: Math.round(toNum(r?.[stockColumn])),
    }))
    .filter((x) => x.sku)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  return {
    totalRows: offset + sampledRows,
    sampledRows,
    truncated,
    totalSkus: skuSet.size,
    latestMonth,
    recentMonthlyStats,
    lowStockSkus,
    topSalesSkus,
  };
}

function buildPrompt(
  question: string,
  summary?: ForecastSummary,
  dashboard?: DashboardContext,
  recentChat?: ChatTurn[],
  lang: "zh" | "en" = "zh"
) {
  const intro =
    lang === "zh"
      ? "你是库存分析助手。请结合预测数据与历史/全局库存数据，给出简单易懂、可执行的建议。"
      : "You are an inventory analysis assistant. Use forecast + historical dashboard data and give clear, practical advice.";

  const rules =
    lang === "zh"
      ? [
          "输出使用简洁中文。",
          "先给结论，再给2-4条行动建议。",
          "优先引用有依据的数字（最近月份、库存、销量、缺货风险）。",
          "如数据不足，明确指出缺失项并给出保守建议。",
          "不要编造不存在的数字。",
        ].join("\n")
      : [
          "Use concise English.",
          "Give a conclusion first, then 2-4 action items.",
          "If data is missing, state it and provide conservative guidance.",
          "Do not invent numbers.",
        ].join("\n");

  const forecastBlock = JSON.stringify(summary ?? {}, null, 2);
  const dashboardBlock = JSON.stringify(dashboard ?? {}, null, 2);
  const chatBlock = JSON.stringify(recentChat ?? [], null, 2);
  return `${intro}\n\nRules:\n${rules}\n\nUser question:\n${question}\n\nRecent chat turns:\n${chatBlock}\n\nForecast summary:\n${forecastBlock}\n\nDashboard historical/global context:\n${dashboardBlock}`;
}

export async function POST(req: NextRequest) {
  try {
    const { question, forecastSummary, lang, model: requestedModel, recentChat } = (await req.json()) as {
      question?: string;
      forecastSummary?: ForecastSummary;
      lang?: "zh" | "en";
      model?: string;
      recentChat?: ChatTurn[];
    };

    if (!question || !question.trim()) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const allowList = new Set(["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]);
    const envModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const model = requestedModel && allowList.has(requestedModel) ? requestedModel : envModel;
    let dashboardContext: DashboardContext | undefined;
    try {
      dashboardContext = await collectDashboardContext();
    } catch {
      dashboardContext = undefined;
    }
    const input = buildPrompt(
      question,
      forecastSummary,
      dashboardContext,
      Array.isArray(recentChat) ? recentChat.slice(-8) : [],
      lang === "en" ? "en" : "zh"
    );

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        input,
      }),
    });

    if (!res.ok) {
      const raw = await res.text();
      try {
        const parsed = JSON.parse(raw);
        const code = parsed?.error?.code || parsed?.error?.type || null;
        const message = parsed?.error?.message || raw;
        return NextResponse.json({ error: String(message), code, model }, { status: 502 });
      } catch {
        return NextResponse.json({ error: `OpenAI request failed: ${raw}`, model }, { status: 502 });
      }
    }

    const data = await res.json();
    const directText = typeof data?.output_text === "string" ? data.output_text.trim() : "";
    const outputArray = Array.isArray(data?.output) ? data.output : [];
    const fromOutput = outputArray
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((c: any) => (c?.type === "output_text" && typeof c?.text === "string" ? c.text : ""))
      .join("\n")
      .trim();
    const answer = directText || fromOutput;
    if (!answer) {
      return NextResponse.json(
        { error: "Model returned no text content", rawType: typeof data, model },
        { status: 502 }
      );
    }

    return NextResponse.json({ answer, model, hasDashboardContext: Boolean(dashboardContext) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
