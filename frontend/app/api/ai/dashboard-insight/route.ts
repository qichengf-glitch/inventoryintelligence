import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StockCounts = {
  low_stock: number;
  out_of_stock: number;
  over_stock: number;
  normal_stock: number;
};

type StockPercentages = StockCounts;

type KpiItem = {
  id: string;
  title: string;
  value: number;
  delta: number | null;
  deltaType: "percent" | "number";
  subtext?: string;
};

type SlowMover = {
  sku: string;
  current_stock: number;
  months_without_movement: number;
  avg_monthly_out: number;
};

type InsightRequest = {
  latestMonth: string | null;
  previousMonth: string | null;
  kpis: KpiItem[];
  stockCounts: StockCounts;
  stockPercentages: StockPercentages;
  totalSkus: number;
  slowMovers?: SlowMover[];
  lang?: "zh" | "en";
};

function buildPrompt(req: InsightRequest, lang: "zh" | "en"): string {
  const kpiMap: Record<string, KpiItem> = {};
  for (const k of req.kpis) kpiMap[k.id] = k;

  const totalSkus = kpiMap["kpi_1"]?.value ?? req.totalSkus;
  const atRisk = kpiMap["kpi_2"]?.value ?? 0;
  const stockUnits = kpiMap["kpi_3"]?.value ?? 0;
  const monthlySales = kpiMap["kpi_4"]?.value ?? 0;
  const stockDelta = kpiMap["kpi_3"]?.delta;
  const salesDelta = kpiMap["kpi_4"]?.delta;
  const atRiskDelta = kpiMap["kpi_2"]?.delta;

  const { low_stock, out_of_stock, over_stock, normal_stock } = req.stockCounts;
  const pct = req.stockPercentages;

  const topSlowMovers = (req.slowMovers ?? []).slice(0, 5);

  if (lang === "zh") {
    const month = req.latestMonth ?? "最新月份";
    const prevMonth = req.previousMonth ? `（上月：${req.previousMonth}）` : "";
    const trendStock = stockDelta !== null && stockDelta !== undefined
      ? stockDelta > 0 ? `环比上升 ${stockDelta.toFixed(1)}%` : stockDelta < 0 ? `环比下降 ${Math.abs(stockDelta).toFixed(1)}%` : "环比持平"
      : "无对比数据";
    const trendSales = salesDelta !== null && salesDelta !== undefined
      ? salesDelta > 0 ? `环比上升 ${salesDelta.toFixed(1)}%` : salesDelta < 0 ? `环比下降 ${Math.abs(salesDelta).toFixed(1)}%` : "环比持平"
      : "无对比数据";
    const trendRisk = atRiskDelta !== null && atRiskDelta !== undefined
      ? atRiskDelta > 0 ? `较上月增加 ${atRiskDelta} 个` : atRiskDelta < 0 ? `较上月减少 ${Math.abs(atRiskDelta)} 个` : "与上月持平"
      : "";

    const slowMoverText = topSlowMovers.length > 0
      ? `\n滞销品TOP${topSlowMovers.length}（按库存量）：\n` +
        topSlowMovers.map(s => `  - ${s.sku}：库存 ${s.current_stock.toLocaleString()} 件，已 ${s.months_without_movement} 个月无出库`).join("\n")
      : "";

    return `你是一位资深库存管理顾问，正在为企业决策者生成每月库存健康度报告。请严格按照以下格式要求输出，不要添加任何额外的格式符号。

## 输入数据（${month}${prevMonth}）
- SKU总数：${totalSkus.toLocaleString()} 个
- 风险SKU：${atRisk} 个${trendRisk ? `（${trendRisk}）` : ""}（低库存 + 缺货合计）
- 当前库存总量：${stockUnits.toLocaleString()} 件（${trendStock}）
- 月销售量：${monthlySales.toLocaleString()} 件（${trendSales}）
- 正常：${normal_stock} 个 SKU（${pct.normal_stock.toFixed(1)}%）
- 低库存：${low_stock} 个 SKU（${pct.low_stock.toFixed(1)}%）
- 缺货：${out_of_stock} 个 SKU（${pct.out_of_stock.toFixed(1)}%）
- 过剩：${over_stock} 个 SKU（${pct.over_stock.toFixed(1)}%）
${slowMoverText}

## 严格输出格式（每部分之间空一行）

**一、本月整体库存健康状况**
（3-4句）给出明确的健康评级——良好、中等或需关注。说明正常库存率为 ${pct.normal_stock.toFixed(1)}% 意味着什么，结合风险SKU占比（${((atRisk / Math.max(totalSkus, 1)) * 100).toFixed(1)}%）进行评估，与上月趋势对比得出方向性结论。语言要有判断性，不能只描述数字。

**二、核心风险识别**
（3-5句）深入分析三类风险：①缺货风险——${out_of_stock} 个SKU为零库存意味着什么后果；②低库存预警——${low_stock} 个SKU可能在多少周内断货；③过剩积压——${over_stock} 个SKU过剩对资金的影响。${topSlowMovers.length > 0 ? `结合滞销TOP品数据，点出滞销的具体SKU。` : ""}每个风险点要有量化表述。

**三、销售与库存匹配度分析**
（3-4句）分析月销量 ${monthlySales.toLocaleString()} 件（${trendSales}）与总库存 ${stockUnits.toLocaleString()} 件的健康比例关系，估算当前库存可支撑销售的月数，判断整体是供过于求还是供不应求，识别结构性失衡信号。

**四、本月优先行动建议**
（给出4-5条具体行动，每条一行，前缀必须严格使用以下三种之一：[紧急]、[重要]、[关注]）
- [紧急/重要/关注] 具体行动描述，说明为什么要做、做什么、预期效果
- [紧急/重要/关注] 另一条行动
（按紧急程度排序，最紧急的排在最前面）

注意：
- 章节标题使用 **粗体** 格式（如 **一、标题**）
- 正文用普通文字段落
- 行动建议用 "- [优先级] 内容" 格式
- 不要使用 # 号标题
- 总字数350-500字`;
  }

  const month = req.latestMonth ?? "Latest Month";
  const trendStock = stockDelta !== null && stockDelta !== undefined
    ? stockDelta > 0 ? `up ${stockDelta.toFixed(1)}% MoM` : stockDelta < 0 ? `down ${Math.abs(stockDelta).toFixed(1)}% MoM` : "flat MoM"
    : "no prior data";
  const trendSales = salesDelta !== null && salesDelta !== undefined
    ? salesDelta > 0 ? `up ${salesDelta.toFixed(1)}% MoM` : salesDelta < 0 ? `down ${Math.abs(salesDelta).toFixed(1)}% MoM` : "flat MoM"
    : "no prior data";
  const trendRisk = atRiskDelta !== null && atRiskDelta !== undefined
    ? atRiskDelta > 0 ? `+${atRiskDelta} vs prior month` : atRiskDelta < 0 ? `${atRiskDelta} vs prior month` : "flat vs prior month"
    : "";

  const slowMoverText = topSlowMovers.length > 0
    ? `\nTop slow movers (by stock):\n` +
      topSlowMovers.map(s => `  - ${s.sku}: ${s.current_stock.toLocaleString()} units, ${s.months_without_movement} months no outbound`).join("\n")
    : "";

  return `You are a senior inventory management consultant generating a monthly inventory health report for business decision-makers. Follow the output format strictly — no extra markdown symbols.

## Input Data (${month})
- Total SKUs: ${totalSkus.toLocaleString()}
- At-Risk SKUs: ${atRisk} (Low + Out of Stock; ${trendRisk || "no prior data"})
- Current Stock Units: ${stockUnits.toLocaleString()} (${trendStock})
- Monthly Sales: ${monthlySales.toLocaleString()} (${trendSales})
- Normal: ${normal_stock} SKUs (${pct.normal_stock.toFixed(1)}%) | Low: ${low_stock} | Out: ${out_of_stock} | Over: ${over_stock}
${slowMoverText}

## Strict Output Format (blank line between sections)

**1. Overall Inventory Health Assessment**
(3-4 sentences) Give a clear health rating — Good, Fair, or Needs Attention. Explain what a ${pct.normal_stock.toFixed(1)}% normal rate means in context, evaluate the ${((atRisk / Math.max(totalSkus, 1)) * 100).toFixed(1)}% at-risk share, and state a directional conclusion vs. prior month. Be judgmental, not merely descriptive.

**2. Key Risk Identification**
(3-5 sentences) Analyze three risk types: ① Stockout risk — consequences of ${out_of_stock} SKUs at zero inventory; ② Low-stock warning — estimated weeks until ${low_stock} SKUs run out at current sales pace; ③ Overstock burden — capital impact of ${over_stock} bloated SKUs. ${topSlowMovers.length > 0 ? "Reference slow-mover data and name specific SKUs." : ""} Every risk point must be quantified.

**3. Sales-Inventory Alignment**
(3-4 sentences) Assess the ratio of monthly sales ${monthlySales.toLocaleString()} units (${trendSales}) to total stock ${stockUnits.toLocaleString()} units. Estimate months of coverage, judge whether supply exceeds or lags demand, and flag structural imbalance signals.

**4. Priority Action Items**
(4-5 items, each on its own line, prefix MUST be exactly one of: [Urgent], [Important], [Monitor])
- [Urgent/Important/Monitor] Specific action — why it matters, what to do, expected outcome
- [Urgent/Important/Monitor] Another action
(Sort by urgency, most urgent first)

Rules:
- Section titles use **bold** format (e.g. **1. Title**)
- Body text in plain prose paragraphs
- Action items use "- [Priority] content" format
- No # headings
- Total: 300-450 words`;
}

export async function POST(req: NextRequest) {
  try {
    const body: InsightRequest = await req.json();
    const { lang = "zh" } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const model = process.env.OPENAI_INSIGHT_MODEL || "gpt-4o";
    const prompt = buildPrompt(body, lang);

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, temperature: 0.4, input: prompt }),
    });

    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json({ error: `OpenAI error: ${raw}` }, { status: 502 });
    }

    const data = await res.json();
    const directText = typeof data?.output_text === "string" ? data.output_text.trim() : "";
    const fromOutput = (Array.isArray(data?.output) ? data.output : [])
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .map((c: any) => (c?.type === "output_text" && typeof c?.text === "string" ? c.text : ""))
      .join("\n")
      .trim();

    const report = directText || fromOutput;
    if (!report) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 502 });
    }

    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 }
    );
  }
}
