import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

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
  const monthRes = await ref("inventory_batches")
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
  const slowMoversRes = await ref("inventory_batches")
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

export type ReportType = "management" | "warehouse" | "purchasing" | "sales" | "finance";

function dataBlock(d: Awaited<ReturnType<typeof collectReportData>>, lang: "zh" | "en"): string {
  const riskPct = d.totalSkus > 0 ? ((d.riskSkus / d.totalSkus) * 100).toFixed(1) : "0";
  if (lang === "zh") {
    return `当月核心数据（${d.latestMonth}）：
- SKU 总数：${d.totalSkus}
- 缺货 SKU：${d.oosCount} | 低库存 SKU：${d.lowCount} | 高库存 SKU：${d.highCount}
- 风险 SKU 占比：${riskPct}% | 健康 SKU：${d.healthySkus}（${d.healthyPct}%）
- 当前总库存：${d.totalStock} 件 | 本月销售：${d.totalSales} 件
- 库存覆盖周期：约 ${d.stockCover} 个月
- 已配置阈值 SKU 数：${d.thresholdsConfigured}
- 疑似滞销 SKU：${d.slowMoverCount}`;
  }
  return `Current month data (${d.latestMonth}):
- Total SKUs: ${d.totalSkus}
- Out of stock: ${d.oosCount} | Low stock: ${d.lowCount} | Overstock: ${d.highCount}
- At-risk SKU share: ${riskPct}% | Healthy SKUs: ${d.healthySkus} (${d.healthyPct}%)
- Total stock: ${d.totalStock} units | Monthly sales: ${d.totalSales} units
- Stock cover: ~${d.stockCover} months
- SKUs with thresholds: ${d.thresholdsConfigured}
- Potential slow movers: ${d.slowMoverCount}`;
}

