/* =========================================================
   PASTE THIS FILE AT:
   /app/page.tsx
   ========================================================= */

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
} from "recharts";

type Ticket = {
  id: string;
  ticket_type: "single" | "parlay";
  stake: number;
  status: "open" | "won" | "lost" | "push" | "void" | "partial";
  book: string | null;
  payout: number | null;
  profit: number | null;
  placed_at: string;
  settled_at: string | null;
  league: string | null;
};

type Leg = {
  id: string;
  ticket_id: string;
  american_odds: number;
  status: "open" | "won" | "lost" | "push" | "void";
};

const LEAGUE_OPTIONS = [
  "NBA",
  "NHL",
  "MLB",
  "UFC",
  "NFL",
  "NCAAF",
  "WNBA",
  "SOCCER",
  "NCAAB",
  "TENNIS",
  "OTHER",
] as const;

type DatePreset = "7D" | "30D" | "MTD" | "LAST_MONTH" | "ALL" | "CUSTOM";
type GraphMode = "BANKROLL" | "PROFIT";
type StatusFilter = "ALL" | Ticket["status"];
type DashboardTab = "OVERVIEW" | "OPEN" | "HISTORY" | "PERSONAL";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function yyyyMmDd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}
function toLocalMidnightIso(dateOnly: string) {
  return new Date(dateOnly + "T00:00:00").toISOString();
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function lastDayOfPreviousMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 0);
}
function computeUnitSize(prevMonthEndingBankroll: number) {
  const raw = prevMonthEndingBankroll * 0.05;
  const roundedDown = Math.floor(raw / 50) * 50;
  const nonNegative = Math.max(0, roundedDown);
  return Math.min(10_000, nonNegative);
}
function ticketDateForGrouping(t: Ticket) {
  const d = new Date(t.placed_at);
  return yyyyMmDd(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) throw new Error("Invalid American odds");
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}
function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
function fmtMoneyCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
function profitColor(n: number) {
  if (n > 0) return "#0f7a2a";
  if (n < 0) return "#b00020";
  return "#111";
}

