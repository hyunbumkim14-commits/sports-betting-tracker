// Server-only: reads credentials from process.env and must never be imported by client components.
import { createPrivateKey, sign } from "node:crypto";

const API_BASE = "https://api.polymarket.us";
const GATEWAY_BASE = "https://gateway.polymarket.us";
// Wraps a raw 32-byte Ed25519 seed into a PKCS#8 DER private key that node:crypto accepts.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/* ------------------------------ types ------------------------------ */

type Amount = { value: string; currency?: string };

type PMTeam = { name?: string; league?: string } | null;

export type PMMarketMetadata = {
  slug?: string;
  title?: string;
  outcome?: string;
  eventSlug?: string;
  team?: PMTeam;
};

export type PMComboLeg = {
  slug?: string;
  title?: string;
  outcome?: string;
  state?: string;
  outcomeSide?: string;
  team?: PMTeam;
};

export type PMPosition = {
  netPositionDecimal?: string;
  netPosition?: string;
  qtyBoughtDecimal?: string;
  qtySoldDecimal?: string;
  cost?: Amount | null;
  fees?: Amount | null;
  baseCost?: Amount | null;
  costPerShare?: Amount | null;
  avgPx?: Amount | null;
  realized?: Amount | null;
  expired?: boolean;
  updateTime?: string | null;
  positionId?: string;
  marketMetadata?: PMMarketMetadata | null;
  comboLegDetails?: PMComboLeg[] | null;
};

export type PMTrade = {
  id: string;
  marketSlug: string;
  state: string;
  createTime?: string;
  price?: Amount;
  qtyDecimal?: string;
  cost?: Amount;
  isAggressor?: boolean;
  aggressorExecution?: {
    commissionNotionalCollected?: Amount;
    order?: { intent?: string; outcomeSide?: string; action?: string; side?: string };
  };
};

export type PMResolution = {
  marketSlug: string;
  beforePosition?: PMPosition | null;
  afterPosition?: PMPosition | null;
  updateTime?: string;
  side?: string;
};

export type PMActivity = {
  type: string;
  trade?: PMTrade;
  positionResolution?: PMResolution;
};

export type PMMarketSide = {
  description?: string;
  long?: boolean;
  team?: PMTeam;
};

export type PMMarket = {
  slug: string;
  category?: string;
  question?: string;
  title?: string;
  sportsMarketType?: string;
  line?: number;
  marketSides?: PMMarketSide[];
};

export type MappedTicket = {
  external_source: "polymarket";
  external_id: string;
  bet_source: "polymarket";
  ticket_type: "single";
  book: "Polymarket";
  market_title: string;
  league: string | null;
  kalshi_side: "yes" | "no";
  kalshi_price_cents: number | null;
  kalshi_shares: number;
  kalshi_fee: number;
  stake: number;
  kalshi_payout_if_correct: number;
  status: "open" | "won" | "lost" | "push";
  placed_at: string;
  settled_at: string | null;
  payout: number | null;
  profit: number | null;
  needs_review: boolean;
  review_reason: string | null;
};

export type MapResult =
  | { ticket: MappedTicket; skip?: undefined }
  | { ticket: null; skip: "non-sports" | "no-data" | "closed-early" };

/* ------------------------- credentials + signing ------------------------- */

export type PolymarketCreds = { keyId: string; secretKey: string };

export function readPolymarketCreds(): PolymarketCreds | null {
  const keyId = process.env.POLYMARKET_KEY_ID?.trim();
  const secretKey = process.env.POLYMARKET_SECRET_KEY?.trim();
  return keyId && secretKey ? { keyId, secretKey } : null;
}

