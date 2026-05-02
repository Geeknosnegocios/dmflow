import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = [
  "/",
  "/auth/login",
  "/auth/signup",
  "/auth/callback",
  "/privacy",
  "/terms",
];

const PUBLIC_API_PREFIXES = [
  "/api/webhook/instagram",
  "/api/cron/",
  "/r/",
  "/auth/instagram/",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isPublic =
    PUBLIC_ROUTES.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname.includes(".");

  const isAuthPage = pathname.startsWith("/auth");
  const requiresAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/onboarding");

  // Redirect unauthenticated users trying to access protected routes
  if (requiresAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Redirect logged-in users away from auth pages
  if (isAuthPage && user && !pathname.startsWith("/auth/callback") && !pathname.startsWith("/auth/logout") && !pathname.startsWith("/auth/instagram")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\..*).*)",
  ],
};
