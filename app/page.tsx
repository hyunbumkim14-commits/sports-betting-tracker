/* =========================================================
   PASTE THIS FILE AT:
   /app/page.tsx
   ========================================================= */

"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
function yyyyMm(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
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
  // dateOnly: YYYY-MM-DD
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
function localDateKeyFromIso(iso: string) {
  const d = new Date(iso); // interpreted in LOCAL timezone
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // LOCAL YYYY-MM-DD
}

function ticketDateForGrouping(t: Ticket) {
  return localDateKeyFromIso(t.placed_at);
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
function fmtMoney0(n: number) {
  // whole dollars (calendar)
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
function profitFill(n: number) {
  // lighter than text color
  if (n > 0) return "#dcfce7"; // light green
  if (n < 0) return "#fee2e2"; // light red
  return "#ffffff";
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
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm">
      <div className="font-extrabold">{label}</div>
      <div className="mt-1 font-bold">
        {name}: {value === null ? "—" : fmtMoney(value)}
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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-extrabold">{title}</div>
      {subtitle ? <div className="mt-1 text-xs text-zinc-500">{subtitle}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 px-3 text-sm font-extrabold"
      style={{ background: active ? "#111" : "white", color: active ? "white" : "#111" }}
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

function TicketLines({ legs }: { legs: Leg[] }) {
  if (!legs?.length) return null;
  const top = legs.slice(0, 3);
  const extra = Math.max(0, legs.length - top.length);

  return (
    <div className="mt-2 text-xs text-zinc-700">
      <div className="font-extrabold">Lines</div>
      <ul className="mt-1 space-y-1">
        {top.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3">
            <span className="truncate">
              {(l.selection ?? "—").trim() || "—"}
            </span>
            <span className="shrink-0 font-extrabold tabular-nums">
              {Number.isFinite(l.american_odds)
                ? l.american_odds > 0
                  ? `+${l.american_odds}`
                  : `${l.american_odds}`
                : "—"}
            </span>
          </li>
        ))}
      </ul>
      {extra > 0 ? <div className="mt-1 font-bold text-zinc-500">+ {extra} more</div> : null}
    </div>
  );
}

function TicketCardInner({
  t,
  legs,
  mode,
  quickUpdatingId,
  onQuickSettle,
}: {
  t: Ticket;
  legs: Leg[];
  mode: "LINK" | "PLAIN";
  quickUpdatingId: string | null;
  onQuickSettle?: (t: Ticket, status: Ticket["status"]) => void;
}) {
  const body = (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold">
            {t.league ?? "—"} • {t.ticket_type.toUpperCase()}
          </div>
          <div className="mt-1 text-xs text-zinc-600">
            Date: <span className="font-bold">{ticketDateForGrouping(t)}</span> • Book:{" "}
            <span className="font-bold">{t.book ?? "—"}</span>
          </div>
        </div>

        {mode === "LINK" ? (
          <div className="shrink-0 text-xs font-extrabold text-zinc-900">View →</div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11px] font-extrabold text-zinc-500">Stake</div>
          <div className="mt-1 text-sm font-extrabold tabular-nums">${fmtMoney(t.stake)}</div>
        </div>
        <div>
          <div className="text-[11px] font-extrabold text-zinc-500">Status</div>
          <div className="mt-1 text-sm font-extrabold">{t.status.toUpperCase()}</div>
        </div>
        <div>
          <div className="text-[11px] font-extrabold text-zinc-500">Profit</div>
          <div
            className="mt-1 text-sm font-extrabold tabular-nums"
            style={{ color: profitColor(typeof t.profit === "number" ? t.profit : 0) }}
          >
            {typeof t.profit === "number" ? `$${fmtMoney(t.profit)}` : "—"}
          </div>
        </div>
      </div>

      <TicketLines legs={legs} />

      {mode === "PLAIN" && t.status === "open" ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button
            type="button"
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
            type="button"
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
            type="button"
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
            type="button"
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
            <div className="col-span-4 mt-1 text-center text-xs font-bold text-zinc-500">
              Updating…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (mode === "LINK") {
    return (
      <Link href={`/ticket/${t.id}`} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

function TicketList({
  tickets,
  legsByTicket,
  mode,
  quickUpdatingId,
  onQuickSettle,
}: {
  tickets: Ticket[];
  legsByTicket: Record<string, Leg[]>;
  mode: "LINK" | "PLAIN";
  quickUpdatingId: string | null;
  onQuickSettle?: (t: Ticket, status: Ticket["status"]) => void;
}) {
  return (
    <div className="space-y-3">
      {tickets.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm font-bold text-zinc-500">
          No tickets.
        </div>
      ) : null}
      {tickets.map((t) => (
        <TicketCardInner
          key={t.id}
          t={t}
          legs={legsByTicket[t.id] ?? []}
          mode={mode}
          quickUpdatingId={quickUpdatingId}
          onQuickSettle={onQuickSettle}
        />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [legsByTicket, setLegsByTicket] = useState<Record<string, Leg[]>>({});

  const [userEmail, setUserEmail] = useState("");
  const [startingBankroll, setStartingBankroll] = useState<number>(0);
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
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const monthPickerRef = useRef<HTMLInputElement | null>(null);

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
    const { error } = await supabase.from("profiles").upsert({ id: uid, starting_bankroll: safe });
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

    const ids = t.map((x) => x.id);
    if (ids.length) {
      const { data: legs, error: legsErr } = await supabase
        .from("legs")
        .select("id, ticket_id, selection, american_odds, status")
        .in("ticket_id", ids);

      if (legsErr) {
        console.error(legsErr);
      } else {
        const grouped: Record<string, Leg[]> = {};
        for (const l of (legs ?? []) as Leg[]) {
          grouped[l.ticket_id] = grouped[l.ticket_id] ?? [];
          grouped[l.ticket_id].push(l);
        }
        setLegsByTicket(grouped);
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

  async function quickSettle(t: Ticket, status: Ticket["status"]) {
    setQuickUpdatingId(t.id);

    let profit: number | null = t.profit ?? null;
    let payout: number | null = t.payout ?? null;

    // Minimal auto-profit if missing (keeps your existing behavior stable):
    // - won: payout must exist to compute profit, otherwise keep existing profit
    // - lost: profit = -stake
    // - push/void: profit = 0
    if (status === "lost") profit = -Number(t.stake || 0);
    if (status === "push" || status === "void") profit = 0;

    const patch: any = {
      status,
      profit,
      payout,
      settled_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("tickets").update(patch).eq("id", t.id);
    setQuickUpdatingId(null);

    if (error) {
      alert(error.message);
      return;
    }
    await loadTicketsAndLegs();
  }

  // ---------- Date range (Overview) ----------
  const range = useMemo(() => {
    const now = new Date();
    const today = yyyyMmDd(now);

    if (preset === "ALL") return { start: null as string | null, end: null as string | null };

    if (preset === "CUSTOM") return { start: customStart, end: customEnd };

    if (preset === "7D") return { start: yyyyMmDd(addDays(now, -6)), end: today };

    if (preset === "30D") return { start: yyyyMmDd(addDays(now, -29)), end: today };

    if (preset === "MTD") return { start: yyyyMmDd(startOfMonth(now)), end: today };

    // LAST_MONTH
    const lastMonthEnd = lastDayOfPreviousMonth(now);
    const lastMonthStart = startOfMonth(lastMonthEnd);
    return { start: yyyyMmDd(lastMonthStart), end: yyyyMmDd(lastMonthEnd) };
  }, [preset, customStart, customEnd]);

  const ticketsFiltered = useMemo(() => {
    let out = tickets;

    if (leagueFilter !== "ALL") out = out.filter((t) => t.league === leagueFilter);

    if (range.start && range.end) {
      const startIso = toLocalMidnightIso(range.start);
      const endExclusiveIso = toLocalMidnightIso(yyyyMmDd(addDays(new Date(range.end + "T00:00:00"), 1)));
      out = out.filter((t) => t.placed_at >= startIso && t.placed_at < endExclusiveIso);
    }

    return out;
  }, [tickets, leagueFilter, range.start, range.end]);

  const settledTicketsInRange = useMemo(() => {
    return ticketsFiltered
      .filter((t) => t.status !== "open")
      .slice()
      .sort((a, b) => (a.placed_at < b.placed_at ? -1 : 1));
  }, [ticketsFiltered]);

  const openTicketsAll = useMemo(() => {
    return tickets.filter((t) => t.status === "open");
  }, [tickets]);

  const summary = useMemo(() => {
    const settled = settledTicketsInRange;

    let totalProfit = 0;
    let totalBet = 0;

    let won = 0;
    let lost = 0;
    let push = 0;
    let voided = 0;

    for (const t of settled) {
      totalBet += Number(t.stake || 0);
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      totalProfit += p;

      if (t.status === "won") won += 1;
      else if (t.status === "lost") lost += 1;
      else if (t.status === "push") push += 1;
      else if (t.status === "void") voided += 1;
    }

    const roi = totalBet > 0 ? (totalProfit / totalBet) * 100 : 0;
    const record = `${won}-${lost}${push ? `-${push}` : ""}${voided ? ` (V:${voided})` : ""}`;

    return { totalProfit: round2(totalProfit), totalBet: round2(totalBet), roi, record };
  }, [settledTicketsInRange]);

  const currentBankroll = useMemo(() => {
    // Starting bankroll + all-time profit on settled tickets
    let allTimeProfit = 0;
    for (const t of tickets) {
      if (t.status === "open") continue;
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      allTimeProfit += p;
    }
    return round2((Number(startingBankroll) || 0) + allTimeProfit);
  }, [tickets, startingBankroll]);

  const graphData = useMemo(() => {
    const rows: Array<{ date: string; Profit: number; Bankroll: number }> = [];
    let cumProfit = 0;
    let bankroll = Number(startingBankroll) || 0;

    for (const t of settledTicketsInRange) {
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      cumProfit += p;
      bankroll += p;
      rows.push({
        date: ticketDateForGrouping(t),
        Profit: round2(cumProfit),
        Bankroll: round2(bankroll),
      });
    }
    return rows;
  }, [settledTicketsInRange, startingBankroll]);

  // ---------- Calendar derived data ----------
  const calendarMonthStart = useMemo(() => startOfMonth(calendarMonth), [calendarMonth]);
  const calendarMonthEnd = useMemo(() => endOfMonth(calendarMonth), [calendarMonth]);

  const ticketsInCalendarMonth = useMemo(() => {
    const ym = `${calendarMonthStart.getFullYear()}-${String(calendarMonthStart.getMonth() + 1).padStart(2, "0")}`;
    return tickets.filter((t) => localDateKeyFromIso(t.placed_at).startsWith(ym));
  }, [tickets, calendarMonthStart]);

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of ticketsInCalendarMonth) {
      const day = localDateKeyFromIso(t.placed_at);
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      map.set(day, (map.get(day) ?? 0) + p);
    }
    return map;
  }, [ticketsInCalendarMonth]);

  const ticketsForSelectedDay = useMemo(() => {
    if (!selectedDay) return [];
    return tickets.filter((t) => localDateKeyFromIso(t.placed_at) === selectedDay);
  }, [tickets, selectedDay]);

  // ---------- Personal (Unit size + experience) ----------
  const unitCard = useMemo(() => {
    const now = new Date();
    const prevEnd = lastDayOfPreviousMonth(now);
    const prevEndDay = yyyyMmDd(prevEnd);
    const prevEndIsoExclusive = toLocalMidnightIso(yyyyMmDd(addDays(prevEnd, 1)));

    let profitThroughPrevEnd = 0;
    for (const t of tickets) {
      if (t.status === "open") continue;
      if (t.placed_at >= prevEndIsoExclusive) continue;
      const p = typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      profitThroughPrevEnd += p;
    }

    const prevMonthEndingBankroll = round2((Number(startingBankroll) || 0) + profitThroughPrevEnd);
    const unitSize = computeUnitSize(prevMonthEndingBankroll);

    return { prevEndDay, prevMonthEndingBankroll, unitSize };
  }, [tickets, startingBankroll]);

  const experience = useMemo(() => {
    if (!tickets.length) return null;
    const sorted = tickets.slice().sort((a, b) => (a.placed_at < b.placed_at ? -1 : 1));
    const first = new Date(sorted[0].placed_at);
    const now = new Date();
    return diffYMD(first, now);
  }, [tickets]);

  if (!authChecked) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm font-bold text-zinc-600">
          Checking session…
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm font-bold text-zinc-600">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black">Dashboard</div>
          <div className="mt-1 text-xs font-bold text-zinc-500">
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
            className="inline-flex h-10 items-center justify-center rounded-xl bg-black px-4 text-xs font-extrabold text-white"
          >
            + New
          </Link>
          <button
            type="button"
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

      {/* Tabs */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Pill active={tab === "OVERVIEW"} label="Overview" onClick={() => setTab("OVERVIEW")} />
        <Pill active={tab === "OPEN"} label="Open" onClick={() => setTab("OPEN")} />
        <Pill active={tab === "CALENDAR"} label="Calendar" onClick={() => setTab("CALENDAR")} />
        <Pill active={tab === "PERSONAL"} label="Personal" onClick={() => setTab("PERSONAL")} />
      </div>

      {/* Filters (OVERVIEW only) */}
      {tab === "OVERVIEW" ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="grid grid-cols-3 gap-2">
            <Pill active={preset === "MTD"} label="MTD" onClick={() => setPreset("MTD")} />
            <Pill active={preset === "7D"} label="7D" onClick={() => setPreset("7D")} />
            <Pill active={preset === "30D"} label="30D" onClick={() => setPreset("30D")} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Pill active={preset === "LAST_MONTH"} label="Last month" onClick={() => setPreset("LAST_MONTH")} />
            <Pill active={preset === "ALL"} label="All time" onClick={() => setPreset("ALL")} />
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

          <div className="grid grid-cols-[1fr_auto] gap-2">
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
              type="button"
              onClick={() => loadTicketsAndLegs()}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-extrabold"
            >
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      {/* OVERVIEW */}
      {tab === "OVERVIEW" ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card title="Current bankroll" subtitle="Starting bankroll + all-time profit">
              <div className="text-2xl font-black tabular-nums">${fmtMoney(currentBankroll)}</div>
            </Card>

            <Card title="Profit (range)" subtitle="Settled tickets only">
              <div
                className="text-2xl font-black tabular-nums"
                style={{ color: profitColor(summary.totalProfit) }}
              >
                ${fmtMoney(summary.totalProfit)}
              </div>
              <div className="mt-1 text-xs font-bold text-zinc-500">{summary.roi.toFixed(2)}% ROI</div>
            </Card>

            <Card title="Total bet (range)" subtitle="Settled tickets only">
              <div className="text-2xl font-black tabular-nums">${fmtMoney(summary.totalBet)}</div>
            </Card>

            <Card title="Record (range)" subtitle={`${fmtNumber(settledTicketsInRange.length)} settled tickets`}>
              <div className="text-2xl font-black">{summary.record}</div>
            </Card>
          </div>

          <Card title="Graph">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-extrabold text-zinc-600">
                {graphMode === "PROFIT" ? "Profit (Range)" : "Bankroll"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
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
                  type="button"
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

            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={graphData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoneyCompact(Number(v))} />
                  <Tooltip content={<CustomTooltip />} />
                  {graphMode === "BANKROLL" ? (
                    <>
                      <Area type="monotone" dataKey="Bankroll" fillOpacity={0.08} />
                      <Line type="monotone" dataKey="Bankroll" strokeWidth={2} dot={false} />
                    </>
                  ) : (
                    <>
                      <Area type="monotone" dataKey="Profit" fillOpacity={0.08} />
                      <Line type="monotone" dataKey="Profit" strokeWidth={2} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Tickets (range)">
            <TicketList
              tickets={ticketsFiltered}
              legsByTicket={legsByTicket}
              mode="LINK"
              quickUpdatingId={quickUpdatingId}
            />
          </Card>
        </div>
      ) : null}

      {/* OPEN */}
      {tab === "OPEN" ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-black">Open Tickets ({fmtNumber(openTicketsAll.length)})</div>
            <button
              type="button"
              onClick={() => loadTicketsAndLegs()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-extrabold"
            >
              Refresh
            </button>
          </div>

          <TicketList
            tickets={openTicketsAll}
            legsByTicket={legsByTicket}
            mode="PLAIN"
            quickUpdatingId={quickUpdatingId}
            onQuickSettle={quickSettle}
          />
        </div>
      ) : null}

      {/* CALENDAR */}
      {tab === "CALENDAR" ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                const prev = new Date(calendarMonthStart);
                prev.setMonth(prev.getMonth() - 1);
                setCalendarMonth(startOfMonth(prev));
                setSelectedDay(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold"
              aria-label="Previous month"
            >
              ←
            </button>

            {/* ✅ Clickable month/year (mobile-friendly jump) */}
            <button
              type="button"
              onClick={() => monthPickerRef.current?.click()}
              className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-black"
              title="Tap to jump to a month"
            >
              <span className="truncate">{monthLabel(calendarMonthStart)}</span>
            </button>

            <input
              ref={monthPickerRef}
              type="month"
              value={yyyyMm(calendarMonthStart)}
              onChange={(e) => {
                const v = e.target.value; // YYYY-MM
                if (!v) return;
                const d = new Date(v + "-01T00:00:00");
                setCalendarMonth(startOfMonth(d));
                setSelectedDay(null);
              }}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />

            <button
              type="button"
              onClick={() => {
                const next = new Date(calendarMonthStart);
                next.setMonth(next.getMonth() + 1);
                setCalendarMonth(startOfMonth(next));
                setSelectedDay(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-sm font-extrabold"
              aria-label="Next month"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 rounded-2xl border border-zinc-200 bg-white p-3">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-center text-[11px] font-extrabold text-zinc-500">
                {d}
              </div>
            ))}

            {buildCalendarGrid(calendarMonthStart).map((cell, idx) => {
              if (!cell.date) {
                return <div key={`empty-${idx}`} className="h-20 rounded-xl" />;
              }

              const key = yyyyMmDd(cell.date);
              const totalRaw = dayTotals.get(key) ?? 0;

              // ✅ Round to nearest whole dollar for calendar display
              const totalRounded = Math.round(totalRaw);

              const isSelected = selectedDay === key;
              const bg = profitFill(totalRounded);
              const fg = totalRounded === 0 ? "#666" : profitColor(totalRounded);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(key)}
                  className="h-20 rounded-xl border border-zinc-200 p-2 text-left"
                  style={{
                    backgroundColor: bg,
                    outline: isSelected ? "2px solid #111" : "none",
                    outlineOffset: 2,
                  }}
                >
                  <div className="flex h-full flex-col justify-between">
                    <div className="text-xs font-extrabold text-zinc-900">{cell.date.getDate()}</div>

                    {/* ✅ Prevent bleed: single-line, truncated, tabular nums */}
                    <div
                      className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-black leading-none tabular-nums"
                      style={{ color: fg }}
                      title={totalRounded === 0 ? "" : `$${fmtMoney0(totalRounded)}`}
                    >
                      {totalRounded === 0 ? "—" : `$${fmtMoney0(totalRounded)}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDay ? (
            <Card title={`Bets on ${selectedDay}`}>
              <div className="mb-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-extrabold"
                >
                  Close
                </button>
              </div>

              <TicketList
                tickets={ticketsForSelectedDay}
                legsByTicket={legsByTicket}
                mode="LINK"
                quickUpdatingId={quickUpdatingId}
              />
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* PERSONAL */}
      {tab === "PERSONAL" ? (
        <div className="mt-4 space-y-4">
          <Card title="Account" subtitle="Your data is tied to your Supabase session.">
            <div className="text-sm font-extrabold">{userEmail || "—"}</div>
          </Card>

          <Card title="Starting bankroll">
            {profileLoading ? (
              <div className="text-sm font-bold text-zinc-500">Loading…</div>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="number"
                  value={startingBankroll}
                  onChange={(e) => setStartingBankroll(Number(e.target.value))}
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base font-bold"
                />
                <button
                  type="button"
                  onClick={saveStartingBankroll}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-extrabold text-white disabled:opacity-60"
                  disabled={profileSaving}
                >
                  {profileSaving ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </Card>

          <Card title="Suggested unit size" subtitle={`Previous month end: ${unitCard.prevEndDay}`}>
            <div className="text-2xl font-black tabular-nums">${fmtMoney(unitCard.unitSize)}</div>
            <div className="mt-2 text-xs font-bold text-zinc-600">
              Based on ending bankroll <span className="font-black">${fmtMoney(unitCard.prevMonthEndingBankroll)}</span>{" "}
              (previous month end).
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Calculation: 5% of the ending bankroll, rounded down to the nearest $50, with a maximum of $10,000.
            </div>
          </Card>

          <Card title="Experience">
            {experience ? (
              <div className="text-lg font-black">
                {experience.years}y {experience.months}m {experience.days}d
              </div>
            ) : (
              <div className="text-sm font-bold text-zinc-500">
                Add your first ticket to start tracking experience.
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {/* Bottom App Tabs (optional) */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2 p-3">
          <button
            type="button"
            onClick={() => setTab("OVERVIEW")}
            className="h-10 rounded-xl border border-zinc-200 text-xs font-extrabold"
            style={{ background: tab === "OVERVIEW" ? "#111" : "white", color: tab === "OVERVIEW" ? "white" : "#111" }}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setTab("OPEN")}
            className="h-10 rounded-xl border border-zinc-200 text-xs font-extrabold"
            style={{ background: tab === "OPEN" ? "#111" : "white", color: tab === "OPEN" ? "white" : "#111" }}
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => setTab("CALENDAR")}
            className="h-10 rounded-xl border border-zinc-200 text-xs font-extrabold"
            style={{ background: tab === "CALENDAR" ? "#111" : "white", color: tab === "CALENDAR" ? "white" : "#111" }}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setTab("PERSONAL")}
            className="h-10 rounded-xl border border-zinc-200 text-xs font-extrabold"
            style={{ background: tab === "PERSONAL" ? "#111" : "white", color: tab === "PERSONAL" ? "white" : "#111" }}
          >
            Personal
          </button>
        </div>
      </div>
    </div>
  );
}