"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { useLanguage } from "@/components/LanguageProvider";
import type { AlertItem, AlertsResponse } from "@/lib/alerts/types";
import { DEFAULT_HIGH_STOCK, DEFAULT_SAFETY_STOCK } from "@/lib/alerts/computeAlerts";

type SlowMover = {
  sku: string;
  current_stock: number;
  months_without_movement: number;
  last_out_month: string | null;
  avg_monthly_out: number;
};

type ViewKey = "oos" | "low" | "high";

const AI_SUMMARY_PROMPT = {
  zh: "请用2到4句话解读当前库存预警中心的核心风险与机会，优先说明高库存、低库存、缺货三类的重点，并给出1到2条最高优先级行动建议。",
  en: "Summarize the key risks and opportunities in the current inventory alerts dashboard in 2 to 4 sentences. Prioritize high stock, low stock, and out-of-stock issues, then give 1 to 2 highest-priority actions.",
} as const;

const VIEW_META: Record<
  ViewKey,
  { titleZh: string; titleEn: string; badgeClass: string; sortHintZh: string; sortHintEn: string }
> = {
  oos: {
    titleZh: "缺货 (OOS)",
    titleEn: "Out of Stock (OOS)",
    badgeClass: "border-red-400/40 bg-red-500/15 text-red-200",
    sortHintZh: "OnHand 升序",
    sortHintEn: "OnHand ascending",
  },
  low: {
    titleZh: "低库存 (LOW)",
    titleEn: "Low Stock (LOW)",
    badgeClass: "border-amber-400/40 bg-amber-500/15 text-amber-200",
    sortHintZh: "OnHand 升序",
    sortHintEn: "OnHand ascending",
  },
  high: {
    titleZh: "高库存 (HIGH)",
    titleEn: "High Stock (HIGH)",
    badgeClass: "border-violet-400/40 bg-violet-500/15 text-violet-200",
    sortHintZh: "OnHand 降序",
    sortHintEn: "OnHand descending",
  },
};

function statusBadgeClass(status: AlertItem["status"]) {
  if (status === "OOS") return VIEW_META.oos.badgeClass;
  if (status === "LOW") return VIEW_META.low.badgeClass;
  return VIEW_META.high.badgeClass;
}

function statusLabel(status: AlertItem["status"], lang: string) {
  if (lang !== "zh") return status;
  if (status === "OOS") return "缺货";
  if (status === "LOW") return "低库存";
  return "高库存";
}

function CountCard({
  label,
  value,
  toneClass,
}: {
  label: string;
  value: number;
  toneClass: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</p>
    </article>
  );
}

