import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

function buildAuthRedirect(requestUrl: URL, params?: Record<string, string>) {
  const authUrl = new URL("/auth", requestUrl.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      authUrl.searchParams.set(key, value);
    });
  }
  return authUrl;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const error = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      buildAuthRedirect(requestUrl, {
        error,
        ...(errorDescription ? { error_description: errorDescription } : {}),
      })
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildAuthRedirect(requestUrl, {
        error: "missing_code",
        error_description: "No code returned from email confirmation link.",
      })
    );
  }

  const cookieStore = cookies();
  const { url, anonKey } = getSupabasePublicEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      buildAuthRedirect(requestUrl, {
        error: "exchange_failed",
        error_description: exchangeError.message,
      })
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { error: profileError } = await supabase.from("user_profiles").upsert(
      {
        id: user.id,
        email: user.email ?? null,
        name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.warn("[auth/callback] profile upsert failed:", profileError.message);
    }
  }

  return NextResponse.redirect(new URL("/home", requestUrl.origin));
}
