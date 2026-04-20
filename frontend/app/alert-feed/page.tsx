"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/* ── Types ──────────────────────────────────────────────────── */
type AlertGroupItem = {
  sku: string;
  stock: number;
  action: string;
  replenish_qty?: number;
};

type AlertGroup = {
  type: "oos" | "low" | "high";
  label: string;
  color: "red" | "amber" | "violet";
  count: number;
  items: AlertGroupItem[];
};

type FeedResponse = {
  digest: string;
  critical_actions: string[];
  alert_groups: AlertGroup[];
  counts: { oos: number; low: number; high: number; total?: number };
  generated_at: string;
  model: string;
};

const CARD = "rounded-2xl border border-slate-800 bg-slate-900/70";

const COLOR_MAP = {
  red: {
    card: "border-red-500/30 bg-red-500/10",
    badge: "border-red-400/40 bg-red-500/15 text-red-200",
    dot: "bg-red-400",
    count: "text-red-300",
    icon: "🔴",
  },
  amber: {
    card: "border-amber-500/30 bg-amber-500/10",
    badge: "border-amber-400/40 bg-amber-500/15 text-amber-200",
    dot: "bg-amber-400",
    count: "text-amber-300",
    icon: "🟡",
  },
  violet: {
    card: "border-violet-500/30 bg-violet-500/10",
    badge: "border-violet-400/40 bg-violet-500/15 text-violet-200",
    dot: "bg-violet-400",
    count: "text-violet-300",
    icon: "🟣",
  },
};

/* ── Component ──────────────────────────────────────────────── */
export default function AlertFeedPage() {
  const { lang } = useLanguage();
  const isZh = lang === "zh";

  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/copilot/alert-feed?lang=${lang}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
        return d as FeedResponse;
      })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "Request failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [lang]);

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className={`${CARD} px-5 py-4`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-400">
              {isZh ? "自动告警" : "Auto Alert Feed"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">
              {isZh ? "每日告警摘要" : "Daily Alert Digest"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {isZh
                ? "AI 自动汇总当前库存预警，生成今日行动清单。"
                : "AI auto-summarises current inventory alerts into today's action list."}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-40 transition-colors"
          >
            {loading ? (isZh ? "刷新中…" : "Refreshing…") : (isZh ? "🔄 刷新" : "🔄 Refresh")}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className={`${CARD} p-8 text-center`}>
          <p className="animate-pulse text-slate-400">
            {isZh ? "AI 正在分析今日库存告警…" : "AI is analysing today's inventory alerts…"}
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className={`${CARD} p-6 text-center text-red-400`}>
          {isZh ? `加载失败：${error}` : `Failed: ${error}`}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Counts row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: "oos", label: isZh ? "缺货" : "Out of Stock", color: "red" as const },
              { key: "low", label: isZh ? "低库存" : "Low Stock", color: "amber" as const },
              { key: "high", label: isZh ? "高库存" : "High Stock", color: "violet" as const },
            ].map(({ key, label, color }) => {
              const c = COLOR_MAP[color];
              const count = data.counts[key as keyof typeof data.counts] as number;
              return (
                <div key={key} className={`rounded-2xl border p-4 ${c.card}`}>
                  <p className="text-xs text-slate-400">{c.icon} {label}</p>
                  <p className={`mt-1 text-3xl font-bold ${c.count}`}>{count}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{isZh ? "个 SKU" : "SKUs"}</p>
                </div>
              );
            })}
          </div>

          {/* AI Digest */}
          <div className={`${CARD} p-4 space-y-3`}>
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5">🤖</span>
              <div>
                <p className="text-xs text-slate-400 mb-1">
                  {isZh ? "AI 摘要" : "AI Digest"}
                  {data.model && <span className="ml-2 text-slate-600">· {data.model}</span>}
                </p>
                <p className="text-sm text-slate-200 leading-relaxed">{data.digest}</p>
              </div>
            </div>

            {data.critical_actions.length > 0 && (
              <div className="border-t border-slate-700 pt-3">
                <p className="text-xs font-semibold text-amber-300 mb-2">
                  {isZh ? "⚡ 今日优先行动" : "⚡ Priority Actions Today"}
                </p>
                <ol className="space-y-1.5">
                  {data.critical_actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                      <span className="flex-shrink-0 h-5 w-5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      {action}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* Alert groups */}
          {data.alert_groups.map(group => {
            const c = COLOR_MAP[group.color];
            return (
              <div key={group.type} className={`${CARD} p-4 space-y-3`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                  <p className="text-sm font-semibold text-slate-100">{group.label}</p>
                  <span className={`ml-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${c.badge}`}>
                    {group.count} {isZh ? "个 SKU" : "SKUs"}
                  </span>
                  {group.count > group.items.length && (
                    <span className="text-[10px] text-slate-500">
                      {isZh ? `（显示前 ${group.items.length} 个）` : `(showing top ${group.items.length})`}
                    </span>
                  )}
                </div>

                {group.items.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400">
                          <th className="text-left py-1.5 pr-4 font-medium">SKU</th>
                          <th className="text-right py-1.5 pr-4 font-medium">{isZh ? "库存" : "Stock"}</th>
                          {group.type !== "high" && (
                            <th className="text-right py-1.5 pr-4 font-medium">{isZh ? "建议补货量" : "Replenish"}</th>
                          )}
                          <th className="text-left py-1.5 font-medium">{isZh ? "建议操作" : "Action"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {group.items.map(item => (
                          <tr key={item.sku} className="hover:bg-slate-800/30">
                            <td className="py-1.5 pr-4 font-mono font-semibold text-slate-100">{item.sku}</td>
                            <td className="py-1.5 pr-4 text-right text-slate-300">
                              {item.stock.toLocaleString()}
                            </td>
                            {group.type !== "high" && (
                              <td className="py-1.5 pr-4 text-right">
                                {item.replenish_qty != null ? (
                                  <span className="text-cyan-300 font-semibold">+{item.replenish_qty.toLocaleString()}</span>
                                ) : "—"}
                              </td>
                            )}
                            <td className="py-1.5 text-slate-400">{item.action || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {data.alert_groups.length === 0 && (
            <div className={`${CARD} p-8 text-center`}>
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm text-slate-400">
                {isZh ? "今日暂无库存告警，库存状态健康。" : "No alerts today — inventory looks healthy!"}
              </p>
            </div>
          )}

          <p className="text-[10px] text-slate-600 text-right px-1">
            {isZh ? "生成于" : "Generated"} {new Date(data.generated_at).toLocaleString("zh-CN")}
          </p>
        </>
      )}
    </div>
  );
}
