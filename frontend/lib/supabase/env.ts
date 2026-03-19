type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

type BrowserRuntimeEnv = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function trimEnvValue(value: string | undefined) {
  return value?.trim() || "";
}

function getBrowserRuntimeEnv(): BrowserRuntimeEnv {
  if (typeof window === "undefined") {
    return {};
  }

  const runtimeEnv = (window as typeof window & {
    __PUBLIC_ENV__?: BrowserRuntimeEnv;
  }).__PUBLIC_ENV__;

  return runtimeEnv ?? {};
}

export function readSupabasePublicEnv(): Partial<SupabasePublicEnv> {
  const runtimeEnv = getBrowserRuntimeEnv();
  const url =
    trimEnvValue(process.env.SUPABASE_URL) ||
    trimEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    trimEnvValue(runtimeEnv.supabaseUrl);
  const anonKey =
    trimEnvValue(process.env.SUPABASE_ANON_KEY) ||
    trimEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    trimEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    trimEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY) ||
    trimEnvValue(runtimeEnv.supabaseAnonKey);

  return {
    url: url || undefined,
    anonKey: anonKey || undefined,
  };
}

export function getSupabaseRuntimePublicEnv(): BrowserRuntimeEnv {
  const { url, anonKey } = readSupabasePublicEnv();

  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  };
}

export function getSupabasePublicEnv() {
  const { url, anonKey } = readSupabasePublicEnv();

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase URL or anon key. Set SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }

  return { url, anonKey };
}
