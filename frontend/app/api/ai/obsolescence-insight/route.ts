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

    return `你是一位专注于库存减损与资金效率的资深顾问，正在为企业管理层生成呆滞库存分析报告。请严格按照以下格式输出，不要添加额外的格式符号。

## 输入数据（${snapshotMonth}）
- 高风险（≥2年）：${summary.high.batches} 批次，${summary.high.total_stock.toLocaleString()} 件${summary.high.total_capital > 0 ? `，占用 ${fmtCapital(summary.high.total_capital)}` : "（成本缺失）"}
- 中风险（1-2年）：${summary.medium.batches} 批次，${summary.medium.total_stock.toLocaleString()} 件${summary.medium.total_capital > 0 ? `，占用 ${fmtCapital(summary.medium.total_capital)}` : "（成本缺失）"}
- 观察（<1年）：${summary.watch.batches} 批次，${summary.watch.total_stock.toLocaleString()} 件${summary.watch.total_capital > 0 ? `，占用 ${fmtCapital(summary.watch.total_capital)}` : ""}
- 合计占用资金：${totalCapital > 0 ? fmtCapital(totalCapital) : "待补全"}

高风险批次：
${highItems.length > 0 ? highItems.map(i => {
  const age = `${Math.floor(i.age_months / 12)}年${i.age_months % 12}个月`;
  const cap = i.capital !== null ? `，占用 ${fmtCapital(i.capital)}` : "";
  return `  - ${i.sku}（${i.batch}）在库 ${age}，${i.current_stock.toLocaleString()} 件${cap}`;
}).join("\n") : "  无"}
中风险批次（前3）：
${medItems.length > 0 ? medItems.map(i => {
  const age = i.age_months >= 12 ? `${Math.floor(i.age_months / 12)}年${i.age_months % 12}个月` : `${i.age_months}个月`;
  const cap = i.capital !== null ? `，占用 ${fmtCapital(i.capital)}` : "";
  return `  - ${i.sku}（${i.batch}）在库 ${age}，${i.current_stock.toLocaleString()} 件${cap}`;
}).join("\n") : "  无"}

## 严格输出格式（章节之间空一行）

**一、呆滞库存整体状况**
（3-4句）评估整体严重程度：合计 ${summary.high.batches + summary.medium.batches} 个高中风险批次、占用资金 ${totalCapital > 0 ? fmtCapital(totalCapital) : "（待补全）"} 处于什么样的水位。分析高风险批次占比，说明这批库存对企业流动资金的实质影响程度。给出明确判断：严重/一般/可控。

**二、高风险批次深度分析**
（4-5句）针对在库超过2年的 ${summary.high.batches} 个批次展开分析：这些库龄过长的批次最可能的原因是什么（需求预测失准、采购过量、产品已停产或被替代）。逐一分析重点SKU继续持有的成本（仓储费、资金占用、价值折损风险）。判断哪些批次已无回收可能，哪些仍有机会通过促销或转用处置。

**三、资金占用与风险演变路径**
（3-4句）量化分析：${totalCapital > 0 ? fmtCapital(totalCapital) : ""}的占用资金按年利率成本计算每月损耗是多少。说明若不采取行动，中风险批次未来6-12个月将演变为高风险，届时处置难度和折损率会如何变化。指出库龄积压对新品采购空间的挤压效应。

**四、分级处置行动建议**
（5-6条具体行动，每条一行，前缀严格使用 [紧急]、[重要] 或 [关注]）
- [紧急] 针对高风险批次的立即行动（清仓促销/折价转让/报废申请）
- [紧急] 另一条高风险处置行动
- [重要] 针对中风险批次的3-6个月处置计划
- [重要] 建立呆滞库存预警机制的具体方案
- [关注] 观察级批次的预防性监控措施
（按紧急程度排序，结合上述分析的具体SKU给出针对性建议）

注意：
- 章节标题使用 **粗体**（如 **一、标题**）
- 正文用普通段落
- 行动建议用 "- [优先级] 内容" 格式
- 不要用 # 号标题
- 总字数400-550字`;
  }

  // English version
  const topItemsTextEn = topItems.slice(0, 6).map(i => {
    const age = i.age_months >= 12 ? `${Math.floor(i.age_months / 12)}y ${i.age_months % 12}m` : `${i.age_months}m`;
    const cap = i.capital !== null ? `, capital: ¥${i.capital.toLocaleString()}` : "";
    return `  - SKU ${i.sku} (batch ${i.batch}): ${age} in stock, ${i.current_stock.toLocaleString()} units${cap}`;
  }).join("\n");

  return `You are a senior inventory consultant specializing in obsolete stock reduction and capital efficiency. Follow the output format strictly — no extra markdown symbols.

## Input Data (${snapshotMonth})
- High Risk (≥2yr): ${summary.high.batches} batches, ${summary.high.total_stock.toLocaleString()} units${summary.high.total_capital > 0 ? `, ¥${summary.high.total_capital.toLocaleString()} tied up` : " (cost missing)"}
- Medium Risk (1-2yr): ${summary.medium.batches} batches, ${summary.medium.total_stock.toLocaleString()} units${summary.medium.total_capital > 0 ? `, ¥${summary.medium.total_capital.toLocaleString()} tied up` : " (cost missing)"}
- Watch (<1yr): ${summary.watch.batches} batches, ${summary.watch.total_stock.toLocaleString()} units
- Total capital at risk: ${totalCapital > 0 ? `¥${totalCapital.toLocaleString()}` : "incomplete"}
Top items: ${topItemsTextEn}

## Strict Output Format (blank line between sections)

**1. Overall Obsolescence Status**
(3-4 sentences) Assess severity: what does having ${summary.high.batches + summary.medium.batches} high/medium-risk batches and ${totalCapital > 0 ? `¥${totalCapital.toLocaleString()}` : "unknown capital"} tied up mean for the business? Rate severity as Critical / Moderate / Manageable. State the highest-risk SKUs by name.

**2. High-Risk Batch Deep Dive**
(4-5 sentences) Analyze root causes for 2+ year old batches: demand forecast error, over-purchasing, discontinued or substituted products. For each top high-risk SKU, estimate the carrying cost (storage + capital cost) per month and the probability of recovery via clearance vs. write-off. Identify which items still have resale potential vs. those that should be written off immediately.

**3. Capital Impact & Escalation Risk**
(3-4 sentences) Quantify the monthly cost of holding ${totalCapital > 0 ? `¥${totalCapital.toLocaleString()}` : "this inventory"} (assume a capital cost rate). Explain how medium-risk batches will escalate to high-risk in 6-12 months if untreated, and what higher write-down rates to expect. Describe the downstream effect on new procurement capacity.

**4. Tiered Disposal Action Plan**
(5-6 items, each on its own line, prefix MUST be exactly one of: [Urgent], [Important], [Monitor])
- [Urgent] Immediate action for high-risk batches (clearance sale / markdown / write-off request)
- [Urgent] Another high-risk disposal action with expected recovery rate
- [Important] 3-6 month disposal plan for medium-risk batches
- [Important] Build an early-warning trigger before batches reach 12-month threshold
- [Monitor] Preventive monitoring rules for watch-tier batches
(Sort by urgency; name specific SKUs where relevant)

Rules:
- Section titles use **bold** (e.g. **1. Title**)
- Body text in plain prose paragraphs
- Action items use "- [Priority] content" format
- No # headings
- Total: 350-500 words`;
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
