import { NextResponse } from "next/server";
import { getFirebaseAuth } from "@/lib/firebase/admin";

/**
 * Landing point for Firebase's emailed action links.
 *
 * Firebase verifies the code on its own action page and then forwards here with
 * `mode` and `oobCode` intact, so this route's job is routing rather than
 * verification — the code is exchanged on the reset page, where the new
 * password is available in the same request.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const locale = searchParams.get("locale") ?? "en";
  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=oauth`);
  }

  if (mode === "resetPassword" && oobCode) {
    const target = new URL(`${origin}/${locale}/reset-password`);
    target.searchParams.set("oobCode", oobCode);
    return NextResponse.redirect(target);
  }

  if (mode === "verifyEmail" && oobCode) {
    // Firebase verified the code; the Admin SDK recorded the verification on
    // its side already for the default handler, so only our own copy of the
    // flag is at stake. A failure here must not block the sign-in.
    try {
      const auth = await getFirebaseAuth();
      const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
      if (auth && apiKey) {
        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oobCode }),
            signal: AbortSignal.timeout(10_000),
          },
        ).catch(() => null);
        const body = (await response?.json().catch(() => null)) as
          | { localId?: string }
          | null;
        if (body?.localId) {
          await auth.updateUser(body.localId, { emailVerified: true });
        }
      }
    } catch {
      // Intentionally ignored: the email is verified on Firebase's side, and
      // this only mirrors the flag.
    }
    return NextResponse.redirect(`${origin}/${locale}/login?verified=1`);
  }

  return NextResponse.redirect(`${origin}/${locale}/login`);
}
