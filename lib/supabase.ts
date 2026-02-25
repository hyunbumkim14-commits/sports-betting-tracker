// web/lib/supbase.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Custom storage that supports:
 * - "Keep me signed in" => localStorage
 * - session-only login   => sessionStorage
 *
 * It reads from BOTH (so switching modes won’t break),
 * and writes to whichever mode is currently selected.
 */
const STORAGE_MODE_KEY = "sb_auth_storage_mode"; // "local" | "session"

function getMode(): "local" | "session" {
  if (typeof window === "undefined") return "local";
  const v = window.localStorage.getItem(STORAGE_MODE_KEY);
  return v === "session" ? "session" : "local";
}

export function setAuthStorageMode(remember: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_MODE_KEY, remember ? "local" : "session");
}

const storage = {
  getItem: (key: string) => {
    if (typeof window === "undefined") return null;
    // Prefer sessionStorage (in case user chose session-only), fallback to localStorage
    return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") return;
    const mode = getMode();
    if (mode === "session") {
      window.sessionStorage.setItem(key, value);
      // avoid stale copies
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
      window.sessionStorage.removeItem(key);
    }
  },
  removeItem: (key: string) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  },
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // needed for reset-password link handling
      storage,
    },
  }
);