export function buildAuthHeaders(
  creds: PolymarketCreds,
  method: string,
  pathname: string,
  nowMs: number = Date.now()
): Record<string, string> {
  const raw = Buffer.from(creds.secretKey, "base64");
  if (raw.length !== 32 && raw.length !== 64) {
    throw new Error("POLYMARKET_SECRET_KEY has an unexpected format");
  }
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  // Polymarket signs timestamp + METHOD + path only; the query string is not part of the message.
  const timestamp = String(nowMs);
  const signature = sign(null, Buffer.from(`${timestamp}${method}${pathname}`), key).toString("base64");
  return {
    "X-PM-Access-Key": creds.keyId,
    "X-PM-Timestamp": timestamp,
    "X-PM-Signature": signature,
  };
}

export function scrubSecrets(message: string, creds: PolymarketCreds | null): string {
  let out = message;
  if (creds) {
    for (const secret of [creds.secretKey, creds.keyId]) {
      if (secret) out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}

/* ------------------------------- client ------------------------------- */

export class PolymarketHttpError extends Error {
  status: number;
  constructor(status: number, pathname: string) {
    super(`Polymarket returned ${status} for ${pathname}`);
    this.status = status;
  }
}

type Query = Record<string, string | number | string[] | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TYPE_TRADE = "ACTIVITY_TYPE_TRADE";
const TYPE_RESOLUTION = "ACTIVITY_TYPE_POSITION_RESOLUTION";
const MAX_PAGES = 15;
// Requests from every caller share one pace so bursts can't trip Polymarket's per-IP rate limit.
const MIN_GAP_MS = 150;
const MAX_ATTEMPTS = 6;

const activityTime = (a: PMActivity): number => {
  const raw = a.trade?.createTime ?? a.positionResolution?.updateTime;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function createPolymarketClient(creds: PolymarketCreds) {
  let nextSlot = 0;
  async function pace() {
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    nextSlot = start + MIN_GAP_MS;
    if (start > now) await sleep(start - now);
  }

  async function request<T>(authed: boolean, path: string, query: Query = {}): Promise<T> {
    const url = new URL(path, authed ? API_BASE : GATEWAY_BASE);
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, String(v));
    }

    for (let attempt = 0; ; attempt++) {
      await pace();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (authed) Object.assign(headers, buildAuthHeaders(creds, "GET", url.pathname));

      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(500 * 2 ** attempt, 5000);
        nextSlot = Math.max(nextSlot, Date.now() + wait);
        continue;
      }
      if (!res.ok) throw new PolymarketHttpError(res.status, url.pathname);
      return (await res.json()) as T;
    }
  }

  async function positions(): Promise<Record<string, PMPosition>> {
    const all: Record<string, PMPosition> = {};
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await request<{
        positions?: Record<string, PMPosition>;
        nextCursor?: string;
        eof?: boolean;
      }>(true, "/v1/portfolio/positions", { limit: 100, cursor });
      Object.assign(all, res.positions ?? {});
      if (res.eof || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return all;
  }

  // One bulk pull of trades + resolutions (newest first) grouped by market, instead of one
  // request per market, which is what tripped the rate limit.
  async function activitiesBySlug(sinceMs: number): Promise<Map<string, PMActivity[]>> {
    const out = new Map<string, PMActivity[]>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await request<{ activities?: PMActivity[]; nextCursor?: string; eof?: boolean }>(
        true,
        "/v1/portfolio/activities",
        { limit: 100, cursor, types: [TYPE_TRADE, TYPE_RESOLUTION], sortOrder: "SORT_ORDER_DESCENDING" }
      );
      let oldest = Infinity;
      for (const a of res.activities ?? []) {
        const slug = a.trade?.marketSlug ?? a.positionResolution?.marketSlug;
        if (!slug) continue;
        const t = activityTime(a);
        if (t) oldest = Math.min(oldest, t);
        if (t && t < sinceMs) continue;
        const list = out.get(slug);
        if (list) list.push(a);
        else out.set(slug, [a]);
      }
      if (res.eof || !res.nextCursor || oldest < sinceMs) break;
      cursor = res.nextCursor;
    }
    for (const list of out.values()) list.sort((x, y) => activityTime(x) - activityTime(y));
    return out;
  }

  async function market(slug: string): Promise<PMMarket | null> {
    try {
      const res = await request<{ market?: PMMarket }>(false, `/v1/market/slug/${encodeURIComponent(slug)}`);
      return res.market ?? null;
    } catch (e) {
      if (e instanceof PolymarketHttpError && e.status === 404) return null;
      throw e;
    }
  }

  return { positions, activitiesBySlug, market };
}

