import {
  createServerClient,
} from "@supabase/ssr";
import {
  createHmac,
  randomBytes,
} from "node:crypto";
import {
  cookies,
} from "next/headers";
import {
  NextResponse,
} from "next/server";


export const dynamic =
  "force-dynamic";


export async function POST() {
  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const viewerTokenSecret =
    process.env
      .BROWSER_VIEWER_TOKEN_SECRET
      ?.trim();

  if (
    !supabaseUrl ||
    !publishableKey
  ) {
    return NextResponse.json(
      {
        message:
          "Authentication is not configured.",
      },
      {
        status:
          503,
      },
    );
  }

  if (!viewerTokenSecret) {
    return NextResponse.json(
      {
        message:
          "Secure browser viewer is not configured.",
      },
      {
        status:
          503,
      },
    );
  }

  const cookieStore =
    await cookies();

  const supabase =
    createServerClient(
      supabaseUrl,
      publishableKey,
      {
        cookies: {
          getAll() {
            return cookieStore
              .getAll();
          },

          setAll() {
            /*
             * Token issuance does not need
             * to mutate auth cookies.
             */
          },
        },
      },
    );

  const {
    data:
      claimsData,
  } =
    await supabase.auth
      .getClaims();

  if (
    !claimsData?.claims
  ) {
    return NextResponse.json(
      {
        message:
          "Authentication is required.",
      },
      {
        status:
          401,
      },
    );
  }

  /*
   * noVNC reuses this token for automatic
   * reconnects. Keep it valid for a workday
   * so a brief network interruption does not
   * leave the viewer stuck on an undefined
   * disconnect error.
   */
  const ttlSeconds =
    24 * 60 * 60;

  const expiresAtSeconds =
    Math.floor(
      Date.now() / 1000,
    )
    +
    ttlSeconds;

  const nonce =
    randomBytes(18)
      .toString(
        "base64url",
      );

  const payload =
    `${expiresAtSeconds}.${nonce}`;

  const signature =
    createHmac(
      "sha256",
      viewerTokenSecret,
    )
      .update(payload)
      .digest(
        "base64url",
      );

  const token =
    `${payload}.${signature}`;

  return NextResponse.json(
    {
      token,
      expiresAt:
        new Date(
          expiresAtSeconds *
            1000,
        ).toISOString(),
    },
    {
      headers: {
        "Cache-Control":
          "no-store, private",
      },
    },
  );
}
