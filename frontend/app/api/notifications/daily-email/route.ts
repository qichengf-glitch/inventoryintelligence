/**
 * GET /api/notifications/daily-email
 *
 * Daily inventory digest email — sent to all registered users.
 *
 * Triggered by a cron job (DigitalOcean Scheduled Job or external cron).
 * Protected by CRON_SECRET to prevent unauthorised triggering.
 *
 * Required env vars:
 *   CRON_SECRET          - shared secret; cron must pass as ?secret=... or Authorization: Bearer ...
 *   RESEND_API_KEY       - API key from resend.com (free tier: 3000 emails/month)
 *   NOTIFY_FROM_EMAIL    - sender address, e.g. alerts@yourdomain.com
 *   NEXT_PUBLIC_APP_URL  - public URL of your app, e.g. https://inventory.example.com
 *
 * Usage:
 *   GET /api/notifications/daily-email?secret=YOUR_CRON_SECRET
 */

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { computeAlertsSnapshot, resolveInventoryAlertConfig } from "@/lib/alerts/computeAlerts";
import { createSupabaseClient } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALERT_CONFIG = resolveInventoryAlertConfig();

// ─── helpers ────────────────────────────────────────────────────────────────

function getSupabase() {
  try { return createSupabaseAdminClient(); } catch { return createSupabaseClient(); }
}

function today(): string {
  return new Date().toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
}

// ─── AI digest generation ────────────────────────────────────────────────────

