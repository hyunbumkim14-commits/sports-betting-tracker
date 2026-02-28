"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // If Supabase puts tokens in the URL hash, the client library will pick them up.
    // We just wait for session to exist, then route home.
    let alive = true;

    async function finalize() {
      await supabase.auth.getSession();
      if (!alive) return;
      router.replace("/");
    }

    finalize();

    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm font-bold text-zinc-600">
          Signing you in…
        </div>
      </div>
    </div>
  );
}