function buildReportPrompt(
  data: Awaited<ReturnType<typeof collectReportData>>,
  lang: "zh" | "en",
  reportType: ReportType
): string {
  const db = dataBlock(data, lang);
  const fmt = lang === "zh"
    ? "格式：Markdown（## 标题，**加粗**重点，列表用建议），600-900字，数据驱动，无套话"
    : "Format: Markdown (## headings, **bold** key points, bullet lists), 600-900 words, data-driven, no filler";

  const personas: Record<ReportType, { system: string; focus: string }> = {
    management: {
      system: lang === "zh"
        ? "你是资深库存顾问，为公司管理层撰写月度库存健康简报。"
        : "You are a senior inventory consultant writing a monthly inventory health brief for company leadership.",
      focus: lang === "zh"
        ? `重点：整体库存健康评级（良好/中等/需关注）、核心 KPI 趋势、最重要的 3 个风险、资金占用、给管理层的 3 条决策建议。不需要操作细节。结构：执行摘要 → KPI 快照 → 核心风险 → 决策建议`
        : `Focus: Overall health rating (Good/Fair/Needs Attention), top 3 KPI trends, top 3 risks, capital implications, 3 executive decisions needed. No operational detail. Structure: Executive Summary → KPI Snapshot → Key Risks → Decision Items`,
    },
    warehouse: {
      system: lang === "zh"
        ? "你是仓储运营分析师，为仓库主管撰写本月操作重点报告。"
        : "You are a warehouse operations analyst writing a monthly operational priorities report for the warehouse supervisor.",
      focus: lang === "zh"
        ? `重点：缺货和低库存 SKU 的补货优先级、高库存 SKU 的空间压力、本月出入库效率、库存准确性问题（已配置阈值覆盖率）、下月仓库工作重点清单（按优先级排序）。结构：本月仓库现状 → 紧急补货清单 → 过剩库存处理 → 下月操作重点`
        : `Focus: Replenishment priority for OOS/low-stock SKUs, space pressure from overstock, inbound/outbound efficiency, accuracy gaps (threshold coverage), prioritised task list for next month. Structure: Current Warehouse State → Urgent Replenishment → Overstock Actions → Next Month Priorities`,
    },
    purchasing: {
      system: lang === "zh"
        ? "你是采购分析师，为采购负责人撰写本月采购决策报告。"
        : "You are a procurement analyst writing a monthly purchasing decision report for the procurement lead.",
      focus: lang === "zh"
        ? `重点：必须立即补货的 SKU（缺货/库存覆盖 <1 个月）、可延迟采购的 SKU（高库存）、库存覆盖周期 ${data.stockCover} 个月意味着什么采购节奏、滞销品 ${data.slowMoverCount} 个对未来采购计划的影响、采购预算建议方向。结构：立即采购清单 → 暂缓采购清单 → 采购节奏分析 → 预算建议`
        : `Focus: SKUs requiring immediate PO (OOS/coverage <1 month), SKUs to delay purchasing (overstock), what ${data.stockCover} month coverage means for order cadence, impact of ${data.slowMoverCount} slow movers on future plans, budget direction. Structure: Buy Now → Hold Off → Cadence Analysis → Budget Guidance`,
    },
    sales: {
      system: lang === "zh"
        ? "你是销售运营分析师，为销售和市场团队撰写本月库存机会与风险报告。"
        : "You are a sales operations analyst writing a monthly inventory opportunity and risk report for the sales and marketing team.",
      focus: lang === "zh"
        ? `重点：哪些 SKU 可以大力推销（库存充足、销售良好）、哪些 SKU 有断货风险影响销售承诺、哪些滞销品需要促销活动清仓（${data.slowMoverCount} 个疑似滞销）、库存覆盖 ${data.stockCover} 个月对促销活动时间窗口的意义、给销售团队的产品推荐优先级。结构：可推销产品 → 断货风险提醒 → 促销清仓机会 → 销售建议`
        : `Focus: SKUs safe to promote aggressively (healthy stock, good sales), SKUs at risk of stocking out and breaking sales commitments, slow movers needing promotional clearance (${data.slowMoverCount} identified), what ${data.stockCover} month cover means for campaign timing, product priority list for the sales team. Structure: Push Products → Stockout Risk Alerts → Clearance Opportunities → Sales Recommendations`,
    },
    finance: {
      system: lang === "zh"
        ? "你是财务分析师，为财务负责人撰写本月库存资产与资金风险报告。"
        : "You are a financial analyst writing a monthly inventory asset and capital risk report for the finance lead.",
      focus: lang === "zh"
        ? `重点：库存资产健康度（健康 vs 滞压比例）、滞销品 ${data.slowMoverCount} 个代表的资金占压风险与潜在减值、高库存 ${data.highCount} 个 SKU 的资金效率问题、库存覆盖 ${data.stockCover} 个月对现金流周转的影响、建议的库存资产优化方向（减少占压、提升周转）。结构：库存资产概览 → 资金占压风险 → 减值风险评估 → 财务优化建议`
        : `Focus: Inventory asset health (healthy vs trapped capital ratio), capital at risk from ${data.slowMoverCount} slow movers and potential write-down exposure, capital efficiency of ${data.highCount} overstock SKUs, cash flow implications of ${data.stockCover} month cover, recommended asset optimisation direction. Structure: Asset Overview → Trapped Capital Risk → Write-down Exposure → Financial Recommendations`,
    },
  };

  const persona = personas[reportType];

  if (lang === "zh") {
    return `${persona.system}

${persona.focus}

${fmt}

${db}`;
  }

  return `${persona.system}

${persona.focus}

${fmt}

${db}`;
}

// ─── LLM helper ──────────────────────────────────────────────────────────────

