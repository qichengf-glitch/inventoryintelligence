/**
 * POST /api/ai/ask-data
 *
 * Natural-language query interface — "Human language is the new SQL".
 * Accepts a question in natural language, builds context from live
 * inventory data, and returns an AI-generated answer grounded in the data.
 *
 * Body: { question: string, history?: { role, content }[] }
 * Returns: { answer: string, data_used: string[], model: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { getInventoryConfig } from "@/lib/inventoryConfig";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ── helpers ─────────────────────────────────────────────── */
function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

function toErr(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/* ── data loaders ────────────────────────────────────────── */
async function loadTopSkus(limit = 30) {
  try {
    const supabase = getSupabase();
    const { schema, table, skuColumn, salesColumn, stockColumn, timeColumn } = getInventoryConfig();
    if (!timeColumn) return [];

    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const { data } = await tableRef
      .select(`${skuColumn}, ${salesColumn}, ${stockColumn}, ${timeColumn}`)
      .limit(5000);

    if (!data?.length) return [];

    // aggregate by SKU
    const map = new Map<string, { totalSales: number; latestStock: number; months: Set<string> }>();
    for (const row of data as any[]) {
      const sku = String(row[skuColumn] ?? "").trim();
      if (!sku) continue;
      const sales = Number(row[salesColumn] ?? 0);
      const stock = Number(row[stockColumn] ?? 0);
      const month = String(row[timeColumn] ?? "");
      if (!map.has(sku)) map.set(sku, { totalSales: 0, latestStock: 0, months: new Set() });
      const e = map.get(sku)!;
      e.totalSales += Number.isFinite(sales) ? sales : 0;
      e.latestStock = stock; // last row wins (data is usually sorted)
      e.months.add(month);
    }

    return [...map.entries()]
      .map(([sku, v]) => ({
        sku,
        avg_monthly_sales: v.months.size > 0 ? Math.round(v.totalSales / v.months.size) : 0,
        total_sales: Math.round(v.totalSales),
        latest_stock: Math.round(v.latestStock),
        months_of_data: v.months.size,
      }))
      .sort((a, b) => b.avg_monthly_sales - a.avg_monthly_sales)
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function loadAlertCounts() {
  try {
    const supabase = getSupabase();
    const { schema, table, skuColumn, stockColumn } = getInventoryConfig();
    const tableRef = schema ? supabase.schema(schema).from(table) : supabase.from(table);
    const { data } = await tableRef.select(`${skuColumn}, ${stockColumn}`).limit(3000);

    if (!data?.length) return { oos: 0, low: 0, healthy: 0 };

    // get latest stock per SKU
    const latest = new Map<string, number>();
    for (const row of data as any[]) {
      const sku = String(row[skuColumn] ?? "");
      const stock = Number(row[stockColumn] ?? 0);
      latest.set(sku, stock);
    }

    let oos = 0, low = 0, healthy = 0;
    for (const stock of latest.values()) {
      if (stock <= 0) oos++;
      else if (stock < 50) low++;
      else healthy++;
    }
    return { oos, low, healthy, total_skus: latest.size };
  } catch {
    return { oos: 0, low: 0, healthy: 0, total_skus: 0 };
  }
}

async function loadCategoryStats() {
  try {
    const supabase = getSupabase();
    // try v_inventory_sku_monthly first
    const { data } = await supabase
      .from("v_inventory_sku_monthly")
      .select("sku, category, month_sales")
      .limit(5000);

    if (!data?.length) return [];

    const catMap = new Map<string, { skus: Set<string>; sales: number }>();
    for (const row of data as any[]) {
      const cat = String(row.category ?? "未分类");
      const sku = String(row.sku ?? "");
      const sales = Number(row.month_sales ?? 0);
      if (!catMap.has(cat)) catMap.set(cat, { skus: new Set(), sales: 0 });
      const e = catMap.get(cat)!;
      e.skus.add(sku);
      e.sales += Number.isFinite(sales) ? sales : 0;
    }

    return [...catMap.entries()]
      .map(([cat, v]) => ({ category: cat, sku_count: v.skus.size, total_sales: Math.round(v.sales) }))
      .sort((a, b) => b.total_sales - a.total_sales);
  } catch {
    return [];
  }
}

/* ── system prompt ───────────────────────────────────────── */
function buildSystemPrompt(lang: string) {
  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  if (lang === "en") {
    return `You are an intelligent inventory data assistant for the Inventory Intelligence platform.
Today is ${today}.

You have access to real inventory data context provided in the user message.
Your job is to answer questions about the inventory in a clear, concise, and actionable way.

Rules:
- Always ground answers in the provided data. Never fabricate numbers.
- If data is insufficient to answer precisely, say so clearly and explain what you can infer.
- Keep answers concise: 3–6 sentences or a short structured list.
- For "what should I do" questions, give a specific 1–3 action recommendation.
- Format: use plain text. Use numbered lists for action items. Avoid markdown headers.`;
  }
  return `你是库存智能平台的智能数据助手。
今天是${today}。

你可以获取用户消息中提供的真实库存数据上下文。
你的任务是以清晰、简洁、可操作的方式回答有关库存的问题。

规则：
- 所有答案必须基于提供的数据，绝不捏造数字。
- 如果数据不足以精确回答，请坦诚说明并解释你能推断的内容。
- 保持简洁：3–6句话或简短列表。
- 对于"我应该做什么"类问题，给出1–3条具体行动建议。
- 格式：纯文本，行动项用数字列表。避免markdown标题。`;
}

/* ── user prompt ─────────────────────────────────────────── */
function buildUserPrompt(
  question: string,
  history: { role: string; content: string }[],
  topSkus: any[],
  alertCounts: any,
  categoryStats: any[],
  lang: string
) {
  const historyText = history.slice(-6).map(m => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n");

  const skuText = topSkus.slice(0, 20).map(s =>
    `${s.sku}(月均销量:${s.avg_monthly_sales}, 当前库存:${s.latest_stock}, 数据月数:${s.months_of_data})`
  ).join("; ");

  const catText = categoryStats.slice(0, 10).map(c =>
    `${c.category}(${c.sku_count}个SKU, 总销量:${c.total_sales})`
  ).join("; ");

  if (lang === "en") {
    return `## Inventory Data Context

**Alert summary:** OOS: ${alertCounts.oos}, Low stock: ${alertCounts.low}, Healthy: ${alertCounts.healthy}, Total SKUs: ${alertCounts.total_skus ?? "N/A"}

**Top SKUs by sales velocity:** ${skuText || "No data"}

**Category breakdown:** ${catText || "No data"}

---
${historyText ? `**Conversation history:**\n${historyText}\n\n` : ""}**Current question:** ${question}`;
  }

  return `## 库存数据上下文

**预警摘要：** 缺货: ${alertCounts.oos}, 低库存: ${alertCounts.low}, 健康: ${alertCounts.healthy}, SKU总数: ${alertCounts.total_skus ?? "N/A"}

**销量最高的SKU：** ${skuText || "无数据"}

**品类汇总：** ${catText || "无数据"}

---
${historyText ? `**对话历史：**\n${historyText}\n\n` : ""}**当前问题：** ${question}`;
}

/* ── main handler ────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), { route: "ask-data", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。/ Too many requests, please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }
  try {
    const body = await req.json();
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const history = Array.isArray(body?.history) ? body.history : [];
    const lang = body?.lang === "en" ? "en" : "zh";

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

    // fetch data in parallel
    const [topSkus, alertCounts, categoryStats] = await Promise.all([
      loadTopSkus(30),
      loadAlertCounts(),
      loadCategoryStats(),
    ]);

    const systemPrompt = buildSystemPrompt(lang);
    const userPrompt = buildUserPrompt(question, history, topSkus, alertCounts, categoryStats, lang);

    // try gpt-4.1 → gpt-4o
    let answer = "";
    let usedModel = "";
    for (const model of ["gpt-4.1", "gpt-4o"]) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 800,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
        answer = data?.choices?.[0]?.message?.content?.trim() ?? "";
        usedModel = model;
        break;
      } catch (e) {
        console.warn(`[ask-data] ${model} failed:`, toErr(e));
      }
    }

    if (!answer) return NextResponse.json({ error: "All models failed" }, { status: 502 });

    return NextResponse.json({
      answer,
      model: usedModel,
      data_used: ["top_skus", "alert_counts", "category_stats"],
    });
  } catch (e) {
    return NextResponse.json({ error: toErr(e) }, { status: 500 });
  }
}
