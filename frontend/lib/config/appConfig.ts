function deriveSupabaseDashboardUrl(supabaseUrl: string | undefined) {
  if (!supabaseUrl) return null;

  try {
    const parsed = new URL(supabaseUrl);
    const projectRef = parsed.hostname.split(".")[0];
    if (!projectRef) return null;
    return `https://supabase.com/dashboard/project/${projectRef}`;
  } catch {
    return null;
  }
}

export function getSupabaseDashboardUrl() {
  const fromEnv =
    process.env.NEXT_PUBLIC_SUPABASE_DASHBOARD_URL ||
    process.env.SUPABASE_DASHBOARD_URL;

  if (fromEnv) return fromEnv;

  return deriveSupabaseDashboardUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  );
}