async function callLLM(
  prompt: string,
  apiKey: string,
  model: string,
  maxTokens = 1200,
  temperature = 0.4
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw;
    try { msg = JSON.parse(raw)?.error?.message ?? raw; } catch {}
    throw new Error(`OpenAI error: ${msg.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

// ─── Critic agent ─────────────────────────────────────────────────────────────

// Weighted scoring per persona — critic checks what actually matters for each role
const PERSONA_CRITERIA: Record<ReportType, {
  must_contain: string[];   // keywords / concepts the report MUST address
  must_not: string[];       // vague filler phrases that fail actionability
  weight_factual: number;
  weight_actionability: number;
  weight_completeness: number;
  weight_relevance: number;
}> = {
  management: {
    must_contain: ["health rating", "risk", "KPI", "decision", "健康", "风险", "决策"],
    must_not: ["monitor closely", "keep an eye", "持续关注", "可能会"],
    weight_factual: 0.35, weight_actionability: 0.25, weight_completeness: 0.25, weight_relevance: 0.15,
  },
  warehouse: {
    must_contain: ["replenish", "reorder", "overstock", "补货", "滞销", "优先"],
    must_not: ["strategic", "financial impact", "capital", "资本", "战略"],
    weight_factual: 0.30, weight_actionability: 0.35, weight_completeness: 0.20, weight_relevance: 0.15,
  },
  purchasing: {
    must_contain: ["buy", "hold", "order", "coverage", "采购", "覆盖", "延迟"],
    must_not: ["monitor", "watch", "观察", "留意"],
    weight_factual: 0.30, weight_actionability: 0.35, weight_completeness: 0.20, weight_relevance: 0.15,
  },
  sales: {
    must_contain: ["promote", "stockout", "clearance", "campaign", "推销", "断货", "促销"],
    must_not: ["financial", "capital", "procurement", "财务", "采购资金"],
    weight_factual: 0.25, weight_actionability: 0.35, weight_completeness: 0.20, weight_relevance: 0.20,
  },
  finance: {
    must_contain: ["capital", "write", "turnover", "cash", "资金", "减值", "周转"],
    must_not: ["operational detail", "warehouse task", "仓库操作", "库管"],
    weight_factual: 0.40, weight_actionability: 0.25, weight_completeness: 0.20, weight_relevance: 0.15,
  },
};

function buildCriticPrompt(
  report: string,
  data: Awaited<ReturnType<typeof collectReportData>>,
  reportType: ReportType,
  lang: "zh" | "en",
  directives?: string,
  prevReport?: string
): string {
  const criteria = PERSONA_CRITERIA[reportType];
  const groundTruth = `
Ground-truth figures (source of truth — every number in the report must match exactly):
- total_skus: ${data.totalSkus}
- out_of_stock: ${data.oosCount}
- low_stock: ${data.lowCount}
- high_stock: ${data.highCount}
- risk_skus: ${data.riskSkus}
- healthy_skus: ${data.healthySkus}
- healthy_pct: ${data.healthyPct}%
- total_stock_units: ${data.totalStock}
- monthly_sales_units: ${data.totalSales}
- stock_cover_months: ${data.stockCover}
- slow_movers: ${data.slowMoverCount}
- month: ${data.latestMonth}`.trim();

  const retryBlock = directives
    ? `\n\nNOTE: This is a revised draft. Previous directives were:\n${directives}\nPrevious draft:\n${prevReport ?? ""}\n`
    : "";

  return `You are a quality assurance agent reviewing an inventory management report before it is shown to a user.

Report type: ${reportType}
Report language: ${lang}

${groundTruth}

Score the report on four dimensions (0.0–1.0 each):

1. factual_accuracy (weight ${criteria.weight_factual})
   Every number cited must exactly match the ground-truth figures above.
   Penalise −0.25 per incorrect or invented number.

2. actionability (weight ${criteria.weight_actionability})
   Every recommendation must be specific and executable.
   Penalise if ANY of these vague phrases appear: ${criteria.must_not.join(", ")}.
   Penalise if no concrete next step is given.

3. completeness (weight ${criteria.weight_completeness})
   The report MUST address these concepts: ${criteria.must_contain.join(", ")}.
   Deduct 0.15 for each missing concept.

4. relevance (weight ${criteria.weight_relevance})
   Content must be appropriate for a ${reportType} audience.
   Penalise if off-topic content (wrong audience) takes up >20% of the report.

Compute:
  quality_score = ${criteria.weight_factual}*factual_accuracy + ${criteria.weight_actionability}*actionability + ${criteria.weight_completeness}*completeness + ${criteria.weight_relevance}*relevance

passes = true if:
  quality_score >= 0.78
  AND factual_accuracy >= 0.72
  AND actionability >= 0.60
  AND completeness >= 0.65
  AND no dimension below 0.50

If passes = false, write improvement_directives as a SHORT numbered checklist
telling the writer exactly what to fix. Be surgical — name the wrong number,
name the missing concept, name the vague phrase to replace.
Example: "1. Stock cover is stated as 4.2 months but data shows ${data.stockCover}. 2. Add a specific reorder recommendation for low-stock SKUs. 3. Remove 'monitor closely' — replace with a concrete action."

If passes = true, improvement_directives must be exactly "".

Return JSON only (no markdown wrapper):
{
  "quality_score": number,
  "passes": boolean,
  "scores": { "factual_accuracy": number, "actionability": number, "completeness": number, "relevance": number },
  "improvement_directives": string
}
${retryBlock}
--- Report to review ---
${report}`;
}

// ─── Writer retry prompt ───────────────────────────────────────────────────────

function buildRetryPrompt(
  originalPrompt: string,
  previousReport: string,
  directives: string
): string {
  return `${originalPrompt}

--- REVISION REQUIRED ---
Your previous draft did not meet quality standards. Apply these fixes EXACTLY:
${directives}

Your previous draft (for reference — do NOT copy it, rewrite it):
${previousReport}

Return the corrected report now.`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), { route: "full-report", limit: 3, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。/ Too many requests, please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }
  try {
    const { lang = "zh", reportType = "management" } = (await req.json()) as { lang?: "zh" | "en"; reportType?: ReportType };

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

    const validTypes: ReportType[] = ["management", "warehouse", "purchasing", "sales", "finance"];
    const resolvedType: ReportType = validTypes.includes(reportType as ReportType) ? (reportType as ReportType) : "management";

    // Always use gpt-4.1 for best quality
    const model = "gpt-4.1";

    // ── Step 1: Writer ────────────────────────────────────────────────────────
    const writerPrompt = buildReportPrompt(reportData, resolvedLang, resolvedType);
    let report = await callLLM(writerPrompt, apiKey, model, 1400, 0.4);

    if (!report) {
      return NextResponse.json({ error: "Model returned no text" }, { status: 502 });
    }

    // ── Step 2: Critic ────────────────────────────────────────────────────────
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let criticJson: {
        quality_score: number;
        passes: boolean;
        scores: { factual_accuracy: number; actionability: number; completeness: number; relevance: number };
        improvement_directives: string;
      };

      try {
        const criticPrompt = buildCriticPrompt(
          report,
          reportData,
          resolvedType,
          resolvedLang,
          attempt > 0 ? undefined : undefined,   // directives only on 2nd+ critic pass
        );
        const criticRaw = await callLLM(criticPrompt, apiKey, model, 500, 0.1);

        // Strip optional markdown code fences
        const jsonText = criticRaw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        criticJson = JSON.parse(jsonText);
      } catch {
        // Critic parse failed — treat as passed to avoid blocking the user
        break;
      }

      if (criticJson.passes) {
        // Report passed all quality gates — done
        break;
      }

      if (attempt < MAX_RETRIES - 1) {
        // ── Step 3: Writer retry ────────────────────────────────────────────
        const retryPrompt = buildRetryPrompt(
          writerPrompt,
          report,
          criticJson.improvement_directives
        );
        const revised = await callLLM(retryPrompt, apiKey, model, 1400, 0.35);
        if (revised) report = revised;
        // Loop back to critic for final check
      }
      // If last retry still fails critic, we still return best available report —
      // user gets the most recent revision, quality gate is best-effort
    }

    return NextResponse.json({
      report,
      model,
      lang: resolvedLang,
      reportType: resolvedType,
      month: reportData.latestMonth,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
