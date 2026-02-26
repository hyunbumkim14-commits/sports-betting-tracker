/* =========================================================
   PASTE THIS FILE AT:
   /app/new/page.tsx
   ========================================================= */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type TicketStatus = "open" | "won" | "lost" | "push" | "void" | "partial";

type LegDraft = {
  selection: string;
  american_odds: string; // string while editing
  status: "open" | "won" | "lost" | "push" | "void";
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayYyyyMmDd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function yyyyMmDd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function lastDayOfPreviousMonth(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), 0);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) throw new Error("Invalid American odds");
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function computeUnitSize(prevMonthEndingBankroll: number) {
  // 1) 5%
  const raw = prevMonthEndingBankroll * 0.05;

  // 2) round down to nearest $50
  const roundedDown = Math.floor(raw / 50) * 50;

  // guard if negative bankroll
  const nonNegative = Math.max(0, roundedDown);

  // 3) cap at 10k
  return Math.min(10_000, nonNegative);
}

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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.75, marginBottom: 6 }}>
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
  background: "#fff",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d9d9d9",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#fff",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
  gap: 12,
};

function mapTicketStatusToLegStatus(s: TicketStatus): LegDraft["status"] {
  if (s === "won") return "won";
  if (s === "lost") return "lost";
  if (s === "push") return "push";
  if (s === "void") return "void";
  // open / partial -> leg open
  return "open";
}

