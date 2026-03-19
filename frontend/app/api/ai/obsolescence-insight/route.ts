import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TierData = {
  batches: number;
  total_stock: number;
  total_capital: number;
};

type TopItem = {
  sku: string;
  batch: string;
  age_months: number;
  current_stock: number;
  capital: number | null;
  risk_tier: "high" | "medium" | "watch";
};

type InsightRequest = {
  snapshotMonth: string;
  summary: {
    high: TierData;
    medium: TierData;
    watch: TierData;
  };
  totalCapital: number;
  topItems: TopItem[];
  lang?: "zh" | "en";
};

function fmtCapital(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万元`;
  return `${n.toLocaleString()}元`;
}

function buildPrompt(req: InsightRequest, lang: "zh" | "en"): string {
  const { summary, totalCapital, topItems, snapshotMonth } = req;
  const highItems = topItems.filter(i => i.risk_tier === "high").slice(0, 3);
  const medItems = topItems.filter(i => i.risk_tier === "medium").slice(0, 3);

  if (lang === "zh") {
    const topItemsText = topItems.slice(0, 6).map(i => {
      const age = i.age_months >= 12 ? `${Math.floor(i.age_months / 12)}年${i.age_months % 12}个月` : `${i.age_months}个月`;
      const cap = i.capital !== null ? `，占用资金 ${fmtCapital(i.capital)}` : "";
      return `  - SKU ${i.sku}（批号 ${i.batch}）：在库 ${age}，库存 ${i.current_stock.toLocaleString()} 件${cap}`;
    }).join("\n");

    return `你是一位专注于库存减损与资金效率的资深顾问，正在为企业管理层生成呆滞库存分析报告。请基于以下数据，生成一份详细、专业、有实际处置建议的中文报告。

## 呆滞库存数据（数据月份：${snapshotMonth}）

### 风险分级汇总
- **高风险**（在库≥2年）：${summary.high.batches} 批次，${summary.high.total_stock.toLocaleString()} 件${summary.high.total_capital > 0 ? `，占用资金 ${fmtCapital(summary.high.total_capital)}` : "（成本数据缺失）"}
- **中风险**（在库1-2年）：${summary.medium.batches} 批次，${summary.medium.total_stock.toLocaleString()} 件${summary.medium.total_capital > 0 ? `，占用资金 ${fmtCapital(summary.medium.total_capital)}` : "（成本数据缺失）"}
- **观察**（在库<1年）：${summary.watch.batches} 批次，${summary.watch.total_stock.toLocaleString()} 件${summary.watch.total_capital > 0 ? `，占用资金 ${fmtCapital(summary.watch.total_capital)}` : ""}
- **合计占用资金**：${totalCapital > 0 ? fmtCapital(totalCapital) : "成本数据待补全"}

### 高风险重点批次（按资金排序）
${highItems.length > 0 ? highItems.map(i => {
  const age = `${Math.floor(i.age_months / 12)}年${i.age_months % 12}个月`;
  const cap = i.capital !== null ? `，占用资金 ${fmtCapital(i.capital)}` : "";
  return `  - SKU ${i.sku}（批号 ${i.batch}）：已在库 ${age}，库存 ${i.current_stock.toLocaleString()} 件${cap}`;
}).join("\n") : "  （无高风险批次）"}

### 中风险批次（前3位）
${medItems.length > 0 ? medItems.map(i => {
  const age = i.age_months >= 12 ? `${Math.floor(i.age_months / 12)}年${i.age_months % 12}个月` : `${i.age_months}个月`;
  const cap = i.capital !== null ? `，占用资金 ${fmtCapital(i.capital)}` : "";
  return `  - SKU ${i.sku}（批号 ${i.batch}）：已在库 ${age}，库存 ${i.current_stock.toLocaleString()} 件${cap}`;
}).join("\n") : "  （无中风险批次）"}

## 报告要求
请按以下四个部分撰写，语言专业、直接、面向管理层决策：

**一、呆滞库存整体状况**
评估整体严重程度，总结各风险层级的批次数量与资金占用规模，与行业惯例对比是否处于合理水位。

**二、高风险批次深度分析**
针对在库超过2年的批次，分析长期积压的原因（需求预测失准？采购过量？产品停产？），以及继续持有的机会成本与风险。点名关键SKU。

**三、资金占用影响评估**
量化分析呆滞库存对资金流动性的影响，说明若不处置的潜在损失（价值折损、仓储成本、过期风险），中风险批次若不及时处理可能的演变路径。

**四、分级处置建议**
针对三个风险等级分别给出具体处置方案：
- 高风险：立即行动的2-3个方案（清仓促销、折价处理、报废申请等）
- 中风险：3-6个月内的处置计划
- 观察：预防性监控措施

输出格式：使用**粗体**标注每部分标题，正文用自然段落，处置建议用短横线列表。总字数350-500字。`;
  }

  // English version
  const topItemsTextEn = topItems.slice(0, 6).map(i => {
    const age = i.age_months >= 12 ? `${Math.floor(i.age_months / 12)}y ${i.age_months % 12}m` : `${i.age_months}m`;
    const cap = i.capital !== null ? `, capital: ¥${i.capital.toLocaleString()}` : "";
    return `  - SKU ${i.sku} (batch ${i.batch}): ${age} in stock, ${i.current_stock.toLocaleString()} units${cap}`;
  }).join("\n");

  return `You are a senior inventory consultant specializing in obsolete stock reduction and capital efficiency. Generate a detailed, actionable English analysis report for management.

## Obsolete Inventory Data (Snapshot: ${snapshotMonth})

### Risk Tier Summary
- **High Risk** (≥2 years): ${summary.high.batches} batches, ${summary.high.total_stock.toLocaleString()} units${summary.high.total_capital > 0 ? `, ¥${summary.high.total_capital.toLocaleString()} capital tied up` : " (cost data missing)"}
- **Medium Risk** (1-2 years): ${summary.medium.batches} batches, ${summary.medium.total_stock.toLocaleString()} units${summary.medium.total_capital > 0 ? `, ¥${summary.medium.total_capital.toLocaleString()} capital tied up` : " (cost data missing)"}
- **Watch** (<1 year): ${summary.watch.batches} batches, ${summary.watch.total_stock.toLocaleString()} units
- **Total capital at risk**: ${totalCapital > 0 ? `¥${totalCapital.toLocaleString()}` : "cost data incomplete"}

### Top Items (by capital/stock)
${topItemsTextEn}

## Report Requirements
Four sections, professional and decision-oriented:

**1. Overall Obsolescence Status**
Assess severity, summarize batches and capital by tier, benchmark against normal thresholds.

**2. High-Risk Batch Deep Dive**
Analyze root causes for 2+ year old batches (forecast error, over-purchasing, discontinued products), opportunity cost of holding.

**3. Capital Impact Assessment**
Quantify impact on liquidity, potential losses (value degradation, storage costs, expiry risk), escalation path for medium-risk items.

**4. Tiered Disposal Recommendations**
- High Risk: 2-3 immediate actions (clearance, markdown, write-off)
- Medium Risk: 3-6 month disposal plan
- Watch: Preventive monitoring measures

Format: **Bold** headers, natural paragraph body, dash lists for actions. Total: 300-450 words.`;
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
