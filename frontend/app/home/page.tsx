import { redirect } from "next/navigation";

import HomeDashboard from "@/components/home/HomeDashboard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { error: profileError } = await supabase.from("user_profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      name:
        (user.user_metadata?.name as string | undefined) ||
        (user.user_metadata?.full_name as string | undefined) ||
        null,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.warn("[home] profile upsert failed:", profileError.message);
  }

  const displayName =
    (user.user_metadata?.name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    "";

  return <HomeDashboard displayName={displayName} />;
}