/* ------------------------------ mapping ------------------------------ */

const LEAGUE_TOKENS: Record<string, string> = {
  nba: "NBA",
  nhl: "NHL",
  mlb: "MLB",
  ufc: "UFC",
  mma: "UFC",
  nfl: "NFL",
  ncaaf: "NCAAF",
  cfb: "NCAAF",
  wnba: "WNBA",
  ncaab: "NCAAB",
  cbb: "NCAAB",
  tennis: "TENNIS",
  atp: "TENNIS",
  wta: "TENNIS",
  soccer: "SOCCER",
  epl: "SOCCER",
  mls: "SOCCER",
  laliga: "SOCCER",
  bundesliga: "SOCCER",
  seriea: "SOCCER",
  ligue1: "SOCCER",
  ucl: "SOCCER",
};

function leagueFromText(text: string | undefined | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, "");
  if (compact.includes("collegefootball")) return "NCAAF";
  if (compact.includes("collegebasketball")) return "NCAAB";
  if (compact.includes("premierleague") || compact.includes("championsleague")) return "SOCCER";
  for (const token of lower.split(/[^a-z0-9]+/)) {
    if (LEAGUE_TOKENS[token]) return LEAGUE_TOKENS[token];
  }
  return null;
}

export function leagueFromMarket(slug: string, market?: PMMarket | null): string | null {
  // Slugs look like "aec-nfl-lac-ten-2025-11-02": the league token sits right after the prefix.
  const slugToken = slug.split("-")[1];
  const fromSlug = slugToken ? LEAGUE_TOKENS[slugToken.toLowerCase()] ?? null : null;
  if (fromSlug) return fromSlug;
  for (const side of market?.marketSides ?? []) {
    const fromTeam = leagueFromText(side.team?.league);
    if (fromTeam) return fromTeam;
  }
  return leagueFromText(slug);
}