export default function NewTicketPage() {
  const [ticketType, setTicketType] = useState<"single" | "parlay">("single");

  // ✅ Default bet mode = To Win (Profit)
  const [betMode, setBetMode] = useState<"risk" | "towin">("towin");

  // store as strings so the user can clear the input without NaN fights
  const [betInput, setBetInput] = useState<string>(""); // stake / risk
  const [toWinInput, setToWinInput] = useState<string>(""); // profit target

  // ✅ Default book = Bovada
  const [book, setBook] = useState<string>("Bovada");
  const [league, setLeague] = useState<string>("");

  const [placedDate, setPlacedDate] = useState<string>(() => todayYyyyMmDd());

  const [ticketStatus, setTicketStatus] = useState<TicketStatus>("open");

  const [actualPayout, setActualPayout] = useState<number | "">("");

  const [legs, setLegs] = useState<LegDraft[]>([
    { selection: "", american_odds: "-110", status: "open" },
  ]);

  // Unit seeding (1 unit -> toWin)
  const [unitLoading, setUnitLoading] = useState<boolean>(true);
  const [unitSize, setUnitSize] = useState<number>(0);
  const [seededDefaults, setSeededDefaults] = useState<boolean>(false);

  const canAddLeg = ticketType === "parlay";
  const addLeg = () =>
    setLegs([...legs, { selection: "", american_odds: "-110", status: "open" }]);
  const removeLeg = (idx: number) => setLegs(legs.filter((_, i) => i !== idx));

  // ✅ derive decimal multiplier for the ticket (single or parlay)
  const { multiplier, multiplierValid } = useMemo(() => {
    try {
      if (ticketType === "single") {
        if (legs.length !== 1) return { multiplier: 1, multiplierValid: false };
        const a = Number(legs[0].american_odds);
        if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
        return { multiplier: americanToDecimal(a), multiplierValid: true };
      }

      // parlay: product of decimals (treat push/void as 1)
      if (legs.length < 2) return { multiplier: 1, multiplierValid: false };

      let m = 1;
      for (const l of legs) {
        if (l.status === "push" || l.status === "void") continue;
        const a = Number(l.american_odds);
        if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
        m *= americanToDecimal(a);
      }
      return { multiplier: m, multiplierValid: m > 1 };
    } catch {
      return { multiplier: 1, multiplierValid: false };
    }
  }, [ticketType, legs]);

  const derivedParlayStatus = useMemo(() => {
    if (ticketType !== "parlay") return null;
    if (legs.some((l) => l.status === "lost")) return "lost";
    const allSettled = legs.every((l) => l.status !== "open");
    if (!allSettled) return "open";
    const allVoidOrPush = legs.every((l) => l.status === "void" || l.status === "push");
    if (allVoidOrPush) return "push";
    if (legs.some((l) => l.status === "won")) return "won";
    return "push";
  }, [ticketType, legs]);

  function setRiskFromToWin(nextToWinStr: string) {
    setToWinInput(nextToWinStr);

    const desiredProfit = Number(nextToWinStr);
    if (!multiplierValid || !Number.isFinite(desiredProfit) || desiredProfit < 0) return;

    // profit = stake * (multiplier - 1)  => stake = profit / (multiplier - 1)
    const denom = multiplier - 1;
    if (denom <= 0) return;

    const stake = desiredProfit / denom;
    setBetInput(String(round2(stake)));
  }

  function setToWinFromRisk(nextRiskStr: string) {
    setBetInput(nextRiskStr);

    const stake = Number(nextRiskStr);
    if (!multiplierValid || !Number.isFinite(stake) || stake < 0) return;

    const profit = stake * (multiplier - 1);
    setToWinInput(String(round2(profit)));
  }

  // ✅ Single: leg status mirrors ticket status (and leg status control should effectively be disabled)
  useEffect(() => {
    if (ticketType !== "single") return;
    setLegs((prev) => {
      if (prev.length !== 1) return [{ selection: "", american_odds: "-110", status: mapTicketStatusToLegStatus(ticketStatus) }];
      const next = [...prev];
      next[0] = { ...next[0], status: mapTicketStatusToLegStatus(ticketStatus) };
      return next;
    });
  }, [ticketType, ticketStatus]);

  // ✅ Fetch Unit Size (same logic as dashboard) so To Win defaults to 1 unit
  useEffect(() => {
    let alive = true;

    async function loadUnit() {
      setUnitLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (alive) setUnitLoading(false);
        return;
      }

      // 1) starting bankroll
      const { data: prof } = await supabase
        .from("profiles")
        .select("starting_bankroll")
        .eq("id", uid)
        .single();

      const startingBankroll = Number(prof?.starting_bankroll) || 0;

      // 2) realized profit up to end of previous month (based on placed_at)
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

      const { data: tix, error: tixErr } = await supabase
        .from("tickets")
        .select("profit, placed_at")
        .lt("placed_at", prevMonthEndIsoExclusive);

      if (tixErr) {
        console.error(tixErr);
      }

      const realizedProfit = (tix ?? []).reduce((acc: number, t: any) => {
        const p = t?.profit;
        if (typeof p === "number" && Number.isFinite(p)) return acc + p;
        return acc;
      }, 0);

      const prevMonthEndingBankroll = round2(startingBankroll + realizedProfit);
      const u = computeUnitSize(prevMonthEndingBankroll);

      if (!alive) return;

      setUnitSize(u);
      setUnitLoading(false);

      // Seed default values once:
      // - Mode: towin (already)
      // - ToWin: 1 unit
      // - Stake derived from odds
      if (!seededDefaults) {
        const toWin = String(round2(u));
        setToWinInput(toWin);

        // compute stake immediately (even if multiplierValid isn't ready, try next tick too)
        setTimeout(() => setRiskFromToWin(toWin), 0);

        setSeededDefaults(true);
      }
    }

    loadUnit();

    return () => {
      alive = false;
    };
  }, [seededDefaults]);

  function computePayoutProfitForCreate(args: {
    ticketType: "single" | "parlay";
    stake: number;
    statusToStore: TicketStatus;
    legs: LegDraft[];
    payoutOverride: number | null;
    derivedParlayStatus: "open" | "won" | "lost" | "push" | "void" | null;
  }): { payout: number | null; profit: number | null; settled_at: string | null } {
    const { ticketType, stake, statusToStore, legs, payoutOverride, derivedParlayStatus } = args;

    // If payout override provided, always store it + profit immediately
    if (typeof payoutOverride === "number" && Number.isFinite(payoutOverride)) {
      const payout = round2(payoutOverride);
      const profit = round2(payout - stake);
      return { payout, profit, settled_at: statusToStore === "open" ? null : "SET_NOW" };
    }

    if (ticketType === "single") {
      if (statusToStore === "open" || statusToStore === "partial") return { payout: null, profit: null, settled_at: null };
      if (statusToStore === "push" || statusToStore === "void")
        return { payout: round2(stake), profit: 0, settled_at: "SET_NOW" };
      if (statusToStore === "lost")
        return { payout: 0, profit: round2(0 - stake), settled_at: "SET_NOW" };
      if (statusToStore === "won") {
        const a = Number(legs[0]?.american_odds);
        const dec = americanToDecimal(a);
        const payout = round2(stake * dec);
        const profit = round2(payout - stake);
        return { payout, profit, settled_at: "SET_NOW" };
      }
      return { payout: null, profit: null, settled_at: null };
    }

    // parlay
    const pStatus = (derivedParlayStatus ?? "open") as TicketStatus;
    if (pStatus === "open") return { payout: null, profit: null, settled_at: null };
    if (pStatus === "push" || pStatus === "void")
      return { payout: round2(stake), profit: 0, settled_at: "SET_NOW" };
    if (pStatus === "lost")
      return { payout: 0, profit: round2(0 - stake), settled_at: "SET_NOW" };
    if (pStatus === "won") {
      const winMultiplier = legs.reduce((acc, l) => {
        if (l.status === "push" || l.status === "void") return acc * 1;
        const dec = americanToDecimal(Number(l.american_odds));
        return acc * dec;
      }, 1);
      const payout = round2(stake * winMultiplier);
      const profit = round2(payout - stake);
      return { payout, profit, settled_at: "SET_NOW" };
    }
    return { payout: null, profit: null, settled_at: null };
  }

  async function save() {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      alert("Not logged in. Go to /login.");
      return;
    }

    if (!placedDate) {
      alert("Please select a date.");
      return;
    }

    if (!league.trim()) {
      alert("Please select a league.");
      return;
    }

    if (legs.some((l) => !l.selection.trim())) {
      alert("Please fill all selections.");
      return;
    }

    if (ticketType === "single" && legs.length !== 1) {
      alert("Single must have exactly 1 leg.");
      return;
    }

    if (ticketType === "parlay" && legs.length < 2) {
      alert("Parlay must have 2+ legs.");
      return;
    }

    if (
      legs.some((l) => {
        const n = Number(l.american_odds);
        return !Number.isFinite(n) || n === 0;
      })
    ) {
      alert("Invalid odds detected.");
      return;
    }

    const stakeNum = Number(betInput);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      alert("Please enter a valid bet amount.");
      return;
    }

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();

    const statusToStore: TicketStatus =
      ticketType === "parlay"
        ? ((derivedParlayStatus as any) ?? "open")
        : ticketStatus;

    const leagueToStore = league.trim() === "" ? null : league.trim();

    // ✅ Compute payout/profit NOW so dashboard updates immediately
    const payoutOverride =
      actualPayout === "" ? null : Number(actualPayout);

    const computed = computePayoutProfitForCreate({
      ticketType,
      stake: stakeNum,
      statusToStore,
      legs,
      payoutOverride,
      derivedParlayStatus: derivedParlayStatus as any,
    });

    const settledAtIso =
      computed.settled_at === "SET_NOW"
        ? placedAtIso
        : null;

    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .insert({
        user_id: user.id,
        ticket_type: ticketType,
        stake: stakeNum,
        book: book.trim() === "" ? null : book.trim(),
        league: leagueToStore,
        status: statusToStore,
        placed_at: placedAtIso,
        payout: computed.payout,
        profit: computed.profit,
        settled_at: settledAtIso,
      })
      .select("id")
      .single();

    if (ticketErr) {
      console.error("Ticket insert failed:", ticketErr);
      alert(`Error saving ticket: ${ticketErr.message}`);
      return;
    }

    // ✅ Single: leg status mirrors ticket status (no separate editing)
    const legsToInsert =
      ticketType === "single"
        ? legs.map((l) => ({
            ticket_id: ticket.id,
            selection: l.selection,
            american_odds: Number(l.american_odds),
            status: mapTicketStatusToLegStatus(statusToStore),
          }))
        : legs.map((l) => ({
            ticket_id: ticket.id,
            selection: l.selection,
            american_odds: Number(l.american_odds),
            status: l.status,
          }));

    const { error: legsErr } = await supabase.from("legs").insert(legsToInsert);

    if (legsErr) {
      console.error(legsErr);
      alert("Ticket saved, but legs failed to save.");
      return;
    }

    window.location.href = "/";
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 980, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Create</div>
          <h1 style={{ margin: 0, fontSize: 28 }}>New Bet</h1>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            Default To Win:{" "}
            <b>{unitLoading ? "Loading unit…" : `${unitSize.toFixed(2)} (1 Unit)`}</b>
          </div>
        </div>
        <Link
          href="/"
          style={{
            textDecoration: "none",
            border: "1px solid #ddd",
            padding: "10px 12px",
            borderRadius: 10,
            fontWeight: 800,
            color: "#111",
            background: "#fff",
          }}
        >
          Home
        </Link>
      </div>

      {/* Ticket Info */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 12 }}>Ticket</div>

        <div style={rowStyle}>
          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Type</FieldLabel>
            <select
              value={ticketType}
              onChange={(e) => {
                const next = e.target.value as "single" | "parlay";
                setTicketType(next);
                if (next === "single") {
                  setLegs([{ selection: "", american_odds: "-110", status: mapTicketStatusToLegStatus(ticketStatus) }]);
                }
              }}
              style={selectStyle}
            >
              <option value="single">Single</option>
              <option value="parlay">Parlay</option>
            </select>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>League</FieldLabel>
            <input
              list="league-options"
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              placeholder="Select or type…"
              style={inputStyle}
            />
            <datalist id="league-options">
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Date</FieldLabel>
            <input
              type="date"
              value={placedDate}
              onChange={(e) => setPlacedDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Book</FieldLabel>
            <input
              value={book}
              onChange={(e) => setBook(e.target.value)}
              placeholder="FanDuel, DK…"
              style={inputStyle}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Default: <b>Bovada</b>
            </div>
          </div>

          {/* ✅ Bet mode toggle */}
          <div style={{ gridColumn: "span 6" }}>
            <FieldLabel>Bet input mode</FieldLabel>
            <div style={{ display: "flex", gap: 10, alignItems: "center", height: 42 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="betMode"
                  checked={betMode === "risk"}
                  onChange={() => {
                    setBetMode("risk");
                    setToWinFromRisk(betInput === "" ? "0" : betInput);
                  }}
                />
                <span style={{ fontWeight: 800 }}>Risk (Stake)</span>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="betMode"
                  checked={betMode === "towin"}
                  onChange={() => {
                    setBetMode("towin");
                    setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                  }}
                />
                <span style={{ fontWeight: 800 }}>To Win (Profit)</span>
              </label>

              <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
                {multiplierValid ? (
                  <>
                    Multiplier: <b>{round2(multiplier).toFixed(2)}</b>
                  </>
                ) : (
                  <>
                    Multiplier: <b>—</b>
                  </>
                )}
              </div>
            </div>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Stake (Risk)</FieldLabel>
            <input
              type="number"
              value={betInput}
              min={0}
              step="0.01"
              onChange={(e) => {
                const next = e.target.value;
                if (betMode === "risk") setToWinFromRisk(next);
                else setBetInput(next);
              }}
              style={{
                ...inputStyle,
                opacity: betMode === "risk" ? 1 : 0.85,
              }}
            />
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>To Win (Profit)</FieldLabel>
            <input
              type="number"
              value={toWinInput}
              min={0}
              step="0.01"
              onChange={(e) => {
                const next = e.target.value;
                if (betMode === "towin") setRiskFromToWin(next);
                else setToWinInput(next);
              }}
              placeholder={betMode === "towin" ? "" : "Auto (switch to To Win)"}
              style={{
                ...inputStyle,
                opacity: betMode === "towin" ? 1 : 0.85,
              }}
            />
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Tip: set <b>To Win</b> = 1 unit
            </div>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Status</FieldLabel>
            <select
              value={ticketStatus}
              onChange={(e) => setTicketStatus(e.target.value as any)}
              disabled={ticketType === "parlay"}
              style={{
                ...selectStyle,
                opacity: ticketType === "parlay" ? 0.6 : 1,
                cursor: ticketType === "parlay" ? "not-allowed" : "pointer",
              }}
            >
              <option value="open">open</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="push">push</option>
              <option value="void">void</option>
              <option value="partial">partial</option>
            </select>
            {ticketType === "parlay" && (
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                Derived: <b>{derivedParlayStatus}</b>
              </div>
            )}
          </div>

          <div style={{ gridColumn: "span 6" }}>
            <FieldLabel>Actual payout (optional)</FieldLabel>
            <input
              type="number"
              value={actualPayout}
              min={0}
              step="0.01"
              onChange={(e) => setActualPayout(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Total return incl. bet"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 900 }}>Legs</div>
          {canAddLeg && (
            <button
              onClick={addLeg}
              style={{
                border: "1px solid #ddd",
                background: "#fff",
                padding: "10px 12px",
                borderRadius: 10,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              + Add Leg
            </button>
          )}
        </div>

        {ticketType === "single" && (
          <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.7 }}>
            Single bet: leg status is <b>synced to ticket status</b>.
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {legs.map((leg, idx) => (
            <div
              key={idx}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr 140px 140px 90px",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div>
                <FieldLabel>{ticketType === "single" ? "Selection" : `Leg ${idx + 1} Selection`}</FieldLabel>
                <input
                  value={leg.selection}
                  onChange={(e) => {
                    const copy = [...legs];
                    copy[idx] = { ...copy[idx], selection: e.target.value };
                    setLegs(copy);
                  }}
                  placeholder={ticketType === "single" ? "e.g. Lakers -2.5" : "Leg selection"}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Odds</FieldLabel>
                <input
                  type="text"
                  inputMode="numeric"
                  value={leg.american_odds}
                  onChange={(e) => {
                    const copy = [...legs];
                    copy[idx] = { ...copy[idx], american_odds: e.target.value };
                    setLegs(copy);

                    setTimeout(() => {
                      if (betMode === "risk") setToWinFromRisk(betInput === "" ? "0" : betInput);
                      else setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                    }, 0);
                  }}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Leg Status</FieldLabel>
                <select
                  value={leg.status}
                  disabled={ticketType === "single"}
                  onChange={(e) => {
                    const copy = [...legs];
                    copy[idx] = { ...copy[idx], status: e.target.value as any };
                    setLegs(copy);

                    setTimeout(() => {
                      if (betMode === "risk") setToWinFromRisk(betInput === "" ? "0" : betInput);
                      else setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                    }, 0);
                  }}
                  style={{
                    ...selectStyle,
                    opacity: ticketType === "single" ? 0.6 : 1,
                    cursor: ticketType === "single" ? "not-allowed" : "pointer",
                  }}
                >
                  <option value="open">open</option>
                  <option value="won">won</option>
                  <option value="lost">lost</option>
                  <option value="push">push</option>
                  <option value="void">void</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {canAddLeg && legs.length > 2 ? (
                  <button
                    onClick={() => removeLeg(idx)}
                    style={{
                      border: "1px solid #f1c0c0",
                      background: "#fff",
                      padding: "10px 12px",
                      borderRadius: 10,
                      fontWeight: 800,
                      cursor: "pointer",
                      color: "#b00020",
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <div style={{ height: 42 }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom actions */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 14,
          paddingTop: 12,
          paddingBottom: 12,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(6px)",
          borderTop: "1px solid #eee",
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
        }}
      >
        <Link
          href="/"
          style={{
            textDecoration: "none",
            border: "1px solid #ddd",
            background: "#fff",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 900,
            color: "#111",
          }}
        >
          Cancel
        </Link>

        <button
          onClick={save}
          style={{
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}