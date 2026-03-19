import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

function isAnonymousPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/auth") ||
    pathname === "/api/version" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
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
    refreshUrl.searchParams.set("_reload", Date.now().toString());
    return NextResponse.redirect(refreshUrl, { status: 303 });
  }

  const { pathname } = request.nextUrl;
  const isPublic = isAnonymousPath(pathname);

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const setHtmlNoStore = () => {
    const accept = request.headers.get("accept") || "";
    if (request.method === "GET" && accept.includes("text/html")) {
      response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  };

  if (pathname === "/") {
    setHtmlNoStore();
    return response;
  }

  let user = null;

  try {
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
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    user = currentUser;
  } catch (error) {
    console.error("[middleware] auth lookup failed:", error);

    if (isPublic) {
      setHtmlNoStore();
      return response;
    }

    const authUrl = request.nextUrl.clone();
    authUrl.pathname = "/auth";
    return withCopiedCookies(response, NextResponse.redirect(authUrl));
  }

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

  setHtmlNoStore();
  return response;
}

export const config = {
  matcher: "/:path*",
};
