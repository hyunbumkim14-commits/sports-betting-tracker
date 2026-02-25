"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, setAuthStorageMode } from "../../lib/supabase";

type Mode = "signin" | "signup" | "forgot";

function origin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [remember, setRemember] = useState(true);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // If already logged in, go to dashboard
  useEffect(() => {
    let alive = true;

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) router.replace("/");
    }

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/");
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  const canSubmit = useMemo(() => {
    const e = email.trim();
    if (!e) return false;
    if (mode === "forgot") return true;
    return e && password.length >= 6;
  }, [email, password, mode]);

  async function handleSubmit() {
    setErr(null);
    setMsg(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setErr("Please enter an email address.");
      return;
    }

    // Set storage mode BEFORE signing in (controls local vs session storage)
    setAuthStorageMode(remember);

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (error) throw error;

        router.replace("/");
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: trimmed,
          password,
          // If you require email verification, Supabase will email them.
        });
        if (error) throw error;

        setMsg(
          "Account created. If email confirmation is enabled in Supabase, check your inbox to verify before logging in."
        );
        // You can optionally switch them back to sign-in:
        setMode("signin");
        return;
      }

      if (mode === "forgot") {
        const redirectTo = `${origin()}/reset-password`;

        const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
          redirectTo,
        });
        if (error) throw error;

        setMsg(`Password reset link sent to ${trimmed}. Check inbox/spam.`);
        return;
      }
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
      <h1 style={{ marginTop: 0 }}>Account</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setMode("signin")}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: mode === "signin" ? "#f2f2f2" : "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Sign in
        </button>
        <button
          onClick={() => setMode("signup")}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: mode === "signup" ? "#f2f2f2" : "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Sign up
        </button>
        <button
          onClick={() => setMode("forgot")}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: mode === "forgot" ? "#f2f2f2" : "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Forgot password
        </button>
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Email</span>
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
      </label>

      {mode !== "forgot" && (
        <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Password</span>
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
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Minimum 6 characters.
          </span>
        </label>
      )}

      <label
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 12,
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span style={{ fontSize: 14 }}>Keep me signed in</span>
      </label>

      <button
        onClick={handleSubmit}
        disabled={busy || !canSubmit}
        style={{
          marginTop: 14,
          padding: 10,
          width: "100%",
          borderRadius: 8,
          border: "1px solid #ddd",
          background: busy || !canSubmit ? "#f5f5f5" : "white",
          cursor: busy || !canSubmit ? "not-allowed" : "pointer",
          fontWeight: 800,
        }}
      >
        {busy
          ? "Working…"
          : mode === "signin"
          ? "Sign in"
          : mode === "signup"
          ? "Create account"
          : "Send reset link"}
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

      <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7, lineHeight: 1.4 }}>
        After login you’ll be sent to the dashboard.
      </div>
    </div>
  );
}