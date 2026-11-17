import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createPolymarketClient,
  mapPositionToTicket,
  planExistingUpdate,
  readPolymarketCreds,
  scrubSecrets,
  slimActivity,
  slimMarket,
  slimPosition,
  type MappedTicket,
  type PMActivity,
  type PMMarket,
  type PMPosition,
} from "../../../../lib/polymarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_DAYS = 60;
const THROTTLE_MS = 30_000;
const CONCURRENCY = 4;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type ExistingTicket = {
  id: string;
  external_id: string;
  status: string;
  needs_review: boolean | null;
  kalshi_shares: number | null;
};

export async function POST(req: Request) {
  const creds = readPolymarketCreds();
  const ownerId = process.env.POLYMARKET_OWNER_USER_ID?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!creds || !ownerId || !supabaseUrl || !supabaseAnon) {
    return json({ error: "Polymarket sync is not configured on the server." }, 501);
  }

  const authz = req.headers.get("authorization") ?? "";
  const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  if (!token) return json({ error: "Not signed in." }, 401);

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return json({ error: "Not signed in." }, 401);
  if (user.id !== ownerId) return json({ error: "Not allowed." }, 403);

  const url = new URL(req.url);
  const writes = url.searchParams.get("dryRun") !== "1" && process.env.POLYMARKET_WRITES_ENABLED === "true";
  const mode = writes ? "write" : "dry-run";

  // Optional: only import bets placed on/after this date, so history you already typed in by
  // hand isn't imported a second time.
  const sinceRaw = process.env.POLYMARKET_IMPORT_SINCE?.trim();
  const importSinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
  const hasImportSince = Number.isFinite(importSinceMs);

  if (writes) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("polymarket_last_sync")
      .eq("id", user.id)
      .maybeSingle();
    const last = prof?.polymarket_last_sync ? Date.parse(prof.polymarket_last_sync) : 0;
    if (Date.now() - last < THROTTLE_MS) {
      return json({ mode, skipped: "throttled", syncedAt: prof?.polymarket_last_sync ?? null });
    }
  }

  const errors: string[] = [];
  let migrationPending = false;

  const existingRes = await supabase
    .from("tickets")
    .select("id, external_id, status, needs_review, kalshi_shares")
    .eq("external_source", "polymarket");
  let existing: ExistingTicket[] = [];
  if (existingRes.error) {
    if (writes) {
      return json({ error: "Database migration has not been run yet (external_* columns missing)." }, 500);
    }
    migrationPending = true;
  } else {
    existing = (existingRes.data ?? []) as ExistingTicket[];
  }
  const existingById = new Map(existing.map((t) => [t.external_id, t]));

  const client = createPolymarketClient(creds);
  let positions: Record<string, PMPosition>;
  let activitiesBySlug: Map<string, PMActivity[]>;
  try {
    positions = await client.positions();
    activitiesBySlug = await client.activitiesBySlug(Date.now() - WINDOW_DAYS * 86_400_000);
  } catch (e) {
    const msg = scrubSecrets(e instanceof Error ? e.message : "Unknown error", creds);
    return json({ mode, error: `Could not read Polymarket: ${msg}` }, 502);
  }

  const settledAlready = new Set(existing.filter((t) => t.status !== "open").map((t) => t.external_id));
  const slugs = [...new Set([...Object.keys(positions), ...activitiesBySlug.keys()])].filter(
    (s) => !settledAlready.has(s)
  );

  type Mapped = { ticket: MappedTicket; market: PMMarket | null } | { skip: string; slug: string };

  const results = await mapLimit(slugs, CONCURRENCY, async (slug): Promise<Mapped | null> => {
    try {
      // Combo (parlay) instruments aren't public markets; their legs travel with the position.
      const market = slug.startsWith("crossd-") ? null : await client.market(slug);
      const mapped = mapPositionToTicket({
        slug,
        position: positions[slug],
        activities: activitiesBySlug.get(slug) ?? [],
        market,
      });
      return mapped.ticket ? { ticket: mapped.ticket, market } : { skip: mapped.skip, slug };
    } catch (e) {
      errors.push(`${slug}: ${scrubSecrets(e instanceof Error ? e.message : "Unknown error", creds)}`);
      return null;
    }
  });

  const counts = {
    created: 0,
    updated: 0,
    settled: 0,
    flagged: 0,
    unchanged: 0,
    skippedNonSports: 0,
    skippedClosedEarly: 0,
    skippedNoData: 0,
    skippedBeforeImportDate: 0,
  };
  const skippedClosedEarly: string[] = [];
  // Markets that had trades but couldn't become a ticket (e.g. bought then sold before the game
  // ended, so no position remains). Named so nothing disappears silently.
  const notImported: { slug: string; reason: string; firstTradeAt: string | null; trades: number }[] = [];
  const planned: { action: string; ticket: MappedTicket }[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const sampleSlugs: { slug: string; kind: string }[] = [];
  const sampleKinds = new Set<string>();

  for (const r of results) {
    if (!r) continue;
    if ("skip" in r) {
      if (r.skip === "non-sports") {
        counts.skippedNonSports++;
        continue;
      }
      const trades = (activitiesBySlug.get(r.slug) ?? []).filter((a) => a.trade);
      const tradeTimes = trades
        .map((a) => Date.parse(a.trade?.createTime ?? ""))
        .filter((t) => Number.isFinite(t));
      const firstMs = tradeTimes.length ? Math.min(...tradeTimes) : NaN;
      if (hasImportSince && Number.isFinite(firstMs) && firstMs < importSinceMs) {
        counts.skippedBeforeImportDate++;
        continue;
      }
      if (r.skip === "closed-early") {
        counts.skippedClosedEarly++;
        skippedClosedEarly.push(r.slug);
      } else {
        counts.skippedNoData++;
      }
      notImported.push({
        slug: r.slug,
        reason:
          r.skip === "closed-early"
            ? "position closed before the game ended"
            : trades.length
              ? "has trades but no open position or result (likely sold before the game ended)"
              : "no trades or position found",
        firstTradeAt: Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null,
        trades: trades.length,
      });
      continue;
    }

    const t = r.ticket;
    const prior = existingById.get(t.external_id);

    if (hasImportSince && !prior && Date.parse(t.placed_at) < importSinceMs) {
      counts.skippedBeforeImportDate++;
      continue;
    }

    const kind = t.external_id.startsWith("crossd-")
      ? "combo"
      : t.status !== "open"
        ? "settled"
        : t.kalshi_side === "no"
          ? "open-no"
          : "open-yes";
    if (!sampleKinds.has(kind)) {
      sampleKinds.add(kind);
      sampleSlugs.push({ slug: t.external_id, kind });
    }

    if (!prior) {
      planned.push({ action: "create", ticket: t });
      counts.created++;
      if (t.needs_review) counts.flagged++;
      inserts.push({
        user_id: user.id,
        ...t,
        needs_review: true,
        review_reason: t.review_reason ?? "New from Polymarket - confirm the numbers",
      });
      continue;
    }

    const plan = planExistingUpdate(prior, t);
    if (plan.action === "unchanged") {
      counts.unchanged++;
      continue;
    }
    if (plan.flagged) counts.flagged++;
    planned.push({ action: plan.action, ticket: t });
    if (plan.action === "settle") counts.settled++;
    else counts.updated++;
    updates.push({ id: prior.id, patch: plan.patch });
  }

  const syncedAt = new Date().toISOString();

  if (!writes) {
    // A compact, redacted look at one of each kind of bet, so the numbers can be checked
    // against the Polymarket app without sending pages of raw data.
    const rawSample = sampleSlugs.slice(0, 5).map(({ slug, kind }) => {
      const r = results.find((x) => x && "ticket" in x && x.ticket.external_id === slug);
      return {
        kind,
        slug,
        position: slimPosition(positions[slug]),
        activities: (activitiesBySlug.get(slug) ?? []).slice(0, 12).map(slimActivity),
        market: slimMarket(r && "ticket" in r ? r.market : null),
      };
    });
    return json({
      mode,
      syncedAt,
      migrationPending,
      importSince: hasImportSince ? new Date(importSinceMs).toISOString() : null,
      counts,
      skippedClosedEarly,
      notImported,
      planned,
      rawSample,
      errors,
    });
  }

  if (inserts.length) {
    const { error } = await supabase
      .from("tickets")
      .upsert(inserts, { onConflict: "user_id,external_source,external_id", ignoreDuplicates: true });
    if (error) errors.push(`save new tickets: ${scrubSecrets(error.message, creds)}`);
  }
  for (const u of updates) {
    const { error } = await supabase.from("tickets").update(u.patch).eq("id", u.id);
    if (error) errors.push(`update ${u.id}: ${scrubSecrets(error.message, creds)}`);
  }

  if (!errors.length) {
    await supabase.from("profiles").update({ polymarket_last_sync: syncedAt }).eq("id", user.id);
  }

  return json({ mode, syncedAt, counts, skippedClosedEarly, notImported, errors });
}
