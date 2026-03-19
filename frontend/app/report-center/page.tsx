import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import ReportCenterDashboard from "@/components/report-center/ReportCenterDashboard";

export const dynamic = "force-dynamic";

export default async function ReportCenterPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const displayName =
    (user.user_metadata?.name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    "";

  return <ReportCenterDashboard displayName={displayName} />;
}
