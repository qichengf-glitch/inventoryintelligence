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

    return `你是一位资深库存管理顾问，正在为企业决策者生成每月库存健康度报告。请基于以下数据生成一份详细、专业、有实际指导价值的中文分析报告。

## 数据概览（${month}${prevMonth}）
- SKU总数：${totalSkus.toLocaleString()} 个
- 风险SKU：${atRisk} 个${trendRisk ? `（${trendRisk}）` : ""}（低库存 + 缺货合计）
- 当前库存总量：${stockUnits.toLocaleString()} 件（${trendStock}）
- 月销售量：${monthlySales.toLocaleString()} 件（${trendSales}）

## 库存状态分布
- 正常：${normal_stock} 个 SKU（${pct.normal_stock.toFixed(1)}%）
- 低库存：${low_stock} 个 SKU（${pct.low_stock.toFixed(1)}%）
- 缺货：${out_of_stock} 个 SKU（${pct.out_of_stock.toFixed(1)}%）
- 库存过剩：${over_stock} 个 SKU（${pct.over_stock.toFixed(1)}%）
${slowMoverText}

## 报告要求
请按以下四个部分撰写，每部分2-4句，语言直接、数据驱动、避免泛泛而谈：

**一、本月整体库存健康状况**
综合评估健康度（良好/中等/需关注），结合正常率与风险率给出判断，与上月趋势对比。

**二、核心风险识别**
详细分析缺货与低库存风险：有多少SKU面临供应中断风险，过剩库存占用多少资源，滞销情况如何。用具体数字说话。

**三、销售与库存匹配分析**
分析销售走势与库存水位的匹配程度，是否出现库存积压或供不应求的信号，识别结构性问题。

**四、本月优先行动建议**
给出3-4条具体、可执行的行动项，标明优先级（紧急/重要/关注），每条建议直接对应上述发现的问题。

输出格式：使用**粗体**标注每部分标题，正文用自然段落，行动建议用短横线列表。总字数300-450字。`;
  }

  const month = req.latestMonth ?? "Latest Month";
  const trendStock = stockDelta !== null && stockDelta !== undefined
    ? stockDelta > 0 ? `up ${stockDelta.toFixed(1)}% MoM` : stockDelta < 0 ? `down ${Math.abs(stockDelta).toFixed(1)}% MoM` : "flat MoM"
    : "no prior data";
  const trendSales = salesDelta !== null && salesDelta !== undefined
    ? salesDelta > 0 ? `up ${salesDelta.toFixed(1)}% MoM` : salesDelta < 0 ? `down ${Math.abs(salesDelta).toFixed(1)}% MoM` : "flat MoM"
    : "no prior data";

  const slowMoverText = topSlowMovers.length > 0
    ? `\nTop slow movers (by stock):\n` +
      topSlowMovers.map(s => `  - ${s.sku}: ${s.current_stock.toLocaleString()} units, ${s.months_without_movement} months no outbound`).join("\n")
    : "";

  return `You are a senior inventory management consultant generating a monthly inventory health report for business decision-makers. Based on the data below, generate a detailed, professional, and actionable English analysis report.

## Data Overview (${month})
- Total SKUs: ${totalSkus.toLocaleString()}
- At-Risk SKUs: ${atRisk} (Low Stock + Out of Stock combined)
- Current Stock Units: ${stockUnits.toLocaleString()} (${trendStock})
- Monthly Sales: ${monthlySales.toLocaleString()} (${trendSales})

## Stock Status Distribution
- Normal: ${normal_stock} SKUs (${pct.normal_stock.toFixed(1)}%)
- Low Stock: ${low_stock} SKUs (${pct.low_stock.toFixed(1)}%)
- Out of Stock: ${out_of_stock} SKUs (${pct.out_of_stock.toFixed(1)}%)
- Overstocked: ${over_stock} SKUs (${pct.over_stock.toFixed(1)}%)
${slowMoverText}

## Report Requirements
Write four sections, 2-4 sentences each, direct and data-driven:

**1. Overall Inventory Health Assessment**
Evaluate health (Good/Fair/Needs Attention), reference normal vs. risk rates, compare to prior month trend.

**2. Key Risk Identification**
Detail stockout and low-stock risk: how many SKUs face supply disruption, how much capital is tied up in overstock, slow-mover situation.

**3. Sales-Inventory Alignment Analysis**
Analyze whether sales trends match inventory levels, identify signs of excess buildup or supply shortage, surface structural issues.

**4. Priority Action Items This Month**
Provide 3-4 specific, actionable items with priority labels (Urgent/Important/Monitor), each tied to findings above.

Format: **Bold** section headers, natural paragraphs for body, dash list for action items. Total: 250-400 words.`;
}

export async function POST(req: NextRequest) {
  try {
    const body: InsightRequest = await req.json();
    const { lang = "zh" } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
