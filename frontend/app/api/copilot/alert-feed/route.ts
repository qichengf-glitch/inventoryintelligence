/**
 * GET /api/copilot/alert-feed
 *
 * Automated daily alert digest — runs on page load, no trigger needed.
 * Returns a prioritised, AI-generated digest of today's inventory alerts
 * grouped by severity with specific action items per group.
 *
 * Returns:
 * {
 *   digest: string,           // AI narrative summary
 *   critical_actions: string[], // top 3 immediate actions
 *   alert_groups: AlertGroup[],
 *   counts: { oos, low, high, total },
 *   generated_at: string,
 *   model: string
 * }
 */

import { NextResponse } from "next/server";
import { computeAlertsSnapshot, resolveInventoryAlertConfig } from "@/lib/alerts/computeAlerts";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import type { AlertItem } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 45;

const ALERT_CONFIG = resolveInventoryAlertConfig();

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

function toErr(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function buildDigestPrompt(alertsJson: object, lang: string) {
  const today = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  const data = JSON.stringify(alertsJson, null, 2);

  if (lang === "en") {
    return `You are an inventory operations assistant. Today is ${today}.
Below is today's inventory alert snapshot. Generate a daily digest with:
1. A 2–3 sentence narrative summary of the overall situation.
2. Exactly 3 critical_actions (short, specific, actionable — each under 20 words).

Output ONLY valid JSON (no markdown):
{
  "digest": "...",
  "critical_actions": ["action1", "action2", "action3"]
}

Alert data:
${data}`;
  }

  return `你是库存运营助手。今天是${today}。
以下是今日库存预警快照。请生成每日摘要，包含：
1. 2–3句整体情况叙述。
2. 恰好3条critical_actions（简短、具体、可执行，每条不超过20个字）。

只输出合法JSON（不要markdown）：
{
  "digest": "...",
  "critical_actions": ["行动1", "行动2", "行动3"]
}

预警数据：
${data}`;
}

function flattenAlerts(items: { oos: AlertItem[]; low: AlertItem[]; high: AlertItem[] }) {
  return [...items.oos, ...items.low, ...items.high];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

    const supabase = getSupabase();
    const alerts = await computeAlertsSnapshot(supabase, { month: "latest", config: ALERT_CONFIG });
    const topBySeverity = alerts.top10;

    // Build alert groups for UI
    const alertGroups = [
      {
        type: "oos",
        label: lang === "zh" ? "缺货 (OOS)" : "Out of Stock (OOS)",
        color: "red",
        count: alerts.counts.oos,
        items: topBySeverity.oos.slice(0, 10).map((a) => ({
          sku: a.sku,
          stock: a.on_hand,
          action: a.suggested_action,
          replenish_qty: a.suggested_replenish_qty,
        })),
      },
      {
        type: "low",
        label: lang === "zh" ? "低库存 (LOW)" : "Low Stock (LOW)",
        color: "amber",
        count: alerts.counts.low,
        items: topBySeverity.low.slice(0, 10).map((a) => ({
          sku: a.sku,
          stock: a.on_hand,
          action: a.suggested_action,
          replenish_qty: a.suggested_replenish_qty,
        })),
      },
      {
        type: "high",
        label: lang === "zh" ? "高库存 (HIGH)" : "High Stock (HIGH)",
        color: "violet",
        count: alerts.counts.high,
        items: topBySeverity.high.slice(0, 10).map((a) => ({
          sku: a.sku,
          stock: a.on_hand,
          action: a.suggested_action,
        })),
      },
    ].filter(g => g.count > 0);

    // Build compact context for AI
    const aiContext = {
      counts: alerts.counts,
      top_urgent: flattenAlerts(alerts.top10).slice(0, 15).map((a) => ({
        sku: a.sku,
        status: a.status,
        on_hand: a.on_hand,
        suggested_action: a.suggested_action,
      })),
    };

    const prompt = buildDigestPrompt(aiContext, lang);

    let digest = lang === "zh"
      ? `今日共 ${alerts.counts.oos} 个缺货、${alerts.counts.low} 个低库存、${alerts.counts.high} 个高库存 SKU。`
      : `Today: ${alerts.counts.oos} OOS, ${alerts.counts.low} low stock, ${alerts.counts.high} high stock SKUs.`;
    let critical_actions: string[] = [];
    let usedModel = "";

    for (const model of ["gpt-4.1-mini", "gpt-4o-mini"]) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
        const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
        const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(cleaned);
        digest = parsed.digest ?? digest;
        critical_actions = Array.isArray(parsed.critical_actions) ? parsed.critical_actions.slice(0, 3) : [];
        usedModel = model;
        break;
      } catch (e) {
        console.warn(`[alert-feed] ${model} failed:`, toErr(e));
      }
    }

    return NextResponse.json({
      digest,
      critical_actions,
      alert_groups: alertGroups,
      counts: alerts.counts,
      generated_at: new Date().toISOString(),
      model: usedModel,
    });
  } catch (e) {
    return NextResponse.json({ error: toErr(e) }, { status: 500 });
  }
}
