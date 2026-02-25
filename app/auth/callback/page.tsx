"use client";

import { useEffect } from "react";
import { supabase } from "../../../lib/supabase";

export default function AuthCallback() {
  useEffect(() => {
    // This reads #access_token from the URL and stores the session
    supabase.auth.getSession().then(() => {
      // After session is stored, redirect to login (or home)
      window.location.replace("/login");
    });
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      Logging you in…
    </div>
  );
}