async function generateDigest(alertsData: object, apiKey: string): Promise<{
  digest: string;
  critical_actions: string[];
}> {
  const prompt = `你是库存运营助手。今天是${today()}。
以下是今日库存预警快照，请生成每日摘要邮件内容，包含：
1. 2-3句整体情况叙述（语言清晰，面向管理层）。
2. 恰好3条critical_actions（简短、具体、可操作，每条不超过25个字）。

只输出合法JSON（不要markdown代码块）：
{"digest":"...","critical_actions":["行动1","行动2","行动3"]}

预警数据：
${JSON.stringify(alertsData, null, 2)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  const raw = (data?.choices?.[0]?.message?.content ?? "").trim();

  try {
    const parsed = JSON.parse(raw);
    return {
      digest: String(parsed.digest ?? ""),
      critical_actions: Array.isArray(parsed.critical_actions)
        ? parsed.critical_actions.map(String)
        : [],
    };
  } catch {
    // fallback if JSON parse fails
    return { digest: raw.slice(0, 300), critical_actions: [] };
  }
}

// ─── Email template ──────────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  digest: string;
  critical_actions: string[];
  counts: { oos: number; low: number; high: number; total: number };
  appUrl: string;
  dateStr: string;
}): string {
  const { digest, critical_actions, counts, appUrl, dateStr } = opts;

  const urgentColor = counts.oos > 0 ? "#dc2626" : "#16a34a";
  const urgentText = counts.oos > 0 ? `⚠️ ${counts.oos} 个SKU缺货` : "✅ 无缺货";

  const actionItems = critical_actions
    .map((a, i) => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f3f4f6;">
          <span style="display:inline-block;background:#7c3aed;color:#fff;border-radius:50%;width:22px;height:22px;
            text-align:center;line-height:22px;font-size:12px;font-weight:700;margin-right:10px;">${i + 1}</span>
          <span style="color:#1f2937;font-size:14px;">${a}</span>
        </td>
      </tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Inventory Intelligence 每日简报</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#7c3aed;">
    <tr>
      <td style="padding:24px 32px;">
        <span style="color:#fff;font-size:20px;font-weight:700;">📦 Inventory Intelligence</span>
        <span style="color:#c4b5fd;font-size:13px;margin-left:12px;">每日库存简报</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 20px;">
        <span style="color:#e9d5ff;font-size:13px;">${dateStr}</span>
      </td>
    </tr>
  </table>

  <!-- Main content -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 16px;" align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- KPI Cards -->
          <tr>
            <td style="padding-bottom:16px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="32%" style="padding:16px;background:#fff;border-radius:10px;text-align:center;
                      border:1px solid #e5e7eb;">
                    <div style="color:${urgentColor};font-size:22px;font-weight:700;">${counts.oos}</div>
                    <div style="color:#6b7280;font-size:12px;margin-top:4px;">缺货 SKU</div>
                  </td>
                  <td width="4%"></td>
                  <td width="32%" style="padding:16px;background:#fff;border-radius:10px;text-align:center;
                      border:1px solid #e5e7eb;">
                    <div style="color:#d97706;font-size:22px;font-weight:700;">${counts.low}</div>
                    <div style="color:#6b7280;font-size:12px;margin-top:4px;">低库存 SKU</div>
                  </td>
                  <td width="4%"></td>
                  <td width="32%" style="padding:16px;background:#fff;border-radius:10px;text-align:center;
                      border:1px solid #e5e7eb;">
                    <div style="color:#7c3aed;font-size:22px;font-weight:700;">${counts.high}</div>
                    <div style="color:#6b7280;font-size:12px;margin-top:4px;">高库存 SKU</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Urgent banner (only shown when OOS > 0) -->
          ${counts.oos > 0 ? `
          <tr>
            <td style="padding-bottom:16px;">
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;
                  color:#991b1b;font-size:13px;">
                🚨 <strong>${urgentText}</strong> — 请尽快查看告警中心并安排补货。
              </div>
            </td>
          </tr>` : ""}

          <!-- AI Digest -->
          <tr>
            <td style="padding-bottom:16px;">
              <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;padding:20px 24px;">
                <div style="display:flex;align-items:center;margin-bottom:12px;">
                  <span style="font-size:18px;margin-right:8px;">🤖</span>
                  <span style="color:#1f2937;font-size:15px;font-weight:600;">今日库存概况</span>
                </div>
                <p style="color:#374151;font-size:14px;line-height:1.7;margin:0;">${digest}</p>
              </div>
            </td>
          </tr>

          <!-- Critical Actions -->
          ${critical_actions.length > 0 ? `
          <tr>
            <td style="padding-bottom:16px;">
              <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
                <div style="background:#7c3aed;padding:12px 20px;">
                  <span style="color:#fff;font-size:14px;font-weight:600;">⚡ 今日优先行动</span>
                </div>
                <table width="100%" cellpadding="0" cellspacing="0">
                  ${actionItems}
                </table>
              </div>
            </td>
          </tr>` : ""}

          <!-- CTA Button -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <a href="${appUrl}" style="display:inline-block;background:#7c3aed;color:#fff;
                  padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;
                  text-decoration:none;">
                打开 Dashboard →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;">
              <p style="color:#9ca3af;font-size:12px;margin:0;">
                此邮件由 Inventory Intelligence 自动生成 · 每日发送<br>
                如需取消订阅，请联系系统管理员。
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── 1. Auth check ──────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET env var is not set" }, { status: 500 });
  }

  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret");
  const authHeader = req.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (querySecret !== cronSecret && bearerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Env vars ────────────────────────────────────────────────────────────
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.NOTIFY_FROM_EMAIL ?? "alerts@resend.dev";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.com";
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!resendApiKey) return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  if (!openaiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  // ── 3. Get registered users from Supabase Auth ─────────────────────────────
  const adminClient = createSupabaseAdminClient();
  const { data: usersData, error: usersError } = await adminClient.auth.admin.listUsers({
    perPage: 100,
  });

  if (usersError || !usersData?.users) {
    return NextResponse.json({ error: `Failed to list users: ${usersError?.message}` }, { status: 500 });
  }

  const recipients = usersData.users
    .filter((u) => u.email && u.email_confirmed_at) // only confirmed emails
    .map((u) => u.email as string);

  if (recipients.length === 0) {
    return NextResponse.json({ message: "No confirmed users to notify", sent: 0 });
  }

  // ── 4. Generate alert snapshot ─────────────────────────────────────────────
  const supabase = getSupabase();
  let alertsData: object;
  let counts = { oos: 0, low: 0, high: 0, total: 0 };

  try {
    const snapshot = await computeAlertsSnapshot(supabase, {
      month: "latest",
      config: ALERT_CONFIG,
    });

    counts = {
      oos: snapshot.counts.oos ?? 0,
      low: snapshot.counts.low ?? 0,
      high: snapshot.counts.high ?? 0,
      total: (snapshot.counts.oos ?? 0) + (snapshot.counts.low ?? 0) + (snapshot.counts.high ?? 0),
    };

    // Compact context for AI (top 15 alerts only to stay within token limits)
    alertsData = {
      date: today(),
      counts,
      top_alerts: [
        ...(snapshot.top10.oos ?? []).slice(0, 5).map((item) => ({
          type: "OOS",
          sku: item.sku,
          stock: item.on_hand,
        })),
        ...(snapshot.top10.low ?? []).slice(0, 5).map((item) => ({
          type: "LOW",
          sku: item.sku,
          stock: item.on_hand,
        })),
        ...(snapshot.top10.high ?? []).slice(0, 5).map((item) => ({
          type: "HIGH",
          sku: item.sku,
          stock: item.on_hand,
        })),
      ],
    };
  } catch (err) {
    console.error("[daily-email] Failed to load alerts:", err);
    alertsData = { date: today(), error: "Could not load alert data" };
  }

  // ── 5. Generate AI digest ──────────────────────────────────────────────────
  let digest = "今日库存数据已更新，请登录查看最新预警详情。";
  let critical_actions: string[] = [];

  try {
    const ai = await generateDigest(alertsData, openaiKey);
    digest = ai.digest || digest;
    critical_actions = ai.critical_actions;
  } catch (err) {
    console.error("[daily-email] AI digest failed, using fallback:", err);
  }

  // ── 6. Build email HTML ────────────────────────────────────────────────────
  const dateStr = today();
  const html = buildEmailHtml({ digest, critical_actions, counts, appUrl, dateStr });
  const subject = counts.oos > 0
    ? `🚨 [库存告警] ${counts.oos} 个SKU缺货 · ${dateStr}`
    : `📦 库存每日简报 · ${dateStr}`;

  // ── 7. Send emails via Resend ──────────────────────────────────────────────
  let sent = 0;
  const errors: string[] = [];

  for (const to of recipients) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({ from: fromEmail, to, subject, html }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        errors.push(`${to}: ${errBody}`);
      } else {
        sent++;
      }
    } catch (err) {
      errors.push(`${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[daily-email] Sent ${sent}/${recipients.length} emails. Errors: ${errors.length}`);

  return NextResponse.json({
    message: `Sent ${sent} of ${recipients.length} emails`,
    sent,
    total_recipients: recipients.length,
    alert_counts: counts,
    errors: errors.length > 0 ? errors : undefined,
  });
}
