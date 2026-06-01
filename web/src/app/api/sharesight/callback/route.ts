import { NextRequest, NextResponse } from "next/server";
import { seedTokensFromEnv } from "@/lib/sharesight";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://api.sharesight.com/oauth2/token";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

/**
 * GET /api/sharesight/callback?code=...
 * Sharesight redirects here after the user authorises.
 * Exchanges the code for tokens and persists them to disk.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json({ error, description: searchParams.get("error_description") }, { status: 400 });
  }

  if (!code) {
    // No code — show the auth link instead
    const clientId = process.env.SHARESIGHT_CLIENT_ID;
    if (!clientId) return NextResponse.json({ error: "SHARESIGHT_CLIENT_ID not set" }, { status: 500 });
    const authUrl = `https://api.sharesight.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:2rem;background:#09090b;color:#e4e4e7">
        <h2>Sharesight Re-authorisation</h2>
        <p>Click the button below to authorise Stock Picker to access your Sharesight portfolios.</p>
        <a href="${authUrl}" style="display:inline-block;padding:0.75rem 1.5rem;background:#3f3f46;color:#fff;border-radius:6px;text-decoration:none;font-size:1rem">Authorise Sharesight →</a>
        <p style="color:#71717a;font-size:0.875rem;margin-top:1.5rem">You'll be redirected back here automatically after authorising.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Exchange code for tokens
  const clientId = process.env.SHARESIGHT_CLIENT_ID;
  const clientSecret = process.env.SHARESIGHT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Client credentials not configured" }, { status: 500 });
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json();

  if (!data.access_token) {
    return NextResponse.json({ error: "Token exchange failed", detail: data }, { status: 500 });
  }

  seedTokensFromEnv(data.access_token, data.refresh_token, data.expires_in ?? 1800);

  return new NextResponse(
    `<html><body style="font-family:sans-serif;padding:2rem;background:#09090b;color:#e4e4e7">
      <h2 style="color:#34d399">✓ Sharesight authorised</h2>
      <p>Tokens saved. You can now close this tab and sync your portfolios.</p>
      <a href="/portfolio" style="display:inline-block;padding:0.75rem 1.5rem;background:#3f3f46;color:#fff;border-radius:6px;text-decoration:none;font-size:1rem">← Back to Portfolio</a>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