const num = (v: Amount | string | null | undefined): number | null => {
  const raw = typeof v === "string" ? v : v?.value;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const isoOrNull = (raw: string | null | undefined): string | null => {
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const netOf = (p?: PMPosition | null): number | null => {
  if (!p) return null;
  const direct = num(p.netPositionDecimal ?? p.netPosition);
  if (direct !== null) return direct;
  const bought = num(p.qtyBoughtDecimal);
  const sold = num(p.qtySoldDecimal);
  return bought !== null && sold !== null ? bought - sold : null;
};

const isLineText = (s: string) => /^[+-]?\d/.test(s.trim());

function selectionLabel(market: PMMarket | null | undefined, side: "yes" | "no"): string | null {
  const sides = market?.marketSides ?? [];
  const pick = sides.find((s) => (side === "yes" ? s.long === true : s.long === false));
  return pick?.description?.trim() || null;
}

// Position metadata describes the side you actually hold (e.g. "Miami Heat +2.50"), which is
// clearer than the market question, whose wording follows the underlying YES instrument.
function buildTitle(slug: string, basis: PMPosition, market: PMMarket | null | undefined, side: "yes" | "no"): string {
  const md = basis.marketMetadata;
  const eventTitle = md?.title?.trim();
  const outcome = md?.outcome && md.outcome !== "None" ? md.outcome.trim() : "";
  if (eventTitle && outcome) {
    const team = md?.team?.name?.trim();
    const isTotal = /total/i.test(market?.sportsMarketType ?? "");
    const selection =
      isLineText(outcome) && team
        ? `${team} ${outcome}`
        : isTotal && typeof market?.line === "number"
          ? `${outcome} ${market.line}`
          : outcome;
    return `${selection} - ${eventTitle}`;
  }
  const question = market?.question ?? market?.title ?? slug;
  const selection = selectionLabel(market, side);
  return selection ? `${question} - ${selection}` : question;
}

function comboInfo(slug: string, basis: PMPosition): { title: string; league: string | null } | null {
  const legs = basis.comboLegDetails ?? [];
  if (!slug.startsWith("crossd-") && legs.length === 0) return null;
  const parts = legs
    .map((l) => {
      const label = [l.team?.name, l.outcome].filter(Boolean).join(" ").trim() || l.outcome || l.slug || "";
      return l.title ? `${label} (${l.title})` : label;
    })
    .filter(Boolean);
  const title = parts.length ? `Combo ${legs.length} legs: ${parts.join(" + ")}` : `Combo ${slug}`;
  const leagues = new Set(
    legs.map((l) => leagueFromMarket(l.slug ?? "", { slug: l.slug ?? "", marketSides: [{ team: l.team }] }))
  );
  const only = leagues.size === 1 ? [...leagues][0] : null;
  return { title, league: only };
}

export type MapInput = {
  slug: string;
  position?: PMPosition | null;
  activities: PMActivity[];
  market?: PMMarket | null;
};

export function mapPositionToTicket({ slug, position, activities, market }: MapInput): MapResult {
  if (market?.category && market.category.toLowerCase() !== "sports") {
    return { ticket: null, skip: "non-sports" };
  }

  const reasons: string[] = [];

  let resolution: PMResolution | undefined;
  for (const a of activities) if (a.positionResolution) resolution = a.positionResolution;

  const live = position && !position.expired && (netOf(position) ?? 0) !== 0 ? position : undefined;
  const basis = resolution ? resolution.beforePosition ?? undefined : live;

  if (!resolution && !live) {
    return { ticket: null, skip: position ? "closed-early" : "no-data" };
  }
  if (!basis) return { ticket: null, skip: "no-data" };

  const net = netOf(basis);
  if (net === null || net === 0) return { ticket: null, skip: "no-data" };

  // One instrument per market: long = the listed outcome, short = the opposite side.
  const side: "yes" | "no" = net > 0 ? "yes" : "no";
  const qty = Math.abs(net);

  // `cost` is the all-in amount you paid (base cost + fees). That is your real risk.
  const baseCost = num(basis.baseCost);
  const feesField = num(basis.fees);
  let cost = num(basis.cost);
  if (cost === null && baseCost !== null) cost = baseCost + (feesField ?? 0);
  if (cost === null || cost <= 0) return { ticket: null, skip: "no-data" };

  // A missing `fees` means no fee was charged (e.g. a resting limit order that filled as maker).
  const fee = feesField ?? (baseCost !== null ? Math.max(0, cost - baseCost) : 0);
  if (baseCost !== null && feesField !== null && Math.abs(baseCost + feesField - cost) > 0.05) {
    reasons.push(`Cost $${round2(cost)} doesn't equal base cost $${round2(baseCost)} + fees $${round2(feesField)} - check risk`);
  }

  const risk = round2(cost);
  const payoutIfCorrect = round2(qty * 1);
  const sidePrice = num(basis.costPerShare) ?? (baseCost !== null ? baseCost / qty : (cost - fee) / qty);

  // Early exits: for a long the opening action is a buy, for a short it is a sell.
  const closedQty = net > 0 ? num(basis.qtySoldDecimal) : num(basis.qtyBoughtDecimal);
  if ((closedQty ?? 0) > 0.005) {
    reasons.push("Position was partly closed early - risk reflects only what was held at the end");
  }

  const trades = activities.map((a) => a.trade).filter((t): t is PMTrade => !!t);
  if (trades.some((t) => t.state === "TRADE_STATE_BUSTED")) {
    reasons.push("A trade was busted (reversed) by the exchange - verify the numbers");
  }
  if (trades.some((t) => ["TRADE_STATE_INFLIGHT", "TRADE_STATE_PENDING_RISK", "TRADE_STATE_PENDING_CLEARED"].includes(t.state))) {
    reasons.push("Some trades are still pending - numbers may change");
  }
  const filled = trades.filter((t) => t.state !== "TRADE_STATE_BUSTED" && t.state !== "TRADE_STATE_REJECTED");
  const times = filled.map((t) => (t.createTime ? Date.parse(t.createTime) : NaN)).filter((t) => Number.isFinite(t));
  let placedMs: number;
  if (times.length) {
    placedMs = Math.min(...times);
  } else {
    placedMs = Date.parse(basis.updateTime ?? position?.updateTime ?? "") || Date.now();
    reasons.push("No trade history found in the sync window - the date is approximate");
  }

  let status: MappedTicket["status"] = "open";
  let payout: number | null = null;
  let profit: number | null = null;
  let settled_at: string | null = null;

  if (resolution) {
    // `realized` is before fees, so net profit subtracts them.
    const realized = num(resolution.afterPosition?.realized);
    if (realized === null) {
      reasons.push("Market resolved but Polymarket gave no P&L - set the result manually");
    } else {
      profit = round2(realized - fee);
      payout = round2(risk + profit);
      const expectedWin = round2(payoutIfCorrect - risk);
      const expectedLoss = round2(-risk);
      if (Math.abs(profit - expectedWin) <= 0.1) status = "won";
      else if (Math.abs(profit - expectedLoss) <= 0.1) status = "lost";
      else {
        status = profit > 0.005 ? "won" : profit < -0.005 ? "lost" : "push";
        reasons.push(
          `Settled at an unusual P&L ($${profit}) vs win $${expectedWin} / loss $${expectedLoss} - tie or partial settlement`
        );
      }

      // The resolution's side is the market's winning side (not yours); use it as a cross-check.
      const winner = resolution.side ?? "";
      if (winner.endsWith("NEUTRAL")) {
        reasons.push("Market settled neutral (tie / 50-50) - confirm the payout");
      } else if (winner.endsWith("LONG") || winner.endsWith("SHORT")) {
        const youWon = (net > 0 && winner.endsWith("LONG")) || (net < 0 && winner.endsWith("SHORT"));
        if ((youWon && status === "lost") || (!youWon && status === "won")) {
          reasons.push("Settlement direction disagrees with the P&L - verify the result");
        }
      }
      settled_at = isoOrNull(resolution.updateTime) ?? new Date().toISOString();
    }
  }

  const combo = comboInfo(slug, basis);
  let league: string | null;
  let market_title: string;
  if (combo) {
    league = combo.league;
    market_title = combo.title;
    if (!league) reasons.push("Combo bet - league not detected, set it before confirming");
  } else {
    league = leagueFromMarket(slug, market);
    if (!league) reasons.push("League not recognised - set it before confirming");
    market_title = buildTitle(slug, basis, market, side);
  }

  return {
    ticket: {
      external_source: "polymarket",
      external_id: slug,
      bet_source: "polymarket",
      ticket_type: "single",
      book: "Polymarket",
      market_title,
      league,
      kalshi_side: side,
      kalshi_price_cents: Math.min(99, Math.max(1, Math.round(sidePrice * 100))),
      kalshi_shares: Math.round(qty),
      kalshi_fee: round2(fee),
      stake: risk,
      kalshi_payout_if_correct: payoutIfCorrect,
      status,
      placed_at: new Date(placedMs).toISOString(),
      settled_at,
      payout,
      profit,
      needs_review: reasons.length > 0,
      review_reason: reasons.length ? reasons.join("; ") : null,
    },
  };
}

/* ------------------------- deciding what to change ------------------------- */

const SYNCED_FIELDS = [
  "market_title",
  "league",
  "kalshi_side",
  "kalshi_price_cents",
  "kalshi_shares",
  "kalshi_fee",
  "stake",
  "kalshi_payout_if_correct",
  "placed_at",
] as const satisfies readonly (keyof MappedTicket)[];

const SETTLEMENT_FIELDS = ["status", "payout", "profit", "settled_at"] as const satisfies readonly (keyof MappedTicket)[];

export type ExistingSyncedTicket = {
  status: string;
  needs_review: boolean | null;
  kalshi_shares: number | null;
};

export type UpdatePlan = {
  action: "unchanged" | "update" | "settle";
  patch: Record<string, unknown>;
  flagged: boolean;
};

function pickFields<T extends object>(source: T, keys: readonly (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k as string] = source[k];
  return out;
}

// What to do with a ticket the sync already created. Settled tickets are never touched. An open
// ticket you've confirmed is only changed when something real happened on Polymarket: it settled,
// or more contracts filled (a limit order that kept filling). Fill growth is re-flagged for review
// because it moves your risk and overwrites any hand edits to those numbers.
export function planExistingUpdate(prior: ExistingSyncedTicket, t: MappedTicket): UpdatePlan {
  if (prior.status !== "open") return { action: "unchanged", patch: {}, flagged: false };

  const unconfirmed = prior.needs_review === true;
  const settlingNow = t.status !== "open";
  const grew = prior.kalshi_shares !== null && prior.kalshi_shares !== t.kalshi_shares;

  if (!settlingNow && !unconfirmed && !grew) return { action: "unchanged", patch: {}, flagged: false };

  const patch: Record<string, unknown> = {};
  if (unconfirmed || grew) Object.assign(patch, pickFields(t, SYNCED_FIELDS));
  if (settlingNow) Object.assign(patch, pickFields(t, SETTLEMENT_FIELDS));

  let flagged = false;
  if (grew) {
    const note = `Contracts changed from ${prior.kalshi_shares} to ${t.kalshi_shares} (more of a limit order filled) - re-check risk and payout`;
    patch.needs_review = true;
    patch.review_reason = [note, t.review_reason].filter(Boolean).join("; ");
    flagged = true;
  } else if (t.needs_review) {
    patch.needs_review = true;
    patch.review_reason = t.review_reason;
    flagged = true;
  }

  return { action: settlingNow ? "settle" : "update", patch, flagged };
}

/* ------------------------- compact preview sample ------------------------- */

const slimMeta = (m?: PMMarketMetadata | null) =>
  m ? { title: m.title, outcome: m.outcome, team: m.team ? { name: m.team.name, league: m.team.league } : undefined } : undefined;

export function slimPosition(p?: PMPosition | null) {
  if (!p) return null;
  return {
    net: p.netPositionDecimal,
    bought: p.qtyBoughtDecimal,
    sold: p.qtySoldDecimal,
    cost: p.cost?.value,
    baseCost: p.baseCost?.value,
    fees: p.fees?.value,
    avgPx: p.avgPx?.value,
    costPerShare: p.costPerShare?.value,
    realized: p.realized?.value,
    expired: p.expired,
    meta: slimMeta(p.marketMetadata),
    comboLegs: p.comboLegDetails?.length
      ? p.comboLegDetails.map((l) => ({ slug: l.slug, title: l.title, outcome: l.outcome, state: l.state, side: l.outcomeSide, team: l.team?.name }))
      : undefined,
  };
}

export function slimActivity(a: PMActivity) {
  if (a.trade) {
    const t = a.trade;
    const order = t.aggressorExecution?.order;
    return {
      type: "TRADE",
      id: t.id,
      state: t.state,
      at: t.createTime,
      price: t.price?.value,
      qty: t.qtyDecimal,
      cost: t.cost?.value,
      aggressor: t.isAggressor,
      intent: order?.intent,
      outcomeSide: order?.outcomeSide,
      commission: t.aggressorExecution?.commissionNotionalCollected?.value,
    };
  }
  const r = a.positionResolution;
  return {
    type: "RESOLUTION",
    at: r?.updateTime,
    winningSide: r?.side,
    before: slimPosition(r?.beforePosition),
    after: slimPosition(r?.afterPosition),
  };
}

export function slimMarket(m?: PMMarket | null) {
  if (!m) return null;
  return { slug: m.slug, category: m.category, question: m.question, type: m.sportsMarketType, line: m.line };
}
