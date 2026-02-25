import type { DashboardKpi } from "@/lib/dashboard/getDashboardSummary";

type KpiCardProps = {
  item: DashboardKpi;
};

function formatDelta(delta: number, type: DashboardKpi["deltaType"]) {
  if (type === "number") {
    const rounded = Math.round(delta);
    return `${rounded >= 0 ? "+" : ""}${rounded}`;
  }
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

export default function KpiCard({ item }: KpiCardProps) {
  const showDelta = typeof item.delta === "number" && Number.isFinite(item.delta);
  const deltaPositive = (item.delta || 0) >= 0;

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-[0_10px_25px_rgba(2,6,23,0.35)]">
      <p className="text-xs uppercase tracking-[0.1em] text-slate-400">{item.title}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold text-slate-100">
          {Math.round(item.value).toLocaleString()}
        </p>
        {showDelta && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              deltaPositive
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-rose-500/15 text-rose-300"
            }`}
          >
            {formatDelta(item.delta as number, item.deltaType)}
          </span>
        )}
      </div>
      {item.subtext && <p className="mt-2 text-xs text-slate-400">{item.subtext}</p>}
    </article>
  );
}
