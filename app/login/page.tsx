"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      const currentEmail = data.session?.user?.email ?? null;
      setSessionEmail(currentEmail);

      // If already logged in, send them to dashboard
      if (data.session) router.replace("/");
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const e = s?.user?.email ?? null;
      setSessionEmail(e);

      if (s) router.replace("/");
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  async function sendLink() {
    setErrorMsg(null);
    setSentTo(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMsg("Please enter an email address.");
      return;
    }

    setSending(true);

    // ✅ Works on localhost AND on Vercel:
    // - On Vercel: https://sports-betting-tracker-iota.vercel.app
    // - On localhost: http://localhost:3000
    const redirectTo =
      (process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        (typeof window !== "undefined" ? window.location.origin : "")) +
      "/auth/callback";

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    setSending(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setSentTo(trimmed);
  }

  async function logout() {
    setErrorMsg(null);
    await supabase.auth.signOut();
    setSessionEmail(null);
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Login</h1>

      {sessionEmail ? (
        <>
          <p>
            ✅ Logged in as <b>{sessionEmail}</b>
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => router.push("/")}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              Go to Dashboard
            </button>

            <button
              onClick={() => router.push("/new")}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              + New Bet
            </button>

            <button
              onClick={logout}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              Log out
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 8 }}>
            Enter your email and we’ll send you a magic link.
          </p>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
          />

          <button
            onClick={sendLink}
            disabled={sending}
            style={{
              marginTop: 12,
              padding: 10,
              width: "100%",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: sending ? "#f5f5f5" : "white",
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {sending ? "Sending…" : sentTo ? "Resend login link" : "Send login link"}
          </button>

          {sentTo && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
              ✅ Sent a login link to <b>{sentTo}</b>. Check your inbox (and spam).
            </div>
          )}

          {errorMsg && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid #ffd6d6", borderRadius: 10 }}>
              <b>Error:</b> {errorMsg}
            </div>
          )}
        </>
      )}
    </div>
  );
}