// Accurate-ish Y/M/D diff (calendar-aware)
function diffYMD(from: Date, to: Date) {
  let start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (end < start) [start, end] = [end, start];

  let years = end.getFullYear() - start.getFullYear();
  let anchor = new Date(start);
  anchor.setFullYear(start.getFullYear() + years);
  if (anchor > end) {
    years -= 1;
    anchor = new Date(start);
    anchor.setFullYear(start.getFullYear() + years);
  }

  let months = end.getMonth() - anchor.getMonth();
  if (months < 0) months += 12;

  let anchor2 = new Date(anchor);
  anchor2.setMonth(anchor.getMonth() + months);
  if (anchor2 > end) {
    months -= 1;
    anchor2 = new Date(anchor);
    anchor2.setMonth(anchor.getMonth() + months);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.round((end.getTime() - anchor2.getTime()) / msPerDay));

  return { years, months, days };
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const first = payload.find((p: any) => typeof p?.value === "number");
  const name = first?.name ?? "Value";
  const value = typeof first?.value === "number" ? first.value : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="mb-1 font-black">{label}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="opacity-70">{name}</span>
        <span className="font-black">{value === null ? "—" : fmtMoney(value)}</span>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="text-xs opacity-70">{title}</div>
      {subtitle ? <div className="mt-1 text-xs opacity-60">{subtitle}</div> : null}
      <div className="mt-2">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [userEmail, setUserEmail] = useState<string>("");

  const [startingBankroll, setStartingBankroll] = useState<number>(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  const [leagueFilter, setLeagueFilter] = useState<string>("ALL");
  const [preset, setPreset] = useState<DatePreset>("MTD");
  const [customStart, setCustomStart] = useState<string>(() => yyyyMmDd(addDays(new Date(), -29)));
  const [customEnd, setCustomEnd] = useState<string>(() => yyyyMmDd(new Date()));
  const [graphMode, setGraphMode] = useState<GraphMode>("BANKROLL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [tab, setTab] = useState<DashboardTab>("OVERVIEW");
  const [quickUpdatingId, setQuickUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;

      if (error || !data.session) {
        router.replace("/login");
        return;
      }

      setUserEmail(data.session.user.email ?? "");
      setAuthChecked(true);
    }

    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
      setUserEmail(session?.user?.email ?? "");
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    let alive = true;

    async function loadProfile() {
      setProfileLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (alive) setProfileLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("starting_bankroll")
        .eq("id", uid)
        .single();

      if (!error && data) {
        if (alive) setStartingBankroll(Number(data.starting_bankroll) || 0);
      } else {
        const { error: upsertErr } = await supabase
          .from("profiles")
          .upsert({ id: uid, starting_bankroll: 0 });

        if (!upsertErr && alive) setStartingBankroll(0);
      }

      if (alive) setProfileLoading(false);
    }

    loadProfile();
    return () => {
      alive = false;
    };
  }, [authChecked]);

  async function saveStartingBankroll() {
    setProfileSaving(true);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setProfileSaving(false);
      return;
    }

    const safe = Number.isFinite(startingBankroll) ? startingBankroll : 0;

    const { error } = await supabase
      .from("profiles")
      .upsert({ id: uid, starting_bankroll: safe });

    setProfileSaving(false);
    if (error) alert(error.message);
  }

  async function loadTickets() {
    setLoading(true);

    const { data, error } = await supabase
      .from("tickets")
      .select("id, ticket_type, stake, status, book, payout, profit, placed_at, settled_at, league")
      .order("placed_at", { ascending: false });

    if (error) {
      console.error(error);
      alert(error.message);
      setLoading(false);
      return;
    }

    setTickets((data ?? []) as Ticket[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!authChecked) return;
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked]);

  const { rangeStart, rangeEndInclusive } = useMemo(() => {
    const now = new Date();
    if (preset === "ALL") return { rangeStart: null as string | null, rangeEndInclusive: null as string | null };
    if (preset === "CUSTOM") return { rangeStart: customStart || null, rangeEndInclusive: customEnd || null };
    if (preset === "7D") return { rangeStart: yyyyMmDd(addDays(now, -6)), rangeEndInclusive: yyyyMmDd(now) };
    if (preset === "30D") return { rangeStart: yyyyMmDd(addDays(now, -29)), rangeEndInclusive: yyyyMmDd(now) };
    if (preset === "MTD") return { rangeStart: yyyyMmDd(startOfMonth(now)), rangeEndInclusive: yyyyMmDd(now) };
    if (preset === "LAST_MONTH") {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        rangeStart: yyyyMmDd(startOfMonth(lastMonth)),
        rangeEndInclusive: yyyyMmDd(endOfMonth(lastMonth)),
      };
    }
    return { rangeStart: null, rangeEndInclusive: null };
  }, [preset, customStart, customEnd]);

  const filteredTickets = useMemo(() => {
    const startIso = rangeStart ? toLocalMidnightIso(rangeStart) : null;

    const endExclusiveIso = rangeEndInclusive
      ? toLocalMidnightIso(yyyyMmDd(addDays(new Date(rangeEndInclusive + "T00:00:00"), 1)))
      : null;

    return tickets.filter((t) => {
      const passLeague = leagueFilter === "ALL" ? true : (t.league ?? "") === leagueFilter;
      const baseIso = t.placed_at;
      const passStart = !startIso ? true : baseIso >= startIso;
      const passEnd = !endExclusiveIso ? true : baseIso < endExclusiveIso;
      return passLeague && passStart && passEnd;
    });
  }, [tickets, leagueFilter, rangeStart, rangeEndInclusive]);

  const statusFilteredTickets = useMemo(() => {
    if (statusFilter === "ALL") return filteredTickets;
    return filteredTickets.filter((t) => t.status === statusFilter);
  }, [filteredTickets, statusFilter]);

  const summary = useMemo(() => {
    let totalProfit = 0;
    let totalBet = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;

    for (const t of statusFilteredTickets) {
      totalBet += Number(t.stake || 0);

      const st = t.status;
      if (st === "won") wins += 1;
      else if (st === "lost") losses += 1;
      else if (st === "push" || st === "void") pushes += 1;

      if (typeof t.profit === "number" && Number.isFinite(t.profit)) {
        totalProfit += t.profit;
      }
    }

    const roi = totalBet > 0 ? (totalProfit / totalBet) * 100 : 0;

    return {
      totalProfit,
      totalBet,
      roi,
      record: `${wins}-${losses}-${pushes}`,
    };
  }, [statusFilteredTickets]);

  const allTimeProfit = useMemo(() => {
    return tickets.reduce((acc, t) => {
      if (typeof t.profit === "number" && Number.isFinite(t.profit)) return acc + t.profit;
      return acc;
    }, 0);
  }, [tickets]);

  const currentBankroll = useMemo(() => {
    return round2((Number(startingBankroll) || 0) + allTimeProfit);
  }, [startingBankroll, allTimeProfit]);

  const unitCard = useMemo(() => {
    const now = new Date();
    const prevMonthEnd = lastDayOfPreviousMonth(now);

    const prevMonthEndIsoExclusive = new Date(
      prevMonthEnd.getFullYear(),
      prevMonthEnd.getMonth(),
      prevMonthEnd.getDate() + 1,
      0,
      0,
      0
    ).toISOString();

    const realizedProfitUpToPrevMonthEnd = tickets.reduce((acc, t) => {
      const baseIso = t.placed_at;
      if (baseIso >= prevMonthEndIsoExclusive) return acc;
      if (typeof t.profit === "number" && Number.isFinite(t.profit)) return acc + t.profit;
      return acc;
    }, 0);

    const prevMonthEndingBankroll = round2((Number(startingBankroll) || 0) + realizedProfitUpToPrevMonthEnd);
    const unitSize = computeUnitSize(prevMonthEndingBankroll);

    return {
      prevMonthEndLabel: yyyyMmDd(prevMonthEnd),
      prevMonthEndingBankroll,
      unitSize,
    };
  }, [tickets, startingBankroll]);

  const chartData = useMemo(() => {
    const startIso = rangeStart ? toLocalMidnightIso(rangeStart) : null;

    const profitBeforeRange = tickets.reduce((acc, t) => {
      const passLeague = leagueFilter === "ALL" ? true : (t.league ?? "") === leagueFilter;
      if (!passLeague) return acc;

      if (startIso && t.placed_at < startIso) {
        if (typeof t.profit === "number" && Number.isFinite(t.profit)) return acc + t.profit;
      }
      return acc;
    }, 0);

    const baselineBankroll = round2((Number(startingBankroll) || 0) + profitBeforeRange);

    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const day = ticketDateForGrouping(t);
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      map.set(day, (map.get(day) ?? 0) + p);
    }

    const days = Array.from(map.keys()).sort();
    let runningBankroll = baselineBankroll;
    let profitInRange = 0;

    return days.map((d) => {
      const dayProfit = map.get(d) ?? 0;
      runningBankroll += dayProfit;
      profitInRange += dayProfit;

      const p = round2(profitInRange);

      return {
        date: d,
        bankroll: round2(runningBankroll),
        profitInRange: p,
        profitPos: p >= 0 ? p : null,
        profitNeg: p < 0 ? p : null,
      };
    });
  }, [filteredTickets, tickets, startingBankroll, leagueFilter, rangeStart]);

  const openTicketsAll = useMemo(() => tickets.filter((t) => t.status === "open"), [tickets]);
  const openTickets = useMemo(
    () => statusFilteredTickets.filter((t) => t.status === "open"),
    [statusFilteredTickets]
  );
  const settledTickets = useMemo(
    () => statusFilteredTickets.filter((t) => t.status !== "open"),
    [statusFilteredTickets]
  );

  const firstTicketDate = useMemo(() => {
    if (!tickets.length) return null;
    let min = tickets[0].placed_at;
    for (const t of tickets) if (t.placed_at < min) min = t.placed_at;
    return new Date(min);
  }, [tickets]);

  const experience = useMemo(() => {
    if (!firstTicketDate) return null;
    return diffYMD(firstTicketDate, new Date());
  }, [firstTicketDate]);

  async function quickSettleTicket(ticket: Ticket, nextStatus: Ticket["status"]) {
    if (quickUpdatingId) return;
    setQuickUpdatingId(ticket.id);

    try {
      const { data: legs, error: legsErr } = await supabase
        .from("legs")
        .select("id, ticket_id, american_odds, status")
        .eq("ticket_id", ticket.id);

      if (legsErr) throw legsErr;

      const legsArr = (legs ?? []) as Leg[];
      const stake = Number(ticket.stake || 0);
      const settledAt = new Date().toISOString();

      let payout: number | null = null;
      let profit: number | null = null;

      if (nextStatus === "open" || nextStatus === "partial") {
        payout = null;
        profit = null;
      } else if (nextStatus === "push" || nextStatus === "void") {
        payout = round2(stake);
        profit = 0;
      } else if (nextStatus === "lost") {
        payout = 0;
        profit = round2(0 - stake);
      } else if (nextStatus === "won") {
        if (ticket.ticket_type === "single") {
          const a = Number(legsArr?.[0]?.american_odds);
          const dec = americanToDecimal(a);
          payout = round2(stake * dec);
          profit = round2(payout - stake);
        } else {
          const m = legsArr.reduce((acc, l) => {
            if (l.status === "push" || l.status === "void") return acc * 1;
            return acc * americanToDecimal(Number(l.american_odds));
          }, 1);
          payout = round2(stake * m);
          profit = round2(payout - stake);
        }
      }

      const { error: tErr } = await supabase
        .from("tickets")
        .update({
          status: nextStatus,
          payout,
          profit,
          settled_at: nextStatus === "open" ? null : settledAt,
        })
        .eq("id", ticket.id);

      if (tErr) throw tErr;

      if (legsArr.length) {
        const legStatus: Leg["status"] =
          nextStatus === "won"
            ? "won"
            : nextStatus === "lost"
            ? "lost"
            : nextStatus === "push"
            ? "push"
            : nextStatus === "void"
            ? "void"
            : "open";

        await supabase.from("legs").update({ status: legStatus }).eq("ticket_id", ticket.id);
      }

      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id
            ? { ...t, status: nextStatus, payout, profit, settled_at: nextStatus === "open" ? null : settledAt }
            : t
        )
      );
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to update ticket.");
    } finally {
      setQuickUpdatingId(null);
    }
  }

  function BottomTabButton({ id, label }: { id: DashboardTab; label: string }) {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-extrabold"
        style={{ color: active ? "#111" : "rgba(0,0,0,0.55)" }}
      >
        <div
          className="h-1.5 w-10 rounded-full"
          style={{ background: active ? "#111" : "transparent" }}
        />
        <div>{label}</div>
      </button>
    );
  }

  if (!authChecked) return <div className="px-4 py-6">Checking session…</div>;
  if (loading) return <div className="px-4 py-6">Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs opacity-70">Dashboard</div>
          <h1 className="text-2xl font-black tracking-tight">
            {tab === "OVERVIEW"
              ? "Overview"
              : tab === "OPEN"
              ? "Open"
              : tab === "HISTORY"
              ? "History"
              : "Personal"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/new"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-bold"
          >
            + New
          </Link>

          {/* ✅ smaller logout */}
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Filters (apply to overview + lists) */}
      {tab !== "PERSONAL" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5">
            <span className="text-xs opacity-70">League</span>
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            >
              <option value="ALL">All</option>
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs opacity-70">Date Range</span>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as DatePreset)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            >
              <option value="7D">Last 7 Days</option>
              <option value="30D">Last 30 Days</option>
              <option value="MTD">MTD</option>
              <option value="LAST_MONTH">Last Month</option>
              <option value="ALL">All-Time</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs opacity-70">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
            >
              <option value="ALL">All</option>
              <option value="open">open</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="push">push</option>
              <option value="void">void</option>
              <option value="partial">partial</option>
            </select>
          </label>

          {preset === "CUSTOM" && (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs opacity-70">Start</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs opacity-70">End</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
                />
              </label>
            </>
          )}
        </div>
      )}

      {/* OVERVIEW */}
      {tab === "OVERVIEW" && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card title="Current Bankroll" subtitle="Starting + all-time profit">
              <div className="text-2xl font-black" style={{ color: profitColor(currentBankroll - startingBankroll) }}>
                {fmtMoney(currentBankroll)}
              </div>
            </Card>

            <Card title="Total Profit (Filter)" subtitle={`Record: ${summary.record}`}>
              <div className="text-2xl font-black" style={{ color: profitColor(summary.totalProfit) }}>
                {fmtMoney(summary.totalProfit)}
              </div>
            </Card>

            <Card title="ROI (Filter)">
              <div className="text-2xl font-black" style={{ color: profitColor(summary.roi) }}>
                {summary.roi.toFixed(2)}%
              </div>
            </Card>

            <Card title="Total Bet (Filter)">
              <div className="text-2xl font-black">{fmtMoney(summary.totalBet)}</div>
            </Card>

            <Card title="Tickets (Filter)">
              <div className="text-2xl font-black">{fmtNumber(statusFilteredTickets.length)}</div>
            </Card>

            <Card title="Unit Size" subtitle={`As of ${unitCard.prevMonthEndLabel}`}>
              <div className="text-2xl font-black">{fmtMoney(unitCard.unitSize)}</div>
              <div className="mt-1 text-xs opacity-70">
                5% of {fmtMoney(unitCard.prevMonthEndingBankroll)} (rounded down to $50)
              </div>
            </Card>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-black">{graphMode === "BANKROLL" ? "Bankroll" : "Profit (Range)"}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setGraphMode("BANKROLL")}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-extrabold"
                  style={{
                    background: graphMode === "BANKROLL" ? "#111" : "white",
                    color: graphMode === "BANKROLL" ? "white" : "#111",
                  }}
                >
                  Bankroll
                </button>
                <button
                  onClick={() => setGraphMode("PROFIT")}
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm font-extrabold"
                  style={{
                    background: graphMode === "PROFIT" ? "#111" : "white",
                    color: graphMode === "PROFIT" ? "white" : "#111",
                  }}
                >
                  Profit
                </button>
              </div>
            </div>

            <div className="mt-3 h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#111" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#111" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    domain={graphMode === "BANKROLL" ? [Number(startingBankroll) || 0, "auto"] : ["auto", "auto"]}
                    tickFormatter={(v) => fmtMoneyCompact(Number(v))}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {graphMode === "BANKROLL" ? (
                    <>
                      <Area type="monotone" dataKey="bankroll" fill="url(#chartFill)" stroke="none" />
                      <Line type="monotone" name="Bankroll" dataKey="bankroll" stroke="#111" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    </>
                  ) : (
                    <>
                      <Area type="monotone" dataKey="profitInRange" fill="url(#chartFill)" stroke="none" />
                      <Line type="monotone" name="Profit" dataKey="profitPos" stroke="#0f7a2a" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" name="Profit" dataKey="profitNeg" stroke="#b00020" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* OPEN */}
      {tab === "OPEN" && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl font-black">Open Tickets ({fmtNumber(openTickets.length)})</div>
            <button
              onClick={loadTickets}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-bold"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3">
            <TicketList
              tickets={openTickets}
              mode="OPEN_ACTIONS"
              onQuickSettle={quickSettleTicket}
              quickUpdatingId={quickUpdatingId}
            />
          </div>
        </div>
      )}

      {/* HISTORY */}
      {tab === "HISTORY" && (
        <div className="mt-5">
          <div className="text-xl font-black">Tickets ({fmtNumber(statusFilteredTickets.length)})</div>

          {statusFilter === "ALL" ? (
            <>
              <div className="mt-3 mb-2 font-black">
                Settled <span className="font-bold opacity-60">({fmtNumber(settledTickets.length)})</span>
              </div>
              <TicketList tickets={settledTickets} mode="LINK" />

              <div className="mt-5 mb-2 font-black">
                Open <span className="font-bold opacity-60">({fmtNumber(openTickets.length)})</span>
              </div>
              <TicketList tickets={openTickets} mode="LINK" />
            </>
          ) : (
            <div className="mt-3">
              <TicketList tickets={statusFilteredTickets} mode="LINK" />
            </div>
          )}
        </div>
      )}

      {/* PERSONAL */}
      {tab === "PERSONAL" && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Card title="Account Email">
            <div className="text-lg font-black">{userEmail || "—"}</div>
          </Card>

          <Card title="Starting Bankroll">
            {profileLoading ? (
              <div className="text-sm opacity-70">Loading…</div>
            ) : (
              <>
                <input
                  type="number"
                  value={startingBankroll}
                  onChange={(e) => setStartingBankroll(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
                />
                <button
                  onClick={saveStartingBankroll}
                  disabled={profileSaving}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white font-bold disabled:opacity-60"
                >
                  {profileSaving ? "Saving…" : "Save"}
                </button>
              </>
            )}
          </Card>

          <Card title="Unit Size" subtitle={`As of ${unitCard.prevMonthEndLabel}`}>
            <div className="text-lg font-black">{fmtMoney(unitCard.unitSize)}</div>
            <div className="mt-1 text-xs opacity-70">
              Based on ending bankroll {fmtMoney(unitCard.prevMonthEndingBankroll)}
            </div>
          </Card>

          <Card title="Betting Experience" subtitle={firstTicketDate ? `First ticket: ${yyyyMmDd(firstTicketDate)}` : "No tickets yet"}>
            {experience ? (
              <div className="text-lg font-black">
                {experience.years}y {experience.months}m {experience.days}d
              </div>
            ) : (
              <div className="text-sm opacity-70">Add your first ticket to start tracking experience.</div>
            )}
          </Card>
        </div>
      )}

      {/* Bottom App Tabs */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl px-4 sm:px-6">
          <BottomTabButton id="OVERVIEW" label="Overview" />
          <BottomTabButton id="OPEN" label={`Open (${openTicketsAll.length})`} />
          <BottomTabButton id="HISTORY" label="History" />
          <BottomTabButton id="PERSONAL" label="Personal" />
        </div>
      </div>
    </div>
  );
}

function TicketList({
  tickets,
  mode,
  onQuickSettle,
  quickUpdatingId,
}: {
  tickets: Ticket[];
  mode: "LINK" | "OPEN_ACTIONS";
  onQuickSettle?: (ticket: Ticket, nextStatus: Ticket["status"]) => Promise<void>;
  quickUpdatingId?: string | null;
}) {
  function statusPillColor(s: Ticket["status"]) {
    if (s === "won") return "rgba(15, 122, 42, 0.12)";
    if (s === "lost") return "rgba(176, 0, 32, 0.10)";
    if (s === "open") return "rgba(17, 17, 17, 0.08)";
    return "rgba(17, 17, 17, 0.06)";
  }

  function TicketCardInner({ t }: { t: Ticket }) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-black">
              {t.league ?? "—"} • {t.ticket_type.toUpperCase()}
            </div>

            <span
              className="rounded-full border border-black/5 px-2 py-1 text-xs font-black"
              style={{ background: statusPillColor(t.status) }}
            >
              {t.status.toUpperCase()}
            </span>
          </div>

          <div className="text-xs opacity-75">
            Date: {ticketDateForGrouping(t)} • Book: {t.book ?? "—"}
          </div>

          <div className="text-xs opacity-75">
            Bet: {fmtMoney(Number(t.stake || 0))}
            {typeof t.payout === "number" ? ` • Payout: ${fmtMoney(t.payout)}` : ""}
          </div>

          {mode === "OPEN_ACTIONS" && (
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                disabled={quickUpdatingId === t.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSettle?.(t, "won");
                }}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold disabled:opacity-60"
              >
                ✔ Win
              </button>
              <button
                disabled={quickUpdatingId === t.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSettle?.(t, "lost");
                }}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold disabled:opacity-60"
              >
                ✖ Loss
              </button>
              <button
                disabled={quickUpdatingId === t.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSettle?.(t, "push");
                }}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold disabled:opacity-60"
              >
                Push
              </button>
              <button
                disabled={quickUpdatingId === t.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSettle?.(t, "void");
                }}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold disabled:opacity-60"
              >
                Void
              </button>

              {/* ✅ View button */}
              <Link
                href={`/ticket/${t.id}`}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold"
              >
                View →
              </Link>

              {quickUpdatingId === t.id && (
                <span className="self-center text-xs font-bold opacity-70">Updating…</span>
              )}
            </div>
          )}
        </div>

        <div className="sm:text-right">
          <div className="text-xs opacity-70">Profit</div>
          <div
            className="text-lg font-black"
            style={{ color: typeof t.profit === "number" ? profitColor(t.profit) : "#111" }}
          >
            {typeof t.profit === "number" ? fmtMoney(t.profit) : "—"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {tickets.length === 0 && <div className="text-sm opacity-70">No tickets in this filter.</div>}

      {tickets.map((t) =>
        mode === "LINK" ? (
          <Link
            key={t.id}
            href={`/ticket/${t.id}`}
            className="block rounded-2xl border border-zinc-200 bg-white p-4 no-underline shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          >
            <TicketCardInner t={t} />
          </Link>
        ) : (
          <div
            key={t.id}
            className="block rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          >
            <TicketCardInner t={t} />
          </div>
        )
      )}
    </div>
  );
}