import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // ✨ NEW: Forward any extra parameters (like resume=true) to the final URL
      const redirectUrl = new URL(`${origin}${next}`);
      
      searchParams.forEach((value, key) => {
        // Don't forward the auth code or next param to the client URL
        if (key !== 'code' && key !== 'next') {
          redirectUrl.searchParams.set(key, value);
        }
      });

      return NextResponse.redirect(redirectUrl.toString());
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}