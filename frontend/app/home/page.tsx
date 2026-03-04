import { redirect } from "next/navigation";

import HomeDashboard from "@/components/home/HomeDashboard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/auth");
  }

  const { error: profileError } = await supabase.from("user_profiles").upsert(
    {
      id: session.user.id,
      email: session.user.email ?? null,
      name:
        (session.user.user_metadata?.name as string | undefined) ||
        (session.user.user_metadata?.full_name as string | undefined) ||
        null,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.warn("[home] profile upsert failed:", profileError.message);
  }

  const displayName =
    (session.user.user_metadata?.name as string | undefined) ||
    (session.user.user_metadata?.full_name as string | undefined) ||
    "";

  return <HomeDashboard displayName={displayName} />;
}
