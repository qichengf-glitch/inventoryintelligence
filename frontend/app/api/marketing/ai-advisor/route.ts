import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
/**
 * POST /api/marketing/ai-advisor
 *
 * Accepts inventory performance data and returns AI-generated
 * campaign / promotion suggestions using GPT-4.1.
 *
 * Body (JSON):
 *   {
 *     skus: SkuPerformance[],          // top-N SKUs from /api/marketing/performance
 *     category_stats: CategoryStat[],  // category summary
 *     focus?: string,                   // optional: specific category or SKU to focus on
 *     lang?: "zh" | "en"               // UI language (default "zh")
 *   }
 *
 * Returns:
 *   { campaigns: CampaignSuggestion[], generated_at: string }
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow up to 60s for large payloads

/* ── Types ─────────────────────────────────────────────────── */
type SkuPerformance = {
  sku: string;
  category: string | null;
  sample_months: number;
  sales_velocity: number;
  avg_end_stock: number;
  latest_stock: number;
  growth_pct: number;
  turnover_ratio: number;
  margin_pct: number | null;
  gross_profit_avg: number | null;
  price: number | null;
  cost: number | null;
  stock_health: 0 | 1 | 2;
  safety_stock: number | null;
  high_stock: number | null;
  composite_score: number;
  promo_opportunity: boolean;
};

type CategoryStat = {
  category: string;
  sku_count: number;
  avg_score: number;
  avg_velocity: number;
};

export type CampaignSuggestion = {
  id: string;
  title: string;
  target_type: "sku" | "category" | "bundle";
  targets: string[];             // SKU codes or category names
  timing: string;                // e.g. "本周末" / "五一前两周"
  channel: string[];             // e.g. ["天猫", "抖音直播", "私域微信"]
  mechanic: string;              // e.g. "买二送一" / "满300减50" / "直播专属折扣"
  discount_pct: number | null;   // estimated discount %
  priority: "high" | "medium" | "low";
  rationale: string;             // AI reasoning
  expected_outcome: string;      // what the campaign should achieve
};

/* ── Helpers ────────────────────────────────────────────────── */
function toErrMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
}

const OPENAI_BASE = "https://api.openai.com/v1";

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  return key;
}

/** Try gpt-4.1 first, then gpt-4o as fallback. */
async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errMsg = data?.error?.message ?? `OpenAI API error ${res.status}`;
    throw new Error(errMsg);
  }
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

/* ── System prompt ──────────────────────────────────────────── */
function buildSystemPrompt(lang: string): string {
  const today = new Date().toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric",
  });

  if (lang === "en") {
    return `You are a senior e-commerce marketing strategist with expertise in Chinese and global consumer markets.
Today is ${today}.

Your role is to analyze inventory performance data and generate actionable, specific marketing campaign suggestions.
Focus on:
- Current seasonal opportunities (consider the time of year and upcoming holidays/shopping events)
- Stock health: prioritize overstocked SKUs for clearance, understocked for waitlist/pre-order
- Margin headroom: suggest discounts that maintain profitability
- Growth trends: amplify what's working, rescue declining SKUs
- Channel mix: recommend appropriate channels (Tmall, JD, Douyin live, WeChat private domain, etc.)

Output ONLY a valid JSON array of campaign objects. No markdown, no explanation outside the JSON.
Schema per campaign:
{
  "id": "c1",
  "title": "Campaign name",
  "target_type": "sku" | "category" | "bundle",
  "targets": ["SKU1", "SKU2"],
  "timing": "specific timing recommendation",
  "channel": ["channel1", "channel2"],
  "mechanic": "promotion mechanics",
  "discount_pct": 15,
  "priority": "high" | "medium" | "low",
  "rationale": "why this campaign",
  "expected_outcome": "what result to expect"
}
Generate 4–6 diverse, specific, actionable campaigns. Avoid generic suggestions.`;
  }

  return `你是一名资深电商营销策略专家，精通国内外消费市场。
今天是${today}。

你的职责是分析库存绩效数据，生成具体可执行的营销活动建议。
关注以下维度：
- 当前季节机遇（考虑时间节点、即将到来的节日/购物活动如五一、618、双11等）
- 库存健康：库存偏高的SKU优先清库促销，库存不足的考虑预售/候补名单
- 利润空间：建议能保留盈利能力的折扣幅度
- 增长趋势：放大正在增长的品类，挽救下滑的SKU
- 渠道组合：推荐合适渠道（天猫、京东、抖音直播、微信私域、小红书等）

只输出一个合法的JSON数组，不要输出任何Markdown或JSON之外的文字。
每条活动的字段如下：
{
  "id": "c1",
  "title": "活动名称",
  "target_type": "sku" | "category" | "bundle",
  "targets": ["SKU1", "SKU2"],
  "timing": "具体时间建议",
  "channel": ["渠道1", "渠道2"],
  "mechanic": "促销机制（如满减、折扣、买赠等）",
  "discount_pct": 15,
  "priority": "high" | "medium" | "low",
  "rationale": "为什么做这个活动的分析",
  "expected_outcome": "预期效果"
}
请生成4–6条多样化、具体、可落地的活动建议，避免泛泛而谈。`;
}

