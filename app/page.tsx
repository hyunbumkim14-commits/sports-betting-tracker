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
  selection: string | null;
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
type GraphMode = "PROFIT" | "BANKROLL";
type DashboardTab = "OVERVIEW" | "OPEN" | "CALENDAR" | "PERSONAL";

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
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow">
      <div className="font-extrabold">{label}</div>
      <div className="mt-1">
        <span className="font-bold">{name}:</span>{" "}
        {value === null ? "—" : fmtMoney(value)}
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      {subtitle ? <div className="mt-1 text-sm text-zinc-600">{subtitle}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Pill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="h-10 rounded-full border px-4 text-sm font-extrabold"
      style={{
        background: active ? "#111" : "white",
        color: active ? "white" : "#111",
        borderColor: active ? "#111" : "rgb(228 228 231)",
      }}
    >
      {label}
    </button>
  );
}

function monthLabel(d: Date) {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function buildCalendarGrid(monthDate: Date) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const startWeekday = first.getDay(); // 0 Sun .. 6 Sat
  const daysInMonth = last.getDate();

  const cells: Array<{ date: Date | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(monthDate.getFullYear(), monthDate.getMonth(), day) });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return cells;
}

export default function DashboardPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [legsByTicket, setLegsByTicket] = useState<Record<string, Leg[]>>({});

  const [userEmail, setUserEmail] = useState("");

  const [startingBankroll, setStartingBankroll] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  const [leagueFilter, setLeagueFilter] = useState<"ALL" | (typeof LEAGUE_OPTIONS)[number]>("ALL");

  // ✅ date range pills (default MTD)
  const [preset, setPreset] = useState<DatePreset>("MTD");
  const [customStart, setCustomStart] = useState(() => yyyyMmDd(addDays(new Date(), -29)));
  const [customEnd, setCustomEnd] = useState(() => yyyyMmDd(new Date()));

  // ✅ profit graph first (default)
  const [graphMode, setGraphMode] = useState<GraphMode>("PROFIT");

  const [tab, setTab] = useState<DashboardTab>("OVERVIEW");

  const [quickUpdatingId, setQuickUpdatingId] = useState<string | null>(null);

  // Calendar tab state
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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
        const { error: upsertErr } = await supabase.from("profiles").upsert({
          id: uid,
          starting_bankroll: 0,
        });
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

    const { error } = await supabase.from("profiles").upsert({
      id: uid,
      starting_bankroll: safe,
    });

    setProfileSaving(false);
    if (error) alert(error.message);
  }

  async function loadTicketsAndLegs() {
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

    const t = (data ?? []) as Ticket[];
    setTickets(t);

    // ✅ fetch legs so ticket cards can show the lines/picks
    const ids = t.map((x) => x.id);
    if (ids.length) {
      const { data: legs, error: legsErr } = await supabase
        .from("legs")
        .select("id, ticket_id, selection, american_odds, status")
        .in("ticket_id", ids);

      if (legsErr) {
        console.error(legsErr);
        // Don’t block dashboard if legs fail.
        setLegsByTicket({});
      } else {
        const map: Record<string, Leg[]> = {};
        for (const l of (legs ?? []) as Leg[]) {
          (map[l.ticket_id] = map[l.ticket_id] ?? []).push(l);
        }
        // stable ordering
        for (const k of Object.keys(map)) {
          map[k].sort((a, b) => (a.id > b.id ? 1 : -1));
        }
        setLegsByTicket(map);
      }
    } else {
      setLegsByTicket({});
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!authChecked) return;
    loadTicketsAndLegs();
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

  // Applied filters for OVERVIEW (and not for OPEN tab)
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

  const settledTicketsInRange = useMemo(
    () => filteredTickets.filter((t) => t.status !== "open"),
    [filteredTickets]
  );

  const summary = useMemo(() => {
    let totalProfit = 0;
    let totalBet = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;

    for (const t of settledTicketsInRange) {
      totalBet += Number(t.stake || 0);
      const st = t.status;
      if (st === "won") wins += 1;
      else if (st === "lost") losses += 1;
      else if (st === "push" || st === "void") pushes += 1;

      if (typeof t.profit === "number" && Number.isFinite(t.profit)) totalProfit += t.profit;
    }

    const roi = totalBet > 0 ? (totalProfit / totalBet) * 100 : 0;
    return { totalProfit, totalBet, roi, record: `${wins}-${losses}-${pushes}` };
  }, [settledTicketsInRange]);

  const allTimeProfit = useMemo(() => {
    return tickets.reduce((acc, t) => {
      if (typeof t.profit === "number" && Number.isFinite(t.profit)) return acc + t.profit;
      return acc;
    }, 0);
  }, [tickets]);

  const currentBankroll = useMemo(() => {
    return round2((Number(startingBankroll) || 0) + allTimeProfit);
  }, [startingBankroll, allTimeProfit]);

  // ✅ Unit size stays in PERSONAL only (not overview)
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

  // ✅ CHART DATA WITH NO BREAKS:
  // build a continuous daily series, carrying forward bankroll/profit even on days with no bets.
  const chartData = useMemo(() => {
    if (!tickets.length) return [];

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

    // per-day realized profit inside range (only where profit is known)
    const dayProfitMap = new Map<string, number>();
    for (const t of filteredTickets) {
      const day = ticketDateForGrouping(t);
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      dayProfitMap.set(day, (dayProfitMap.get(day) ?? 0) + p);
    }

    // decide series start/end
    const now = new Date();
    const startDay = rangeStart
      ? new Date(rangeStart + "T00:00:00")
      : filteredTickets.length
      ? new Date(ticketDateForGrouping(filteredTickets[filteredTickets.length - 1]) + "T00:00:00")
      : new Date(yyyyMmDd(now) + "T00:00:00");

    const endDay = rangeEndInclusive
      ? new Date(rangeEndInclusive + "T00:00:00")
      : new Date(yyyyMmDd(now) + "T00:00:00");

    // ensure start <= end
    const s = startDay <= endDay ? startDay : endDay;
    const e = startDay <= endDay ? endDay : startDay;

    const rows: Array<any> = [];
    let runningBankroll = baselineBankroll;
    let profitInRange = 0;

    for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
      const key = yyyyMmDd(d);
      const dayProfit = dayProfitMap.get(key) ?? 0;
      profitInRange += dayProfit;
      runningBankroll += dayProfit;

      const p = round2(profitInRange);

      rows.push({
        date: key,
        bankroll: round2(runningBankroll),
        profitInRange: p,
        profitPos: p >= 0 ? p : null,
        profitNeg: p < 0 ? p : null,
      });
    }

    return rows;
  }, [filteredTickets, tickets, startingBankroll, leagueFilter, rangeStart, rangeEndInclusive]);

  const openTicketsAll = useMemo(() => tickets.filter((t) => t.status === "open"), [tickets]);

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
        .select("id, ticket_id, selection, american_odds, status")
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

      // Sync leg statuses (nice-to-have)
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

      // update local
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id ? { ...t, status: nextStatus, payout, profit, settled_at: nextStatus === "open" ? null : settledAt } : t
        )
      );

      // refresh legs map (so cards show correct statuses if you care later)
      setLegsByTicket((prev) => {
        const next = { ...prev };
        if (next[ticket.id]) {
          next[ticket.id] = next[ticket.id].map((l) => ({
            ...l,
            status:
              nextStatus === "won"
                ? "won"
                : nextStatus === "lost"
                ? "lost"
                : nextStatus === "push"
                ? "push"
                : nextStatus === "void"
                ? "void"
                : "open",
          }));
        }
        return next;
      });
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
        {label}
      </button>
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

    function LinesPreview({ ticketId }: { ticketId: string }) {
      const legs = legsByTicket[ticketId] ?? [];
      const usable = legs.filter((l) => (l.selection ?? "").trim() !== "" || Number.isFinite(l.american_odds));
      if (!usable.length) return null;

      const top = usable.slice(0, 3);
      const extra = usable.length - top.length;

      return (
        <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-xs">
          <div className="font-extrabold text-zinc-600">Lines</div>
          <ul className="mt-1 space-y-1">
            {top.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {(l.selection ?? "—").trim() || "—"}
                </span>
                <span className="shrink-0 font-extrabold text-zinc-700">
                  {Number.isFinite(l.american_odds) ? (l.american_odds > 0 ? `+${l.american_odds}` : `${l.american_odds}`) : "—"}
                </span>
              </li>
            ))}
          </ul>
          {extra > 0 ? <div className="mt-1 text-zinc-500">+ {extra} more</div> : null}
        </div>
      );
    }

    function TicketCardInner({ t }: { t: Ticket }) {
      return (
        <div className="relative rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
          {/* View top-right */}
          <div className="absolute right-3 top-3">
            <Link
              href={`/ticket/${t.id}`}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-extrabold"
            >
              View →
            </Link>
          </div>

          <div className="flex items-start justify-between gap-3 pr-20">
            <div>
              <div className="text-sm font-extrabold">
                {t.league ?? "—"} • {t.ticket_type.toUpperCase()}
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Date: {ticketDateForGrouping(t)} • Book: {t.book ?? "—"}
              </div>
            </div>
            <div
              className="shrink-0 rounded-full px-3 py-1 text-xs font-extrabold"
              style={{ background: statusPillColor(t.status) }}
            >
              {t.status.toUpperCase()}
            </div>
          </div>

          <div className="mt-3 text-sm">
            <div className="text-zinc-700">
              Bet: <span className="font-extrabold">{fmtMoney(Number(t.stake || 0))}</span>
              {typeof t.payout === "number" ? (
                <>
                  {" "}
                  • Payout: <span className="font-extrabold">{fmtMoney(t.payout)}</span>
                </>
              ) : (
                ""
              )}
            </div>
          </div>

          {/* ✅ Show legs/lines if present */}
          <LinesPreview ticketId={t.id} />

          {mode === "OPEN_ACTIONS" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                disabled={quickUpdatingId === t.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSettle?.(t, "won");
                }}
                className="h-10 rounded-xl bg-green-600 px-3 text-sm font-extrabold text-white disabled:opacity-60"
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
                className="h-10 rounded-xl bg-red-600 px-3 text-sm font-extrabold text-white disabled:opacity-60"
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

              {quickUpdatingId === t.id ? (
                <div className="flex items-center text-sm font-bold text-zinc-500">Updating…</div>
              ) : null}
            </div>
          )}

          <div className="mt-3">
            <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">Profit</div>
            <div className="mt-1 text-lg font-extrabold" style={{ color: profitColor(Number(t.profit ?? 0)) }}>
              {typeof t.profit === "number" ? fmtMoney(t.profit) : "—"}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {tickets.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            No tickets.
          </div>
        ) : null}

        {tickets.map((t) =>
          mode === "LINK" ? (
            <Link key={t.id} href={`/ticket/${t.id}`} className="block">
              <TicketCardInner t={t} />
            </Link>
          ) : (
            <TicketCardInner key={t.id} t={t} />
          )
        )}
      </div>
    );
  }

  // Calendar derived data (uses all tickets, but shows totals for the month)
  const calendarMonthStart = useMemo(() => startOfMonth(calendarMonth), [calendarMonth]);
  const calendarMonthEnd = useMemo(() => endOfMonth(calendarMonth), [calendarMonth]);

  const ticketsInCalendarMonth = useMemo(() => {
    const startIso = toLocalMidnightIso(yyyyMmDd(calendarMonthStart));
    const endExclusiveIso = toLocalMidnightIso(yyyyMmDd(addDays(calendarMonthEnd, 1)));
    return tickets.filter((t) => t.placed_at >= startIso && t.placed_at < endExclusiveIso);
  }, [tickets, calendarMonthStart, calendarMonthEnd]);

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of ticketsInCalendarMonth) {
      const day = ticketDateForGrouping(t);
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      map.set(day, (map.get(day) ?? 0) + p);
    }
    return map;
  }, [ticketsInCalendarMonth]);

  const ticketsForSelectedDay = useMemo(() => {
    if (!selectedDay) return [];
    const startIso = toLocalMidnightIso(selectedDay);
    const endExclusiveIso = toLocalMidnightIso(yyyyMmDd(addDays(new Date(selectedDay + "T00:00:00"), 1)));
    return tickets.filter((t) => t.placed_at >= startIso && t.placed_at < endExclusiveIso);
  }, [tickets, selectedDay]);

  if (!authChecked) {
    return (
      <div className="mx-auto max-w-2xl p-4 text-sm font-bold text-zinc-600">
        Checking session…
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-4 text-sm font-bold text-zinc-600">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 pb-24">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-extrabold">Dashboard</div>
          <div className="text-sm text-zinc-600">
            {tab === "OVERVIEW"
              ? "Overview"
              : tab === "OPEN"
              ? "Open Tickets"
              : tab === "CALENDAR"
              ? "Calendar"
              : "Personal"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/new"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-black px-4 text-sm font-extrabold text-white"
          >
            + New
          </Link>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Filters (OVERVIEW only) */}
      {tab === "OVERVIEW" && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Pill active={preset === "MTD"} label="MTD" onClick={() => setPreset("MTD")} />
            <Pill active={preset === "7D"} label="7D" onClick={() => setPreset("7D")} />
            <Pill active={preset === "30D"} label="30D" onClick={() => setPreset("30D")} />
            <Pill active={preset === "LAST_MONTH"} label="Last Month" onClick={() => setPreset("LAST_MONTH")} />
            <Pill active={preset === "ALL"} label="All-Time" onClick={() => setPreset("ALL")} />
            <Pill active={preset === "CUSTOM"} label="Custom" onClick={() => setPreset("CUSTOM")} />
          </div>

          {preset === "CUSTOM" ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-bold"
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-bold"
              />
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <select
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value as any)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-bold"
            >
              <option value="ALL">All Leagues</option>
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>

            <button
              onClick={() => loadTicketsAndLegs()}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-extrabold"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* OVERVIEW */}
      {tab === "OVERVIEW" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card title="Bankroll">
              <div className="text-2xl font-extrabold">{fmtMoney(currentBankroll)}</div>
              <div className="mt-1 text-xs text-zinc-600">Starting bankroll + all-time profit</div>
            </Card>

            <Card title="Profit (Range)">
              <div
                className="text-2xl font-extrabold"
                style={{ color: profitColor(summary.totalProfit) }}
              >
                {fmtMoney(summary.totalProfit)}
              </div>
              <div className="mt-1 text-xs text-zinc-600">{summary.roi.toFixed(2)}% ROI</div>
            </Card>

            <Card title="Total Bet (Range)">
              <div className="text-2xl font-extrabold">{fmtMoney(summary.totalBet)}</div>
              <div className="mt-1 text-xs text-zinc-600">Settled tickets only</div>
            </Card>

            <Card title="Record (Range)">
              <div className="text-2xl font-extrabold">{summary.record}</div>
              <div className="mt-1 text-xs text-zinc-600">
                {fmtNumber(settledTicketsInRange.length)} settled tickets
              </div>
            </Card>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
                  Graph
                </div>
                <div className="mt-1 text-sm font-extrabold">
                  {graphMode === "PROFIT" ? "Profit (Range)" : "Bankroll"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* ✅ Profit first + default */}
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
              </div>
            </div>

            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoneyCompact(Number(v))} />
                  <Tooltip content={<CustomTooltip />} />

                  {graphMode === "BANKROLL" ? (
                    <>
                      <Line
                        type="monotone"
                        dataKey="bankroll"
                        name="Bankroll"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    </>
                  ) : (
                    <>
                      <Area type="monotone" dataKey="profitPos" name="Profit" dot={false} />
                      <Area type="monotone" dataKey="profitNeg" name="Profit" dot={false} />
                      <Line
                        type="monotone"
                        dataKey="profitInRange"
                        name="Profit"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* OPEN (no filtering) */}
      {tab === "OPEN" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-extrabold">
              Open Tickets ({fmtNumber(openTicketsAll.length)})
            </div>
            <button
              onClick={() => loadTicketsAndLegs()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-extrabold"
            >
              Refresh
            </button>
          </div>

          <TicketList
            tickets={openTicketsAll}
            mode="OPEN_ACTIONS"
            onQuickSettle={quickSettleTicket}
            quickUpdatingId={quickUpdatingId}
          />
        </div>
      )}

      {/* CALENDAR */}
      {tab === "CALENDAR" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                const prev = new Date(calendarMonthStart);
                prev.setMonth(prev.getMonth() - 1);
                setCalendarMonth(startOfMonth(prev));
                setSelectedDay(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold"
            >
              ←
            </button>

            <div className="text-lg font-extrabold">{monthLabel(calendarMonthStart)}</div>

            <button
              onClick={() => {
                const next = new Date(calendarMonthStart);
                next.setMonth(next.getMonth() + 1);
                setCalendarMonth(startOfMonth(next));
                setSelectedDay(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 text-xs font-extrabold text-zinc-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {buildCalendarGrid(calendarMonthStart).map((cell, idx) => {
              if (!cell.date) return <div key={idx} className="h-20 rounded-xl" />;

              const key = yyyyMmDd(cell.date);
              const total = round2(dayTotals.get(key) ?? 0);
              const isSelected = selectedDay === key;

              return (
                <button
                  key={key}
                  onClick={() => setSelectedDay(key)}
                  className="h-20 rounded-xl border border-zinc-200 bg-white p-2 text-left"
                  style={{
                    outline: isSelected ? "2px solid #111" : "none",
                    outlineOffset: 2,
                  }}
                >
                  <div className="text-sm font-extrabold">{cell.date.getDate()}</div>
                  <div
                    className="mt-1 text-xs font-extrabold"
                    style={{ color: total > 0 ? "#0f7a2a" : total < 0 ? "#b00020" : "#666" }}
                  >
                    {total === 0 ? "—" : fmtMoney(total)}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDay ? (
            <div className="mt-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-extrabold">Bets on {selectedDay}</div>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-extrabold"
                >
                  Close
                </button>
              </div>

              <div className="mt-3">
                <TicketList tickets={ticketsForSelectedDay} mode="LINK" />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* PERSONAL */}
      {tab === "PERSONAL" && (
        <div className="space-y-3">
          <Card title="Account" subtitle={userEmail || "—"}>
            <div className="text-sm text-zinc-700">
              Your data is tied to your Supabase session.
            </div>
          </Card>

          <Card title="Starting Bankroll">
            {profileLoading ? (
              <div className="text-sm font-bold text-zinc-600">Loading…</div>
            ) : (
              <div className="space-y-2">
                <input
                  type="number"
                  value={startingBankroll}
                  onChange={(e) => setStartingBankroll(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base font-bold"
                />
                <button
                  onClick={saveStartingBankroll}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-extrabold text-white"
                >
                  {profileSaving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </Card>

          <Card title="Unit Size">
            <div className="text-2xl font-extrabold">
              {fmtMoney(unitCard.unitSize)}
            </div>

            <div className="mt-1 text-xs text-zinc-600">
              Based on ending bankroll{" "}
              <span className="font-extrabold">
                {fmtMoney(unitCard.prevMonthEndingBankroll)}
              </span>{" "}
              (previous month end).
            </div>

            <div className="mt-2 text-xs text-zinc-600">
              Calculation: 5% of the ending bankroll, rounded down to the nearest $50,
              with a maximum of $10,000.
            </div>
          </Card>

          <Card title="Experience">
            {experience ? (
              <div className="text-2xl font-extrabold">
                {experience.years}y {experience.months}m {experience.days}d
              </div>
            ) : (
              <div className="text-sm font-bold text-zinc-600">
                Add your first ticket to start tracking experience.
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Bottom App Tabs */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-2xl">
          <BottomTabButton id="OVERVIEW" label="Overview" />
          <BottomTabButton id="OPEN" label="Open" />
          <BottomTabButton id="CALENDAR" label="Calendar" />
          <BottomTabButton id="PERSONAL" label="Personal" />
        </div>
      </div>
    </div>
  );
}