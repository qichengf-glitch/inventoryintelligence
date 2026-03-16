import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

function isAnonymousPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

function withCopiedCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value);
  });
  return target;
}

export async function middleware(request: NextRequest) {
  // Intercept stale Server Action requests from old deployments.
  // Since this app has no server actions, any Next-Action POST is from
  // a client running stale JS. Redirect (303) to force a fresh page load.
  if (request.method === "POST" && request.headers.get("next-action")) {
    const refreshUrl = request.nextUrl.clone();
    return NextResponse.redirect(refreshUrl, { status: 303 });
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { url, anonKey } = getSupabasePublicEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = isAnonymousPath(pathname);

  if (!isPublic && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    return withCopiedCookies(response, NextResponse.redirect(url));
  }

  if ((pathname === "/auth" || pathname === "/auth/") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return withCopiedCookies(response, NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: "/:path*",
};
