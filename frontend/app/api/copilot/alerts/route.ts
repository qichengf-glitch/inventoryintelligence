import { NextRequest, NextResponse } from "next/server";

import {
  computeAlertsSnapshot,
  resolveInventoryAlertConfig,
} from "@/lib/alerts/computeAlerts";
import type { AlertsResponse } from "@/lib/alerts/types";
import { scopeGuard } from "@/lib/copilot/scopeGuard";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { createSupabaseClient } from "@/lib/supabaseClient";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const ALERT_CONFIG = resolveInventoryAlertConfig();

async function getSupabaseForAlerts() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return createSupabaseClient();
  }
}

function buildAlertsPrompt(userQuestion: string, messages: ChatMessage[], alerts: AlertsResponse) {
  const recentChat = messages
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }))
    .filter((m) => m.role !== "system");

  const context = {
    as_of: alerts.as_of,
    updated_at: alerts.updated_at,
    counts: alerts.counts,
    top10: alerts.top10,
  };

  return [
    "You are the Inventory Alerts copilot for the /alerts page only.",
    "Allowed topics:",
    "- OOS/LOW/HIGH SKU lists and counts",
    "- safety_stock/high_stock thresholds and meaning on this page",
    "- suggested_action and suggested_replenish_qty",
    "- how to set thresholds on this page",
    "Hard rules:",
    "- Do not answer out-of-scope modules (auth/upload/forecast/system design/etc).",
    "- If user asks trends/history/leadtime, state these are not available in alerts scope.",
    "- Do not hallucinate demand history or lead-time data.",
    "- Always ground response in the provided alerts context.",
    "",
    `User question:\n${userQuestion}`,
    "",
    `Recent chat:\n${JSON.stringify(recentChat, null, 2)}`,
    "",
    `Alerts context:\n${JSON.stringify(context, null, 2)}`,
  ].join("\n");
}

function parseAnswerFromResponsePayload(data: any) {
  // Parse chat/completions response format
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  return "";
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), { route: "copilot-alerts", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试。/ Too many requests, please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const question = String(lastUserMessage?.content ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "messages with a user question are required" }, { status: 400 });
    }

    const guard = scopeGuard("alerts", question);
    if (!guard.allowed) {
      return NextResponse.json({
        answer: guard.message,
        outOfScope: true,
        redirectTo: guard.redirectTo,
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not set" }, { status: 500 });
    }

    const supabase = await getSupabaseForAlerts();
    const alerts = await computeAlertsSnapshot(supabase, { month: "latest", config: ALERT_CONFIG });
    const prompt = buildAlertsPrompt(question, messages, alerts);

    const requestedModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const allowList = new Set(["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]);
    const model = allowList.has(requestedModel) ? requestedModel : "gpt-4o-mini";

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!openaiRes.ok) {
      const raw = await openaiRes.text();
      try {
        const parsed = JSON.parse(raw);
        const message = parsed?.error?.message || raw;
        return NextResponse.json({ error: String(message) }, { status: 502 });
      } catch {
        return NextResponse.json({ error: raw }, { status: 502 });
      }
    }

    const data = await openaiRes.json();
    const answer = parseAnswerFromResponsePayload(data);
    if (!answer) {
      return NextResponse.json({ error: "Model returned no text content" }, { status: 502 });
    }

    return NextResponse.json({
      answer,
      model,
      outOfScope: false,
      redirectTo: null,
      context: {
        counts: alerts.counts,
        updated_at: alerts.updated_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
