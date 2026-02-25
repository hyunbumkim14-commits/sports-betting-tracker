"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user?.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSessionEmail(s?.user?.email ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendLink() {
    const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: "http://localhost:3000/auth/callback",
  },
});
    if (error) alert(error.message);
    else alert("Check your email for the login link.");
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 520 }}>
      <h1>Login</h1>

      {sessionEmail ? (
        <>
          <p>
            ✅ Logged in as <b>{sessionEmail}</b>
          </p>
          <p>
            Next: go to <a href="/new">/new</a> to add a bet, or <a href="/">/</a> for dashboard.
          </p>
          <button onClick={logout} style={{ marginTop: 12, padding: 10 }}>
            Logout
          </button>
        </>
      ) : (
        <>
          <p>Enter your email and we’ll send you a magic link.</p>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
            autoCapitalize="none"
          />
          <button onClick={sendLink} style={{ marginTop: 12, padding: 10, width: "100%" }}>
            Send login link
          </button>
        </>
      )}
    </div>
  );
}