import DataCenterContent from "@/components/dashboard/DataCenterContent";
import { getSupabaseDashboardUrl } from "@/lib/config/appConfig";

export default function DataCenterPage() {
  const supabaseDashboardUrl = getSupabaseDashboardUrl();

  return <DataCenterContent supabaseDashboardUrl={supabaseDashboardUrl} />;
}
