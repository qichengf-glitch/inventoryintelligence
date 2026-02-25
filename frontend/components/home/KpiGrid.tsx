import type { DashboardKpi } from "@/lib/dashboard/getDashboardSummary";

import KpiCard from "@/components/home/KpiCard";

type KpiGridProps = {
  items: DashboardKpi[];
};

export default function KpiGrid({ items }: KpiGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <KpiCard key={item.id} item={item} />
      ))}
    </div>
  );
}