/* ── User prompt ────────────────────────────────────────────── */
function buildUserPrompt(
  skus: SkuPerformance[],
  categoryStats: CategoryStat[],
  focus: string,
  lang: string
): string {
  // Pick a representative subset: top scorers, fastest growers, most at-risk
  const top10 = skus.slice(0, 10);
  const topGrowing = [...skus].sort((a, b) => b.growth_pct - a.growth_pct).slice(0, 5);
  const declining = [...skus].sort((a, b) => a.growth_pct - b.growth_pct).slice(0, 5);
  const overstocked = skus.filter((s) => s.stock_health === 2).slice(0, 8);
  const understocked = skus.filter((s) => s.stock_health === 0).slice(0, 5);
  const highMargin = skus.filter((s) => s.margin_pct !== null && s.margin_pct > 40).slice(0, 5);

  const skuSummary = (list: SkuPerformance[]) =>
    list.map((s) =>
      `${s.sku}(cat:${s.category ?? "?"},score:${s.composite_score},vel:${s.sales_velocity},margin:${s.margin_pct ?? "?"}%,growth:${s.growth_pct > 0 ? "+" : ""}${s.growth_pct}%,stock_health:${["低库存", "正常", "过高"][s.stock_health]}${s.promo_opportunity ? ",★推广候选" : ""})`
    ).join("; ");

  const catSummary = categoryStats
    .map((c) => `${c.category}(${c.sku_count}SKUs,avgScore:${c.avg_score},avgVel:${c.avg_velocity}/mo)`)
    .join("; ");

  const focusLine = focus
    ? (lang === "zh" ? `\n用户希望重点关注：${focus}` : `\nUser focus area: ${focus}`)
    : "";

  if (lang === "en") {
    return `## Inventory Performance Data

**Top 10 SKUs by score:** ${skuSummary(top10)}

**Fastest growing SKUs:** ${skuSummary(topGrowing)}

**Declining SKUs:** ${skuSummary(declining)}

**Overstocked SKUs:** ${overstocked.length > 0 ? skuSummary(overstocked) : "None"}

**Understocked SKUs:** ${understocked.length > 0 ? skuSummary(understocked) : "None"}

**High-margin SKUs (>40%):** ${highMargin.length > 0 ? skuSummary(highMargin) : "None"}

**Category overview:** ${catSummary || "Single category"}
${focusLine}

Total SKUs analysed: ${skus.length}

Please generate 4–6 specific, actionable marketing campaign suggestions based on this data and current market conditions.`;
  }

  return `## 库存绩效数据

**综合评分前10 SKU：** ${skuSummary(top10)}

**增速最快 SKU：** ${skuSummary(topGrowing)}

**销量下滑 SKU：** ${skuSummary(declining)}

**库存偏高 SKU：** ${overstocked.length > 0 ? skuSummary(overstocked) : "无"}

**库存不足 SKU：** ${understocked.length > 0 ? skuSummary(understocked) : "无"}

**高利润率 SKU（>40%）：** ${highMargin.length > 0 ? skuSummary(highMargin) : "无"}

**品类概览：** ${catSummary || "单一品类"}
${focusLine}

分析SKU总数：${skus.length}

请结合以上数据与当前国内外市场行情，生成4–6条具体可落地的营销活动建议。`;
}

/* ── Main handler ───────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), { route: "marketing-ai-advisor", limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。/ Too many requests, please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }
  try {
    const body = await req.json();
    const skus: SkuPerformance[] = Array.isArray(body?.skus) ? body.skus : [];
    const categoryStats: CategoryStat[] = Array.isArray(body?.category_stats) ? body.category_stats : [];
    const focus: string = typeof body?.focus === "string" ? body.focus : "";
    const lang: string = body?.lang === "en" ? "en" : "zh";

    if (skus.length === 0) {
      return NextResponse.json({ error: "No SKU data provided" }, { status: 400 });
    }

    const apiKey = getOpenAIKey();
    const systemPrompt = buildSystemPrompt(lang);
    const userPrompt = buildUserPrompt(skus, categoryStats, focus, lang);

    // Try gpt-4.1, then gpt-4o
    let rawContent = "";
    const models = ["gpt-4.1", "gpt-4o"];
    let usedModel = "";
    let lastErr: Error | null = null;

    for (const model of models) {
      try {
        rawContent = await callOpenAI(model, systemPrompt, userPrompt, apiKey);
        usedModel = model;
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        console.warn(`[ai-advisor] model ${model} failed:`, lastErr.message);
      }
    }

    if (!rawContent) {
      throw lastErr ?? new Error("All models failed");
    }

    // Parse the JSON array returned by the model
    let campaigns: CampaignSuggestion[] = [];
    try {
      // Strip potential markdown fences
      const cleaned = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      campaigns = Array.isArray(parsed) ? parsed : [];
    } catch (parseErr) {
      console.error("[ai-advisor] JSON parse error:", parseErr, "\nRaw content:", rawContent);
      return NextResponse.json(
        { error: "AI returned non-JSON response", raw: rawContent },
        { status: 502 }
      );
    }

    return NextResponse.json({
      campaigns,
      model_used: usedModel,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/marketing/ai-advisor]", err);
    return NextResponse.json({ error: toErrMsg(err) }, { status: 500 });
  }
}
