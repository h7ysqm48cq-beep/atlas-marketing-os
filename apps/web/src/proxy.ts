import {
  createServerClient,
} from "@supabase/ssr";
import {
  NextResponse,
  type NextRequest,
} from "next/server";

const publicRoutes = [
  "/login",
  "/auth",
  "/manifest.webmanifest",
];

function isPublicRoute(
  pathname: string,
) {
  return publicRoutes.some(
    (route) =>
      pathname === route ||
      pathname.startsWith(
        `${route}/`,
      ),
  );
}

export async function proxy(
  request: NextRequest,
) {
  let response =
    NextResponse.next({
      request,
    });

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase =
    createServerClient(
      url,
      publishableKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },

          setAll(cookiesToSet) {
            cookiesToSet.forEach(
              ({ name, value }) => {
                request.cookies.set(
                  name,
                  value,
                );
              },
            );

            response =
              NextResponse.next({
                request,
              });

            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                response.cookies.set(
                  name,
                  value,
                  options,
                );
              },
            );
          },
        },
      },
    );

  const {
    data: claimsData,
  } = await supabase.auth.getClaims();

  const claims =
    claimsData?.claims ?? null;

  const pathname =
    request.nextUrl.pathname;

  if (
    !claims &&
    !isPublicRoute(pathname)
  ) {
    const loginUrl =
      request.nextUrl.clone();

    loginUrl.pathname = "/login";
    loginUrl.searchParams.set(
      "next",
      `${pathname}${request.nextUrl.search}`,
    );

    return NextResponse.redirect(
      loginUrl,
    );
  }

  if (
    claims &&
    pathname === "/login"
  ) {
    const destination =
      request.nextUrl.searchParams.get(
        "next",
      ) || "/";

    return NextResponse.redirect(
      new URL(
        destination,
        request.url,
      ),
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
