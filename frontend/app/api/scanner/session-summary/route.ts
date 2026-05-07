import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Types ──────────────────────────────────────────────────────────────────

type MovementType = "IN_PURCHASE" | "IN_RETURN" | "OUT_SALES" | "OUT_DAMAGED" | "ADJUSTMENT";

type Movement = {
  id: string;
  sku: string;
  movement_type: MovementType;
  qty: number;
  movement_date: string;
  created_at: string;
  reference_no: string | null;
  notes: string | null;
};

type SkuStat = {
  sku: string;
  total_in: number;
  total_out: number;
  net: number;
  scan_count: number;
};

type SessionStats = {
  date: string;
  total_scans: number;
  total_in: number;
  total_out: number;
  total_adj: number;
  net_change: number;
  unique_sku_count: number;
  top_skus: SkuStat[];
  duplicate_warnings: string[];
  zero_stock_skus: string[];
  over_received_skus: string[];
  sku_breakdown: string;
};

// ─── Deterministic stats computation ────────────────────────────────────────

function computeStats(movements: Movement[], date: string): SessionStats {
  const skuMap = new Map<string, SkuStat>();

  let total_in = 0, total_out = 0, total_adj = 0;

  for (const m of movements) {
    const sku = m.sku.trim();
    if (!skuMap.has(sku)) {
      skuMap.set(sku, { sku, total_in: 0, total_out: 0, net: 0, scan_count: 0 });
    }
    const stat = skuMap.get(sku)!;
    stat.scan_count += 1;

    if (m.movement_type === "IN_PURCHASE" || m.movement_type === "IN_RETURN") {
      stat.total_in += Math.abs(m.qty);
      total_in += Math.abs(m.qty);
    } else if (m.movement_type === "OUT_SALES" || m.movement_type === "OUT_DAMAGED") {
      stat.total_out += Math.abs(m.qty);
      total_out += Math.abs(m.qty);
    } else {
      total_adj += m.qty;
    }
    stat.net = stat.total_in - stat.total_out;
  }

  // Top SKUs by total movement volume
  const top_skus = Array.from(skuMap.values())
    .sort((a, b) => (b.total_in + b.total_out) - (a.total_in + a.total_out))
    .slice(0, 10);

  // Duplicate scan detection: same SKU scanned within 5 seconds
  const sorted = [...movements].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const duplicateSet = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.sku === curr.sku &&
      Math.abs(new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) <= 5000
    ) {
      duplicateSet.add(curr.sku);
    }
  }

  // Zero stock after scan: net < 0 for OUT-only SKUs (simplified heuristic)
  const zero_stock_skus = Array.from(skuMap.values())
    .filter((s) => s.total_out > 0 && s.total_in === 0 && s.net < 0)
    .map((s) => s.sku)
    .slice(0, 10);

  // Over-received: IN qty unusually large (>500 units in one session as a flag)
  const over_received_skus = Array.from(skuMap.values())
    .filter((s) => s.total_in > 500)
    .map((s) => `${s.sku} (${s.total_in} units in)`)
    .slice(0, 5);

  const sku_breakdown = top_skus
    .map(
      (s) =>
        `  ${s.sku}: IN=${s.total_in}, OUT=${s.total_out}, NET=${s.net > 0 ? "+" : ""}${s.net}, scans=${s.scan_count}`
    )
    .join("\n");

  return {
    date,
    total_scans: movements.length,
    total_in,
    total_out,
    total_adj,
    net_change: total_in - total_out,
    unique_sku_count: skuMap.size,
    top_skus,
    duplicate_warnings: Array.from(duplicateSet),
    zero_stock_skus,
    over_received_skus,
    sku_breakdown,
  };
}

// ─── LLM helper ─────────────────────────────────────────────────────────────

