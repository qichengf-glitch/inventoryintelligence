import { getSupabaseRuntimePublicEnv } from "@/lib/supabase/env";

function serializePublicEnv(value: ReturnType<typeof getSupabaseRuntimePublicEnv>) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default function PublicEnvScript() {
  const publicEnv = getSupabaseRuntimePublicEnv();

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__PUBLIC_ENV__ = ${serializePublicEnv(publicEnv)};`,
      }}
    />
  );
}