function TopListCard({
  title,
  items,
  lang,
}: {
  title: string;
  items: AlertItem[];
  lang: "zh" | "en";
}) {
  return (
    <article className="flex h-full min-h-[480px] flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{lang === "zh" ? "暂无数据" : "No data"}</p>
        ) : (
          items.map((item) => (
            <div
              key={`${title}-${item.sku}`}
              className="grid h-10 grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,0.7fr)_76px] items-center gap-2 rounded-lg border border-slate-800 px-2 text-xs"
            >
              <span className="truncate text-slate-200">{item.sku}</span>
              <span className="truncate text-slate-300">OnHand {item.on_hand}</span>
              <span className="text-slate-400">SS {item.safety_stock}</span>
              <span className={`inline-flex justify-center rounded-md border px-1 py-0.5 ${statusBadgeClass(item.status)}`}>
                {statusLabel(item.status, lang)}
              </span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function buildInsightFallback(alerts: AlertsResponse, lang: "zh" | "en") {
  const topHigh = alerts.views.high[0]?.sku;
  const topLow = alerts.views.low[0]?.sku;
  const topOos = alerts.views.oos[0]?.sku;

  if (lang === "zh") {
    const parts = [
      `当前高库存 ${alerts.counts.high} 个，低库存 ${alerts.counts.low} 个，缺货 ${alerts.counts.oos} 个。`,
      topHigh ? `高库存最突出的 SKU 是 ${topHigh}，建议优先核查去化和促销。` : "",
      topLow ? `低库存优先关注 ${topLow}。` : "",
      topOos ? `缺货风险优先关注 ${topOos}，避免继续断供。` : "",
    ].filter(Boolean);
    return parts.join("");
  }

  const parts = [
    `Current alerts show ${alerts.counts.high} high-stock SKUs, ${alerts.counts.low} low-stock SKUs, and ${alerts.counts.oos} out-of-stock SKUs.`,
    topHigh ? `The most obvious overstock SKU is ${topHigh}, so clearance or demand stimulation should be reviewed first.` : "",
    topLow ? `Prioritize replenishment review for ${topLow}.` : "",
    topOos ? `Restore supply for ${topOos} as the first stockout recovery action.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

type ChatMsg = { role: "user" | "assistant"; content: string };

function AiInsightCard({
  lang,
  alerts,
}: {
  lang: "zh" | "en";
  alerts: AlertsResponse;
}) {
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest chat message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let active = true;

    const loadInsight = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/copilot/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: AI_SUMMARY_PROMPT[lang] }],
          }),
        });
        const payload = await res.json();
        const answer =
          typeof payload?.answer === "string" && payload.answer.trim()
            ? payload.answer.trim()
            : buildInsightFallback(alerts, lang);
        if (active) setInsight(answer);
      } catch {
        if (active) setInsight(buildInsightFallback(alerts, lang));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadInsight();
    return () => { active = false; };
  }, [alerts, lang]);

  const handleAsk = async (questionRaw: string) => {
    const question = questionRaw.trim();
    if (!question || chatLoading) return;

    // Build message history: system insight + prior turns + new user message
    const history: ChatMsg[] = [
      { role: "assistant", content: insight },
      ...messages,
      { role: "user", content: question },
    ];

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: lang === "zh" ? "思考中..." : "Thinking..." },
    ]);
    setInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/copilot/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const payload = await res.json();
      const answer =
        typeof payload?.answer === "string" && payload.answer.trim()
          ? payload.answer.trim()
          : lang === "zh" ? "暂无回答，请重试。" : "No answer returned, please retry.";
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: answer },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: lang === "zh" ? "请求失败，请重试。" : "Request failed, please retry." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const suggestedFollowUps = lang === "zh"
    ? ["哪些缺货 SKU 需要立即补货？", "高库存 SKU 应如何处理？", "如何设置合理的安全库存阈值？"]
    : ["Which OOS SKUs need immediate restock?", "How should high-stock SKUs be handled?", "How to set safety stock thresholds?"];

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.9),rgba(15,23,42,0.95))] p-5 shadow-[0_18px_50px_rgba(8,47,73,0.28)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-300/80">AI Insight</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-50">
            {lang === "zh" ? "AI 解读" : "AI Interpretation"}
          </h3>
        </div>
        <div className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
          {lang === "zh" ? `统计月份 ${alerts.as_of}` : `As of ${alerts.as_of}`}
        </div>
      </div>

      {/* AI-generated insight */}
      <div className="mt-4 rounded-2xl border border-slate-700/80 bg-slate-950/35 p-4">
        {loading ? (
          <p className="text-sm text-slate-400 animate-pulse">
            {lang === "zh" ? "AI 正在生成解读..." : "Generating AI interpretation..."}
          </p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">{insight}</p>
        )}
      </div>

      {/* Follow-up chat — only show once insight is ready */}
      {!loading && (
        <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-950/30">
          {/* Chat history */}
          {messages.length > 0 && (
            <div className="max-h-[260px] space-y-2 overflow-y-auto p-4 pb-2">
              {messages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "ml-8 bg-cyan-500/80 text-slate-950"
                      : "mr-8 border border-slate-700/60 bg-slate-900/70 text-slate-100"
                  }`}
                >
                  {msg.content}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Suggested follow-up chips */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
              {suggestedFollowUps.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleAsk(prompt)}
                  disabled={chatLoading}
                  className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 transition"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input form */}
          <form
            onSubmit={(e) => { e.preventDefault(); void handleAsk(input); }}
            className="flex gap-2 p-3 border-t border-slate-700/40"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={lang === "zh" ? "继续追问..." : "Ask a follow-up question..."}
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={chatLoading || !input.trim()}
              className="rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-4 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50 transition"
            >
              {chatLoading ? "..." : lang === "zh" ? "发送" : "Send"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function AlertWindow({
  viewKey,
  lang,
  rows,
  search,
  onSearchChange,
  onEdit,
}: {
  viewKey: ViewKey;
  lang: "zh" | "en";
  rows: AlertItem[];
  search: string;
  onSearchChange: (value: string) => void;
  onEdit: (item: AlertItem) => void;
}) {
  const meta = VIEW_META[viewKey];
  const title = lang === "zh" ? meta.titleZh : meta.titleEn;
  const sortHint = lang === "zh" ? meta.sortHintZh : meta.sortHintEn;
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => item.sku.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {lang === "zh" ? "数量" : "Count"}: {filteredRows.length} · {sortHint}
          </p>
        </div>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
          className="w-full max-w-[220px] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400"
        />
      </div>

      <div className="mt-4 max-h-[360px] overflow-auto rounded-xl border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">SKU</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "现有库存" : "OnHand"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "安全库存" : "Safety"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "高库存阈值" : "High"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "状态" : "Status"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "建议补货量" : "Replenish Qty"}</th>
              <th className="px-3 py-2 text-left">{lang === "zh" ? "操作" : "Action"}</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-slate-500" colSpan={7}>
                  {lang === "zh" ? "暂无数据" : "No data"}
                </td>
              </tr>
            ) : (
              filteredRows.map((item) => (
                <tr key={`${viewKey}-${item.sku}`} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-medium">{item.sku}</td>
                  <td className="px-3 py-2">{item.on_hand}</td>
                  <td className="px-3 py-2">{item.safety_stock}</td>
                  <td className="px-3 py-2">{item.high_stock}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${statusBadgeClass(item.status)}`}>
                      {statusLabel(item.status, lang)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{item.suggested_replenish_qty}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      className="rounded-md border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
                    >
                      {lang === "zh" ? "设置阈值" : "Set Threshold"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AlertsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
      <div className="h-72 rounded-2xl border border-slate-800 bg-slate-900/70" />
    </div>
  );
}

function normalizeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    return (payload as { error: string }).error;
  }
  return fallback;
}

export default function AlertsPage() {
  const { lang } = useLanguage();
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewSearch, setViewSearch] = useState<Record<ViewKey, string>>({
    oos: "",
    low: "",
    high: "",
  });

  const [editing, setEditing] = useState<AlertItem | null>(null);
  const [thresholdSafety, setThresholdSafety] = useState("");
  const [thresholdHigh, setThresholdHigh] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [slowMovers, setSlowMovers] = useState<SlowMover[]>([]);
  const [slowMoversLoading, setSlowMoversLoading] = useState(true);
  const [slowMoversSearch, setSlowMoversSearch] = useState("");

  const loadAlerts = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/inventory/alerts?month=latest", {
        cache: "no-store",
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(normalizeError(payload, "加载预警数据失败"));
      }
      setAlerts(payload as AlertsResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载预警数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadAlerts();
  }, []);

  useEffect(() => {
    const loadSlow = async () => {
      setSlowMoversLoading(true);
      try {
        const res = await fetch("/api/inventory/slow-movers", { cache: "no-store" });
        const data = await res.json();
        setSlowMovers(data.slow_movers ?? []);
      } catch {
        setSlowMovers([]);
      } finally {
        setSlowMoversLoading(false);
      }
    };
    void loadSlow();
  }, []);

  const exportAlertsToExcel = () => {
    if (!alerts) return;
    const allItems = [
      ...alerts.views.oos.map((i) => ({ ...i, category: "OOS" })),
      ...alerts.views.low.map((i) => ({ ...i, category: "LOW" })),
      ...alerts.views.high.map((i) => ({ ...i, category: "HIGH" })),
    ];
    const ws = XLSX.utils.json_to_sheet(
      allItems.map((i) => ({
        SKU: i.sku,
        Status: i.status,
        OnHand: i.on_hand,
        SafetyStock: i.safety_stock,
        HighStock: i.high_stock,
        ReplenishQty: i.suggested_replenish_qty,
        Action: i.suggested_action,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alerts");
    if (slowMovers.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(
        slowMovers.map((s) => ({
          SKU: s.sku,
          CurrentStock: s.current_stock,
          MonthsWithoutMovement: s.months_without_movement,
          LastOutMonth: s.last_out_month ?? "—",
          AvgMonthlyOut: s.avg_monthly_out,
        }))
      );
      XLSX.utils.book_append_sheet(wb, ws2, "SlowMovers");
    }
    XLSX.writeFile(wb, `inventory-alerts-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filteredSlowMovers = useMemo(() => {
    const q = slowMoversSearch.trim().toLowerCase();
    if (!q) return slowMovers;
    return slowMovers.filter((s) => s.sku.toLowerCase().includes(q));
  }, [slowMovers, slowMoversSearch]);

  const openThresholdEditor = (item: AlertItem) => {
    setEditing(item);
    setThresholdSafety(String(item.safety_stock));
    setThresholdHigh(String(item.high_stock));
    setSaveError(null);
  };

  const applyOptimisticThresholds = (sku: string, safety: number, high: number) => {
    setAlerts((prev) => {
      if (!prev) return prev;
      const patch = (item: AlertItem): AlertItem =>
        item.sku === sku
          ? {
              ...item,
              safety_stock: safety,
              high_stock: high,
              suggested_replenish_qty: Math.max(0, safety - item.on_hand),
            }
          : item;
      return {
        ...prev,
        top10: {
          oos: prev.top10.oos.map(patch),
          low: prev.top10.low.map(patch),
          high: prev.top10.high.map(patch),
        },
        views: {
          oos: prev.views.oos.map(patch),
          low: prev.views.low.map(patch),
          high: prev.views.high.map(patch),
        },
      };
    });
  };

  const handleSaveThreshold = async () => {
    if (!editing || saving) return;
    setSaveError(null);
    setSaving(true);

    const safetyText = thresholdSafety.trim();
    const highText = thresholdHigh.trim();
    const safetyValue = safetyText === "" ? null : Number(safetyText);
    const highValue = highText === "" ? null : Number(highText);

    const isValid =
      (safetyValue == null || (Number.isInteger(safetyValue) && safetyValue >= 0)) &&
      (highValue == null || (Number.isInteger(highValue) && highValue >= 0));

    if (!isValid) {
      setSaveError("阈值必须是大于等于 0 的整数或留空。");
      setSaving(false);
      return;
    }

    const optimisticSafety = safetyValue ?? DEFAULT_SAFETY_STOCK;
    const optimisticHigh = highValue ?? DEFAULT_HIGH_STOCK;
    applyOptimisticThresholds(editing.sku, optimisticSafety, optimisticHigh);

    try {
      const res = await fetch("/api/inventory/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: editing.sku,
          safety_stock: safetyValue,
          high_stock: highValue,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(normalizeError(payload, "阈值更新失败"));
      }
      setEditing(null);
      await loadAlerts(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "阈值更新失败");
    } finally {
      setSaving(false);
    }
  };

  const contextData = useMemo(() => {
    if (!alerts) return null;
    return {
      counts: alerts.counts,
      top10: alerts.top10,
      updated_at: alerts.updated_at,
      as_of: alerts.as_of,
    };
  }, [alerts]);

  return (
    <div className="space-y-5 pb-16">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4">
        <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Inventory Alert</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">
            {lang === "zh" ? "库存预警中心" : "Inventory Alert Center"}
          </h1>
          {alerts && (
            <button
              type="button"
              onClick={exportAlertsToExcel}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/25 transition-colors"
            >
              {lang === "zh" ? "导出 Excel" : "Export Excel"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {lang === "zh"
            ? "基于安全库存阈值的缺货/低库存/高库存预警（Strategy A）。"
            : "Threshold-based OOS/LOW/HIGH alerting with manual safety stock strategy."}
        </p>
        {alerts && (
          <p className="mt-2 text-xs text-slate-500">
            {lang === "zh" ? "统计月份" : "As of"}: {alerts.as_of} ·{" "}
            {lang === "zh" ? "更新时间" : "Updated at"}: {alerts.updated_at}
            {refreshing ? (lang === "zh" ? " · 刷新中..." : " · refreshing...") : ""}
          </p>
        )}
      </section>

      {loading ? (
        <AlertsSkeleton />
      ) : error ? (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => void loadAlerts()}
            className="mt-3 rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/20"
          >
            {lang === "zh" ? "重试" : "Retry"}
          </button>
        </section>
      ) : alerts ? (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CountCard
              label={lang === "zh" ? "缺货 (OOS)" : "OOS"}
              value={alerts.counts.oos}
              toneClass="text-red-300"
            />
            <CountCard
              label={lang === "zh" ? "低库存 (LOW)" : "LOW"}
              value={alerts.counts.low}
              toneClass="text-amber-300"
            />
            <CountCard
              label={lang === "zh" ? "高库存 (HIGH)" : "HIGH"}
              value={alerts.counts.high}
              toneClass="text-violet-300"
            />
          </section>

          <AiInsightCard lang={lang} alerts={alerts} />

          <section className="space-y-4">
            <AlertWindow
              viewKey="high"
              lang={lang}
              rows={alerts.views.high}
              search={viewSearch.high}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, high: value }))}
              onEdit={openThresholdEditor}
            />
            <AlertWindow
              viewKey="low"
              lang={lang}
              rows={alerts.views.low}
              search={viewSearch.low}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, low: value }))}
              onEdit={openThresholdEditor}
            />
            <AlertWindow
              viewKey="oos"
              lang={lang}
              rows={alerts.views.oos}
              search={viewSearch.oos}
              onSearchChange={(value) => setViewSearch((prev) => ({ ...prev, oos: value }))}
              onEdit={openThresholdEditor}
            />
          </section>
        </>
      ) : null}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-slate-100">
              {lang === "zh" ? "设置阈值" : "Set Threshold"} · {editing.sku}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {lang === "zh"
                ? `安全库存与高库存阈值。留空则使用默认值（${DEFAULT_SAFETY_STOCK}/${DEFAULT_HIGH_STOCK}）。`
                : `Safety/high stock thresholds. Leave blank to use defaults (${DEFAULT_SAFETY_STOCK}/${DEFAULT_HIGH_STOCK}).`}
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300">
                safety_stock
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={thresholdSafety}
                  onChange={(event) => setThresholdSafety(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-sm text-slate-300">
                high_stock
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={thresholdHigh}
                  onChange={(event) => setThresholdHigh(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            {saveError && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {saveError}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              >
                {lang === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveThreshold()}
                disabled={saving}
                className="rounded-md border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (lang === "zh" ? "保存中..." : "Saving...") : lang === "zh" ? "保存" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slow Movers Section */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              {lang === "zh" ? "滞销预警 (Slow Movers)" : "Slow Movers Alert"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === "zh"
                ? "有库存但连续 2+ 个月无出库的 SKU"
                : "SKUs with stock but zero outbound for 2+ consecutive months"}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
              {slowMovers.length} SKU
            </span>
            <input
              value={slowMoversSearch}
              onChange={(e) => setSlowMoversSearch(e.target.value)}
              placeholder={lang === "zh" ? "搜索 SKU" : "Search SKU"}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400 w-36"
            />
          </div>
        </div>

        {slowMoversLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded-lg bg-slate-800/50" />)}
          </div>
        ) : filteredSlowMovers.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            {lang === "zh" ? "暂无滞销 SKU" : "No slow movers detected"}
          </p>
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/95 text-xs uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "当前库存" : "Stock"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "滞销月数" : "Idle Months"}</th>
                  <th className="px-3 py-2 text-left">{lang === "zh" ? "最后出库月" : "Last Out Month"}</th>
                  <th className="px-3 py-2 text-right">{lang === "zh" ? "月均出库" : "Avg Out/Mo"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSlowMovers.map((s) => (
                  <tr key={s.sku} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-medium">{s.sku}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.current_stock.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs ${
                        s.months_without_movement >= 3
                          ? "border-red-400/40 bg-red-500/15 text-red-200"
                          : "border-amber-400/40 bg-amber-500/15 text-amber-200"
                      }`}>
                        {s.months_without_movement}mo
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{s.last_out_month ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{s.avg_monthly_out}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Follow-up chat is now embedded in AiInsightCard above */}
    </div>
  );
}
