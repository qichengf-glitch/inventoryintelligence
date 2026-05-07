/**
 * POST /api/marketing/industry-news
 *
 * Fetches live industry news from Google News RSS, then uses GPT-4.1 to
 * synthesise a marketing strategy that combines current headlines with
 * the caller's inventory data.
 *
 * Body:
 *   { lang?: "zh"|"en", skus?: SkuPerformance[], category_stats?: CategoryStat[] }
 *
 * Returns:
 *   { articles: NewsArticle[], ai_strategy: string, fetched_at: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

type NewsArticle = {
  title: string;
  source: string;
  pubDate: string;
  link: string;
};

type SkuPerformance = {
  sku: string;
  category: string | null;
  sales_velocity: number;
  latest_stock: number;
  growth_pct: number;
  margin_pct: number | null;
  stock_health: 0 | 1 | 2;
  composite_score: number;
  promo_opportunity: boolean;
};

type CategoryStat = {
  category: string;
  sku_count: number;
  avg_score: number;
  avg_velocity: number;
};

// ─── RSS parser ───────────────────────────────────────────────────────────────

function extractCdata(raw: string): string {
  // handles <![CDATA[...]]> and plain text
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : raw).trim();
}

const MAX_AGE_DAYS = 90; // only keep articles published within 90 days

function parseRssItems(xml: string, limit = 10): NewsArticle[] {
  const items: NewsArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let m: RegExpExecArray | null;

  while ((m = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = m[1];

    const titleRaw = block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const title = extractCdata(titleRaw);

    // Google News links are wrapped in <link> or right after <guid>
    const linkRaw =
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ??
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ??
      "";
    const link = linkRaw.trim();

    const pubDateRaw = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    const pubDate = pubDateRaw.trim();

    // ── Age filter: skip articles older than MAX_AGE_DAYS ─────────────────
    if (pubDate) {
      try {
        const articleDate = new Date(pubDate).getTime();
        if (!isNaN(articleDate) && articleDate < cutoff) continue;
      } catch {
        // unparseable date — let it through
      }
    }

    // <source url="...">Name</source>
    const sourceRaw = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "";
    const source = extractCdata(sourceRaw);

    if (title.length > 5) {
      items.push({ title, source, pubDate, link });
    }
  }

  return items;
}

// ─── News fetch ───────────────────────────────────────────────────────────────

// Industry-specific queries for fine chemicals / coatings / cosmetics sector
const RSS_QUERIES: Record<"zh" | "en", string[]> = {
  zh: [
    "精细化工 市场 原材料",
    "云母 涂料 化妆品原料 供应链",
    "涂料行业 化妆品行业 营销 消费趋势",
    "制造业 化工原料 价格 政策",
  ],
  en: [
    "fine chemicals specialty chemicals market",
    "mica coatings cosmetics raw materials supply",
    "coatings paint industry cosmetics beauty trends",
    "manufacturing chemicals price policy",
  ],
};

async function fetchRssFeed(query: string, lang: "zh" | "en"): Promise<NewsArticle[]> {
  // Add `after:` date filter so Google only returns results from last 90 days
  const cutoffDate = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const afterStr = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const fullQuery = `${query} after:${afterStr}`;
  const encoded = encodeURIComponent(fullQuery);
  const url =
    lang === "zh"
      ? `https://news.google.com/rss/search?q=${encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
      : `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; InventoryIntelligenceBot/1.0; +https://inventory-intelligence.app)",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    // Next.js route fetch cache — revalidate every 60 min
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`RSS ${res.status} for "${query}"`);
  const xml = await res.text();
  return parseRssItems(xml, 5);
}

async function fetchAllNews(lang: "zh" | "en"): Promise<NewsArticle[]> {
  const queries = RSS_QUERIES[lang];
  const results = await Promise.allSettled(queries.map((q) => fetchRssFeed(q, lang)));

  // Merge and deduplicate by title prefix (first 30 chars)
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const article of r.value) {
      const key = article.title.slice(0, 30).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(article);
      }
    }
  }

  return merged.slice(0, 12);
}

// ─── AI strategy builder ───────────────────────────────────────────────────────

function buildStrategyPrompt(
  articles: NewsArticle[],
  skus: SkuPerformance[],
  categoryStats: CategoryStat[],
  lang: "zh" | "en"
): string {
  const today = new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Compact news block
  const newsBlock = articles.length > 0
    ? articles
        .map((a, i) => `${i + 1}. [${a.source || "News"}] ${a.title}`)
        .join("\n")
    : lang === "zh"
      ? "（暂无获取到新闻，请根据当前日期和行业常识给出时事建议）"
      : "(No live news retrieved — base advice on current date and industry knowledge)";

  // Compact inventory block
  const overstocked = skus.filter((s) => s.stock_health === 2).slice(0, 6);
  const understocked = skus.filter((s) => s.stock_health === 0).slice(0, 4);
  const topSkus = skus.slice(0, 8);
  const skuLine = (list: SkuPerformance[]) =>
    list
      .map(
        (s) =>
          `${s.sku}(cat:${s.category ?? "?"},score:${s.composite_score},vel:${s.sales_velocity.toFixed(1)},margin:${s.margin_pct ?? "?"}%,${["低库存","正常","过高"][s.stock_health]})`
      )
      .join("; ");

  const catLine = categoryStats
    .slice(0, 8)
    .map((c) => `${c.category}(${c.sku_count}SKUs,avgScore:${c.avg_score})`)
    .join("; ");

  // Industry context injected into every prompt
  const industryContext = lang === "zh"
    ? "你的客户所在行业：**精细化工 / 涂料 / 化妆品原料**（核心原材料包括云母、珠光颜料等）。下游客户包括化妆品品牌、涂料厂、工业制造商。"
    : "Your client's industry: **Fine Chemicals / Coatings / Cosmetics Ingredients** (core materials include mica, pearlescent pigments). Downstream customers include cosmetics brands, paint manufacturers, industrial manufacturers.";

  if (lang === "zh") {
    return `你是一位精通精细化工、涂料和化妆品原料行业的资深营销战略顾问。今天是${today}。

${industryContext}

## 今日行业新闻（实时获取）
${newsBlock}

## 当前库存数据
- 高分 SKU（前8）：${skuLine(topSkus) || "无"}
- 库存偏高 SKU（需促销消化）：${overstocked.length > 0 ? skuLine(overstocked) : "无"}
- 库存不足 SKU（需谨慎推广）：${understocked.length > 0 ? skuLine(understocked) : "无"}
- 品类概览：${catLine || "暂无品类数据"}

## 你的任务
结合以上行业新闻与库存实况，给出 3-5 条**当下最值得执行**的 B2B/B2C 营销策略。要求：
1. **新闻与库存关联**：明确哪条新闻影响哪个品类/SKU（如云母价格波动→珠光系列备货；化妆品监管新政→合规原料推广）
2. **精细化工 B2B 视角**：渠道可包括行业展会、采购商定向触达、原料商城、行业媒体投放、大客户定向报价
3. **库存导向**：过高库存优先清仓/捆绑销售，低库存控制推广节奏或开启预购
4. **格式**：Markdown，每条策略用 ## 标题，加粗关键数字和具体行动

请直接给出策略，不要输出任何开场白或解释性前言。`;
  }

  return `You are a senior marketing strategist specialising in fine chemicals, coatings, and cosmetics raw materials. Today is ${today}.

${industryContext}

## Live Industry News
${newsBlock}

## Current Inventory Snapshot
- Top-scoring SKUs: ${skuLine(topSkus) || "none"}
- Overstocked SKUs (need clearance): ${overstocked.length > 0 ? skuLine(overstocked) : "none"}
- Understocked SKUs (limit promotion): ${understocked.length > 0 ? skuLine(understocked) : "none"}
- Category overview: ${catLine || "no category data"}

## Your Task
Based on the news above and live inventory data, provide 3-5 **immediately actionable** B2B/B2C marketing strategies. Requirements:
1. **Connect news to inventory**: Identify which news item affects which category/SKU (e.g. mica price spike → pearlescent pigment pricing strategy; new cosmetics regulation → compliant ingredient promotion)
2. **Fine chemicals B2B lens**: Channels can include trade shows, targeted outreach to buyers, ingredient marketplaces, trade press, key account pricing
3. **Stock-driven**: High-stock SKUs need clearance or bundling; low-stock SKUs need pacing or pre-order
4. **Format**: Markdown, each strategy as ## heading, bold key numbers and actions

Jump straight into the strategies — no preamble or disclaimer.`;
}

// ─── OpenAI helper ────────────────────────────────────────────────────────────

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      temperature: 0.55,
      max_tokens: 1400,
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

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), {
    route: "industry-news",
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。/ Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const lang: "zh" | "en" = body?.lang === "en" ? "en" : "zh";
    const skus: SkuPerformance[] = Array.isArray(body?.skus) ? body.skus : [];
    const categoryStats: CategoryStat[] = Array.isArray(body?.category_stats) ? body.category_stats : [];

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    // ── Step 1: Fetch live news (best-effort — non-fatal if it fails) ─────────
    let articles: NewsArticle[] = [];
    let newsFetchError = "";
    try {
      articles = await fetchAllNews(lang);
    } catch (e) {
      newsFetchError = e instanceof Error ? e.message : String(e);
      console.warn("[industry-news] RSS fetch failed:", newsFetchError);
    }

    // ── Step 2: Build AI strategy combining news + inventory ──────────────────
    const prompt = buildStrategyPrompt(articles, skus, categoryStats, lang);
    const aiStrategy = await callOpenAI(prompt, apiKey);

    return NextResponse.json({
      articles,
      ai_strategy: aiStrategy,
      news_fetch_error: newsFetchError || null,
      lang,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
