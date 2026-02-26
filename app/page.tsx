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
function fmtMoney(n: number) {
  return n.toFixed(2);
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
function ticketDateForGrouping(t: Ticket) {
  const d = new Date(t.placed_at);
  return yyyyMmDd(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
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

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const value = typeof p?.value === "number" ? p.value : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
      <div className="mb-1 font-black">{label}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="opacity-70">{p?.name}</span>
        <span className="font-black">{value === null ? "—" : fmtMoney(value)}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  const [startingBankroll, setStartingBankroll] = useState<number>(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  const [leagueFilter, setLeagueFilter] = useState<string>("ALL");

  const [preset, setPreset] = useState<DatePreset>("MTD");
  const [customStart, setCustomStart] = useState<string>(() =>
    yyyyMmDd(addDays(new Date(), -29))
  );
  const [customEnd, setCustomEnd] = useState<string>(() => yyyyMmDd(new Date()));

  const [graphMode, setGraphMode] = useState<GraphMode>("BANKROLL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  useEffect(() => {
    let alive = true;

    async function checkSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;

      if (error || !data.session) {
        router.replace("/login");
        return;
      }

      setAuthChecked(true);
    }

    checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
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

  useEffect(() => {
    if (!authChecked) return;

    async function load() {
      setLoading(true);

      const { data, error } = await supabase
        .from("tickets")
        .select(
          "id, ticket_type, stake, status, book, payout, profit, placed_at, settled_at, league"
        )
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

    load();
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
      ? toLocalMidnightIso(
          yyyyMmDd(addDays(new Date(rangeEndInclusive + "T00:00:00"), 1))
        )
      : null;

    return tickets.filter((t) => {
      const passLeague =
        leagueFilter === "ALL" ? true : (t.league ?? "") === leagueFilter;
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

    const prevMonthEndingBankroll = round2(
      (Number(startingBankroll) || 0) + realizedProfitUpToPrevMonthEnd
    );
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
      const passLeague =
        leagueFilter === "ALL" ? true : (t.league ?? "") === leagueFilter;
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
    let runningProfit = round2(baselineBankroll - (Number(startingBankroll) || 0));

    return days.map((d) => {
      const dayProfit = map.get(d) ?? 0;
      runningBankroll += dayProfit;
      runningProfit += dayProfit;

      return {
        date: d,
        bankroll: round2(runningBankroll),
        cumulativeProfit: round2(runningProfit),
      };
    });
  }, [filteredTickets, tickets, startingBankroll, leagueFilter, rangeStart]);

  const chartTitle = graphMode === "BANKROLL" ? "Bankroll" : "Profit";
  const chartKey = graphMode === "BANKROLL" ? "bankroll" : "cumulativeProfit";

  const openTickets = useMemo(
    () => statusFilteredTickets.filter((t) => t.status === "open"),
    [statusFilteredTickets]
  );

  const settledTickets = useMemo(
    () => statusFilteredTickets.filter((t) => t.status !== "open"),
    [statusFilteredTickets]
  );

  if (!authChecked) return <div className="px-4 py-6">Checking session…</div>;
  if (loading) return <div className="px-4 py-6">Loading…</div>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-black tracking-tight">Dashboard</h1>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Link
            href="/new"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-bold"
          >
            + New Bet
          </Link>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-bold"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Filters */}
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

      {/* Stat Cards */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Starting Bankroll */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">Starting Bankroll</div>

          {profileLoading ? (
            <div className="mt-2 text-sm opacity-70">Loading…</div>
          ) : (
            <>
              <div className="mt-2">
                <input
                  type="number"
                  value={startingBankroll}
                  onChange={(e) => setStartingBankroll(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base"
                />
              </div>

              <button
                onClick={saveStartingBankroll}
                disabled={profileSaving}
                className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white font-bold disabled:opacity-60"
              >
                {profileSaving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>

        {/* Current Bankroll */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">Current Bankroll</div>
          <div
            className="mt-1 text-2xl font-black"
            style={{ color: profitColor(currentBankroll - startingBankroll) }}
          >
            {fmtMoney(currentBankroll)}
          </div>
          <div className="mt-1 text-xs leading-snug opacity-70">
            Starting + all-time profit
          </div>
        </div>

        {/* Total Profit */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">Total Profit</div>
          <div
            className="mt-1 text-2xl font-black"
            style={{ color: profitColor(summary.totalProfit) }}
          >
            {fmtMoney(summary.totalProfit)}
          </div>
        </div>

        {/* Total Bet */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">Total Bet</div>
          <div className="mt-1 text-2xl font-black">{fmtMoney(summary.totalBet)}</div>
        </div>

        {/* ROI */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">ROI</div>
          <div className="mt-1 text-2xl font-black" style={{ color: profitColor(summary.roi) }}>
            {summary.roi.toFixed(2)}%
          </div>
        </div>

        {/* Unit Size */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="text-xs opacity-70">Unit Size</div>
          <div className="mt-1 text-2xl font-black">{fmtMoney(unitCard.unitSize)}</div>
          <div className="mt-1 text-xs leading-snug opacity-70">
            5% of {fmtMoney(unitCard.prevMonthEndingBankroll)}
            <br />
            Rounded down to nearest $50
            <br />
            Max cap: $10,000
            <br />
            As of {unitCard.prevMonthEndLabel}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-black">{chartTitle}</div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
            <button
              onClick={() => setGraphMode("BANKROLL")}
              className="h-11 rounded-xl border border-zinc-200 px-3 font-extrabold"
              style={{
                background: graphMode === "BANKROLL" ? "#111" : "white",
                color: graphMode === "BANKROLL" ? "white" : "#111",
              }}
            >
              Bankroll
            </button>
            <button
              onClick={() => setGraphMode("PROFIT")}
              className="h-11 rounded-xl border border-zinc-200 px-3 font-extrabold"
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
                tickFormatter={(v) => fmtMoneyCompact(Number(v))}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey={chartKey} fill="url(#chartFill)" stroke="none" />
              <Line type="monotone" name={chartTitle} dataKey={chartKey} stroke="#111" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tickets */}
      <h2 className="mt-6 text-xl font-black">Tickets</h2>

      {statusFilter === "ALL" ? (
        <>
          <div className="mt-3 mb-2 font-black">
            Open Tickets{" "}
            <span className="font-bold opacity-60">({openTickets.length})</span>
          </div>
          <TicketList tickets={openTickets} />

          <div className="mt-5 mb-2 font-black">
            Settled Tickets{" "}
            <span className="font-bold opacity-60">({settledTickets.length})</span>
          </div>
          <TicketList tickets={settledTickets} />
        </>
      ) : (
        <div className="mt-3">
          <TicketList tickets={statusFilteredTickets} />
        </div>
      )}
    </div>
  );
}

function TicketList({ tickets }: { tickets: Ticket[] }) {
  function profitColorLocal(n: number) {
    if (n > 0) return "#0f7a2a";
    if (n < 0) return "#b00020";
    return "#111";
  }
  function fmtMoneyLocal(n: number) {
    return n.toFixed(2);
  }
  function ticketDateForGroupingLocal(t: Ticket) {
    const d = new Date(t.placed_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyyMmDdLocal = (dd: Date) =>
      `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
    return yyyyMmDdLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  function statusPillColor(s: Ticket["status"]) {
    if (s === "won") return "rgba(15, 122, 42, 0.12)";
    if (s === "lost") return "rgba(176, 0, 32, 0.10)";
    if (s === "open") return "rgba(17, 17, 17, 0.08)";
    return "rgba(17, 17, 17, 0.06)";
  }

  return (
    <div className="grid gap-3">
      {tickets.length === 0 && <div className="text-sm opacity-70">No tickets in this filter.</div>}

      {tickets.map((t) => (
        <Link
          key={t.id}
          href={`/ticket/${t.id}`}
          className="block rounded-2xl border border-zinc-200 bg-white p-4 no-underline shadow-[0_1px_0_rgba(0,0,0,0.03)]"
        >
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
                Date: {ticketDateForGroupingLocal(t)} • Book: {t.book ?? "—"}
              </div>

              <div className="text-xs opacity-75">
                Bet: {fmtMoneyLocal(t.stake)}
                {typeof t.payout === "number" ? ` • Payout: ${fmtMoneyLocal(t.payout)}` : ""}
              </div>
            </div>

            <div className="sm:text-right">
              <div className="text-xs opacity-70">Profit</div>
              <div
                className="text-lg font-black"
                style={{
                  color:
                    typeof t.profit === "number" ? profitColorLocal(t.profit) : "#111",
                }}
              >
                {typeof t.profit === "number" ? fmtMoneyLocal(t.profit) : "—"}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}