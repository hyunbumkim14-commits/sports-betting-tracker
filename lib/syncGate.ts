// Decides whether to show the Polymarket "Sync now" controls. Only the sync owner should ever
// see them, but a temporary server hiccup must never hide them from the owner for good.

export const OK_KEY = "pm_sync_ok"; // localStorage: id of the user the server confirmed as owner
export const OFF_KEY = "pm_sync_off_until"; // sessionStorage: stop auto-asking until this time
export const PAUSE_NOT_OWNER_MS = 30 * 60_000;
export const PAUSE_NOT_CONFIGURED_MS = 3 * 60_000;

type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SyncOutcome = "owner" | "not-owner" | "not-configured" | "signed-out" | "unknown";

// 403 = signed in but not the owner. 501 = server isn't configured. 401 = bad/expired token.
// Success, or a failure from our own route after the owner check (500/502/504), means the
// server accepted this user as the owner. Anything else (404, network errors) tells us nothing.
export function classifySyncStatus(status: number): SyncOutcome {
  if (status === 403) return "not-owner";
  if (status === 501) return "not-configured";
  if (status === 401) return "signed-out";
  if ((status >= 200 && status < 300) || status === 500 || status === 502 || status === 504) return "owner";
  return "unknown";
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function isConfirmedOwner(local: Store | null, userId: string | null | undefined): boolean {
  if (!local || !userId) return false;
  return safe(() => local.getItem(OK_KEY) === userId, false);
}

export function isPaused(session: Store | null, now: number): boolean {
  if (!session) return false;
  const until = safe(() => Number(session.getItem(OFF_KEY)), 0);
  return Number.isFinite(until) && until > now;
}

export function recordSyncOutcome(
  outcome: SyncOutcome,
  userId: string | null | undefined,
  local: Store | null,
  session: Store | null,
  now: number
): void {
  if (outcome === "owner") {
    if (local && userId) safe(() => local.setItem(OK_KEY, userId), undefined);
    if (session) safe(() => session.removeItem(OFF_KEY), undefined);
  } else if (outcome === "not-owner") {
    if (local) safe(() => local.removeItem(OK_KEY), undefined);
    if (session) safe(() => session.setItem(OFF_KEY, String(now + PAUSE_NOT_OWNER_MS)), undefined);
  } else if (outcome === "not-configured") {
    // Keep any remembered ownership: the server may simply be mid-deploy or not set up yet.
    if (session) safe(() => session.setItem(OFF_KEY, String(now + PAUSE_NOT_CONFIGURED_MS)), undefined);
  }
}
