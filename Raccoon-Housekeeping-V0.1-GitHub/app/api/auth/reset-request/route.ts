import { NextResponse } from "next/server";

export const runtime = "nodejs";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RACCOTEL_RESET_FROM_EMAIL?.trim();
  const to = process.env.RACCOTEL_ADMIN_REQUEST_EMAIL?.trim();
  if (!apiKey || !from || !to) {
    return NextResponse.json({ notified: false }, { status: 200 });
  }

  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !email.includes("@")) {
    return NextResponse.json({ notified: false }, { status: 400 });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Demande de réinitialisation Raccotel",
      html: `<p>Une demande de réinitialisation du mot de passe a été effectuée pour le compte <strong>${escapeHtml(email)}</strong>.</p><p>L’utilisateur a reçu un lien sécurisé lui permettant de choisir lui-même son nouveau mot de passe. Aucun mot de passe n’est visible par l’administrateur.</p>`,
    }),
  });

  return NextResponse.json({ notified: response.ok }, { status: response.ok ? 200 : 502 });
}
