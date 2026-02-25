"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function minPasswordOk(pw: string) {
  return pw.length >= 6;
}

export default function ResetPasswordPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // When user lands here from Supabase reset email, the session is in the URL.
  // detectSessionInUrl:true will pick it up, but Supabase can be "code" or hash based.
  // We’ll handle both safely.
  useEffect(() => {
    let alive = true;

    async function init() {
      setErr(null);
      setMsg(null);

      try {
        // If PKCE "code" exists, exchange it for a session.
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!alive) return;

        setHasSession(!!data.session);
        setReady(true);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Could not verify reset link.");
        setReady(true);
      }
    }

    init();

    return () => {
      alive = false;
    };
  }, []);

  async function updatePassword() {
    setErr(null);
    setMsg(null);

    if (!minPasswordOk(password)) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setMsg("Password updated. Sending you to the dashboard…");
      setTimeout(() => router.replace("/"), 700);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</div>;

  if (!hasSession) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
        <h1 style={{ marginTop: 0 }}>Reset password</h1>
        <div style={{ padding: 12, border: "1px solid #ffd6d6", borderRadius: 10 }}>
          <b>Error:</b> {err ?? "This reset link is invalid or expired."}
        </div>
        <div style={{ marginTop: 12 }}>
          Go back to <a href="/login">login</a> and request a new reset link.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Set a new password</h1>

      <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>New password</span>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="••••••••"
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        />
      </label>

      <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Confirm password</span>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          type="password"
          placeholder="••••••••"
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #ddd",
            borderRadius: 8,
          }}
        />
      </label>

      <button
        onClick={updatePassword}
        disabled={busy}
        style={{
          marginTop: 14,
          padding: 10,
          width: "100%",
          borderRadius: 8,
          border: "1px solid #ddd",
          background: busy ? "#f5f5f5" : "white",
          cursor: busy ? "not-allowed" : "pointer",
          fontWeight: 800,
        }}
      >
        {busy ? "Updating…" : "Update password"}
      </button>

      {msg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          ✅ {msg}
        </div>
      )}

      {err && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ffd6d6", borderRadius: 10 }}>
          <b>Error:</b> {err}
        </div>
      )}
    </div>
  );
}