async function callLLM(
  system: string,
  user: string,
  apiKey: string,
  model: string,
  maxTokens: number
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`OpenAI error: ${raw.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

// ─── Writer agent ────────────────────────────────────────────────────────────

function writerSystem(lang: "zh" | "en"): string {
  if (lang === "zh") {
    return `你是一位仓储运营分析师，专门为仓库主管撰写简洁准确的班次总结报告。

输出一份结构清晰的班次总结，包含以下内容：
1. 一句话标题（含日期、总扫码量、净库存方向）
2. 本班核心数据（入库量、出库量、调整量、SKU数）
3. 活跃最高的3个SKU及其数量
4. 发现的异常（重复扫码、近零库存、超量收货）——若无异常请明确写"本班无异常"
5. 给下一班次的具体行动建议

规则：
- 每个数字必须与输入数据完全一致，不得估算或四舍五入
- 行动建议必须具体可执行，不能写"关注库存变化"之类的模糊表述
- 总长度200-400字，使用简洁的段落格式，不要用Markdown标题符号(#)
- 章节加粗即可（如 **一、本班概况**）

返回格式：纯文本，含粗体格式，无JSON包装。`;
  }

  return `You are a warehouse operations analyst writing concise, accurate end-of-shift summaries for warehouse supervisors.

Write a structured shift summary covering:
1. A one-line headline (date, total scans, net stock direction)
2. Core session figures (units IN, OUT, adjustments, unique SKUs)
3. The top 3 most active SKUs with exact quantities
4. Anomalies detected (duplicate scans, near-zero stock, over-receiving) — if none, explicitly state "No anomalies this shift"
5. One concrete action item for the next shift

Rules:
- Every number must match the input data exactly — no rounding or estimation
- Action items must be specific and executable, not vague ("monitor stock levels" is not acceptable)
- Length: 180-380 words, plain paragraph format, no # headings
- Use **bold** for section labels only (e.g. **1. Shift Overview**)

Return plain text with bold formatting, no JSON wrapper.`;
}

function writerUser(stats: SessionStats, directives: string, prevReport: string): string {
  const anomaliesBlock = [
    stats.duplicate_warnings.length > 0
      ? `Duplicate scans: ${stats.duplicate_warnings.join(", ")}`
      : "Duplicate scans: none",
    stats.zero_stock_skus.length > 0
      ? `Near-zero stock after OUT: ${stats.zero_stock_skus.join(", ")}`
      : "Near-zero stock: none",
    stats.over_received_skus.length > 0
      ? `Over-received: ${stats.over_received_skus.join(", ")}`
      : "Over-received: none",
  ].join("\n");

  const base = `--- Session Data ---
Date: ${stats.date}
Total scans recorded: ${stats.total_scans}
Units IN: ${stats.total_in}
Units OUT: ${stats.total_out}
Adjustments (net qty): ${stats.total_adj}
Net stock change: ${stats.net_change >= 0 ? "+" : ""}${stats.net_change}
Unique SKUs touched: ${stats.unique_sku_count}

Top SKUs by volume:
${stats.sku_breakdown || "  (no movements)"}

Anomalies detected by system:
${anomaliesBlock}`;

  if (directives) {
    return `${base}

--- REVISION REQUIRED — apply these directives exactly ---
${directives}

Your previous draft:
${prevReport}

Return a corrected version.`;
  }

  return base;
}

// ─── Critic agent ────────────────────────────────────────────────────────────

function criticSystem(): string {
  return `You are a quality reviewer checking a warehouse shift summary for accuracy and usefulness.

Score the report on:
- factual_accuracy (0–1): every number in the report matches the raw session data exactly
- completeness (0–1): covers headline, core figures, top SKUs, anomalies, and action item
- actionability (0–1): the recommended action is specific and executable

passes = true if factual_accuracy >= 0.70 AND completeness >= 0.70 AND actionability >= 0.60

If passes = false, write improvement_directives as a short numbered checklist
telling the writer exactly what to fix (e.g. "1. Total IN should be 218, not 240").
If passes = true, improvement_directives must be an empty string.

Return JSON only:
{ "passes": boolean, "improvement_directives": string }`;
}

function criticUser(stats: SessionStats, report: string): string {
  return `--- Ground-truth session figures ---
total_scans: ${stats.total_scans}
total_in: ${stats.total_in}
total_out: ${stats.total_out}
total_adj: ${stats.total_adj}
net_change: ${stats.net_change}
unique_skus: ${stats.unique_sku_count}
top_skus: ${stats.top_skus
    .slice(0, 3)
    .map((s) => `${s.sku} IN=${s.total_in} OUT=${s.total_out}`)
    .join(", ")}
anomalies: duplicates=[${stats.duplicate_warnings.join(",")}] zero_stock=[${stats.zero_stock_skus.join(",")}]

--- Report to review ---
${report}`;
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getClientIp(req), {
    route: "session-summary",
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await req.json() as { date?: string; lang?: "zh" | "en" };
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const lang = body.lang ?? "en";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
    }
    const model = process.env.OPENAI_INSIGHT_MODEL ?? "gpt-4o";

    // ── 1. Fetch movements for this session date ──────────────────────────
    const supabase = createSupabaseAdminClient();
    const { data: movements, error } = await supabase
      .from("stock_movements")
      .select("id, sku, movement_type, qty, movement_date, created_at, reference_no, notes")
      .eq("movement_date", date)
      .order("created_at", { ascending: true });

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json({ error: "stock_movements table not set up yet" }, { status: 400 });
      }
      throw error;
    }

    if (!movements || movements.length === 0) {
      return NextResponse.json({
        report:
          lang === "zh"
            ? `${date} 当日暂无扫码记录。`
            : `No scan records found for ${date}.`,
        date,
      });
    }

    // ── 2. Compute deterministic stats ────────────────────────────────────
    const stats = computeStats(movements as Movement[], date);

    // ── 3. Writer → Critic → Retry (max 1 retry) ─────────────────────────
    let report = await callLLM(
      writerSystem(lang),
      writerUser(stats, "", ""),
      apiKey,
      model,
      700
    );

    const criticRaw = await callLLM(
      criticSystem(),
      criticUser(stats, report),
      apiKey,
      model,
      300
    );

    let passes = true;
    let directives = "";

    try {
      const cleaned = criticRaw.replace(/```json|```/g, "").trim();
      const critique = JSON.parse(cleaned) as { passes: boolean; improvement_directives: string };
      passes = critique.passes === true;
      directives = critique.improvement_directives ?? "";
    } catch {
      // critic response unparseable — treat as passing
      passes = true;
    }

    if (!passes && directives) {
      report = await callLLM(
        writerSystem(lang),
        writerUser(stats, directives, report),
        apiKey,
        model,
        700
      );
    }

    return NextResponse.json({ report, date, stats: { total_scans: stats.total_scans, total_in: stats.total_in, total_out: stats.total_out, unique_sku_count: stats.unique_sku_count } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate summary" },
      { status: 500 }
    );
  }
}
