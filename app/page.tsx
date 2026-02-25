"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
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

function profitColor(n: number) {
  if (n > 0) return "#0f7a2a";
  if (n < 0) return "#b00020";
  return "#111";
}

function ticketDateForGrouping(t: Ticket) {
  // Use settled_at if available, else placed_at
  const iso = t.settled_at ?? t.placed_at;
  const d = new Date(iso);
  return yyyyMmDd(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  // League filter
  const [leagueFilter, setLeagueFilter] = useState<string>("ALL");

  // Date filter
  const [preset, setPreset] = useState<DatePreset>("MTD"); // ✅ DEFAULT = MTD
  const [customStart, setCustomStart] = useState<string>(() =>
    yyyyMmDd(addDays(new Date(), -29))
  );
  const [customEnd, setCustomEnd] = useState<string>(() => yyyyMmDd(new Date()));

  useEffect(() => {
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
  }, []);

  const { rangeStart, rangeEndInclusive } = useMemo(() => {
    const now = new Date();
    if (preset === "ALL") {
      return {
        rangeStart: null as string | null,
        rangeEndInclusive: null as string | null,
      };
    }
    if (preset === "CUSTOM") {
      return {
        rangeStart: customStart || null,
        rangeEndInclusive: customEnd || null,
      };
    }
    if (preset === "7D") {
      return {
        rangeStart: yyyyMmDd(addDays(now, -6)),
        rangeEndInclusive: yyyyMmDd(now),
      };
    }
    if (preset === "30D") {
      return {
        rangeStart: yyyyMmDd(addDays(now, -29)),
        rangeEndInclusive: yyyyMmDd(now),
      };
    }
    if (preset === "MTD") {
      return {
        rangeStart: yyyyMmDd(startOfMonth(now)),
        rangeEndInclusive: yyyyMmDd(now),
      };
    }
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

    // Inclusive end date: add 1 day at midnight and use < endExclusive
    const endExclusiveIso = rangeEndInclusive
      ? toLocalMidnightIso(
          yyyyMmDd(addDays(new Date(rangeEndInclusive + "T00:00:00"), 1))
        )
      : null;

    return tickets.filter((t) => {
      const passLeague =
        leagueFilter === "ALL" ? true : (t.league ?? "") === leagueFilter;

      const baseIso = t.settled_at ?? t.placed_at;

      const passStart = !startIso ? true : baseIso >= startIso;
      const passEnd = !endExclusiveIso ? true : baseIso < endExclusiveIso;

      return passLeague && passStart && passEnd;
    });
  }, [tickets, leagueFilter, rangeStart, rangeEndInclusive]);

  const summary = useMemo(() => {
    let totalProfit = 0;
    let totalBet = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;

    for (const t of filteredTickets) {
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
  }, [filteredTickets]);

  const chartData = useMemo(() => {
    // Group by day, sum profits, then compute cumulative
    const map = new Map<string, number>();
    for (const t of filteredTickets) {
      const day = ticketDateForGrouping(t);
      const p =
        typeof t.profit === "number" && Number.isFinite(t.profit) ? t.profit : 0;
      map.set(day, (map.get(day) ?? 0) + p);
    }

    const days = Array.from(map.keys()).sort();
    let cum = 0;
    return days.map((d) => {
      cum += map.get(d) ?? 0;
      return { date: d, cumulativeProfit: round2(cum) };
    });
  }, [filteredTickets]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <Link href="/new">+ New Bet</Link>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 12,
          alignItems: "flex-end",
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>League</span>
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            style={{ padding: "6px 8px" }}
          >
            <option value="ALL">All</option>
            {LEAGUE_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Date Range</span>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
            style={{ padding: "6px 8px" }}
          >
            <option value="7D">Last 7 Days</option>
            <option value="30D">Last 30 Days</option>
            <option value="MTD">MTD</option>
            <option value="LAST_MONTH">Last Month</option>
            <option value="ALL">All-Time</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </label>

        {preset === "CUSTOM" && (
          <>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Start</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.7 }}>End</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ padding: "6px 8px" }}
              />
            </label>
          </>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 12,
          marginTop: 16,
        }}
      >
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total Profit</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: profitColor(summary.totalProfit),
            }}
          >
            {fmtMoney(summary.totalProfit)}
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Total Bet</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtMoney(summary.totalBet)}</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>ROI</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: profitColor(summary.roi),
            }}
          >
            {summary.roi.toFixed(2)}%
          </div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Record (W-L-P)</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{summary.record}</div>
        </div>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Cumulative Profit</div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="cumulativeProfit" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>Tickets</h2>

      <div style={{ display: "grid", gap: 10 }}>
        {filteredTickets.length === 0 && (
          <div style={{ opacity: 0.7 }}>No tickets in this filter.</div>
        )}

        {filteredTickets.map((t) => (
          <Link
            key={t.id}
            href={`/ticket/${t.id}`}
            style={{
              textDecoration: "none",
              color: "inherit",
              border: "1px solid #eee",
              borderRadius: 10,
              padding: 12,
              display: "block",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 800 }}>
                  {t.league ?? "—"} • {t.ticket_type.toUpperCase()} • {t.status.toUpperCase()}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Date: {ticketDateForGrouping(t)} • Book: {t.book ?? "—"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Bet: {fmtMoney(t.stake)}
                  {typeof t.payout === "number" ? ` • Payout: ${fmtMoney(t.payout)}` : ""}
                </div>
              </div>

              <div style={{ textAlign: "right", minWidth: 120 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Profit</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 900,
                    color: typeof t.profit === "number" ? profitColor(t.profit) : "#111",
                  }}
                >
                  {typeof t.profit === "number" ? fmtMoney(t.profit) : "—"}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}