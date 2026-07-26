import {
  createServerClient,
} from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore =
    await cookies();

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase environment variables are missing.",
    );
  }

  return createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(
              ({
                name,
                value,
                options,
              }) => {
                cookieStore.set(
                  name,
                  value,
                  options,
                );
              },
            );
          } catch {
            // Server Components may not
            // be allowed to write cookies.
            // proxy.ts handles refresh.
          }
        },
      },
    },
  );
}
