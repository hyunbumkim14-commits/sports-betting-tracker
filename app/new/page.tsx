/* =========================================================
   PASTE THIS FILE AT:
   /app/new/page.tsx
   ========================================================= */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type LegDraft = {
  selection: string;
  american_odds: string; // string while editing
  status: "open" | "won" | "lost" | "push" | "void";
};

function todayYyyyMmDd() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) throw new Error("Invalid American odds");
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function NewTicketPage() {
  const [ticketType, setTicketType] = useState<"single" | "parlay">("single");

  // ✅ Bet Mode
  const [betMode, setBetMode] = useState<"risk" | "towin">("risk");

  // store as strings so the user can clear the input without NaN fights
  const [betInput, setBetInput] = useState<string>("50"); // stake / risk
  const [toWinInput, setToWinInput] = useState<string>(""); // profit target

  const [book, setBook] = useState<string>("");
  const [league, setLeague] = useState<string>("");

  const [placedDate, setPlacedDate] = useState<string>(() => todayYyyyMmDd());

  const [ticketStatus, setTicketStatus] = useState<
    "open" | "won" | "lost" | "push" | "void" | "partial"
  >("open");

  const [actualPayout, setActualPayout] = useState<number | "">("");

  const [legs, setLegs] = useState<LegDraft[]>([
    { selection: "", american_odds: "-110", status: "open" },
  ]);

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
    const statusToStore =
      ticketType === "parlay" ? (derivedParlayStatus as any) : ticketStatus;
    const leagueToStore = league.trim() === "" ? null : league.trim();

    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .insert({
        user_id: user.id,
        ticket_type: ticketType,
        stake: stakeNum,
        book: book || null,
        league: leagueToStore,
        status: statusToStore,
        placed_at: placedAtIso,
        payout: actualPayout === "" ? null : Number(actualPayout),
      })
      .select("id")
      .single();

    if (ticketErr) {
      console.error("Ticket insert failed:", ticketErr);
      alert(`Error saving ticket: ${ticketErr.message}`);
      return;
    }

    const { error: legsErr } = await supabase.from("legs").insert(
      legs.map((l) => ({
        ticket_id: ticket.id,
        selection: l.selection,
        american_odds: Number(l.american_odds),
        status: l.status,
      }))
    );

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
                  setLegs([{ selection: "", american_odds: "-110", status: "open" }]);
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
                    // when switching to risk, keep current stake and compute toWin
                    setToWinFromRisk(betInput);
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
                    // when switching to toWin, keep current toWin and compute stake
                    setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                  }}
                />
                <span style={{ fontWeight: 800 }}>To Win (Profit)</span>
              </label>

              <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
                {multiplierValid ? (
                  <>Multiplier: <b>{round2(multiplier).toFixed(2)}</b></>
                ) : (
                  <>Multiplier: <b>—</b></>
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
                else setBetInput(next); // allow viewing/editing even if not active
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

                    // keep the paired field synced when odds change
                    // (only when multiplier is valid after this change, which is recalculated via useMemo)
                    // We'll trigger recompute in a tiny next tick by using current betMode + existing inputs.
                    // This is safe and avoids useEffect loops.
                    setTimeout(() => {
                      if (betMode === "risk") setToWinFromRisk(betInput);
                      else setRiskFromToWin(toWinInput);
                    }, 0);
                  }}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Leg Status</FieldLabel>
                <select
                  value={leg.status}
                  onChange={(e) => {
                    const copy = [...legs];
                    copy[idx] = { ...copy[idx], status: e.target.value as any };
                    setLegs(copy);

                    setTimeout(() => {
                      if (betMode === "risk") setToWinFromRisk(betInput);
                      else setRiskFromToWin(toWinInput);
                    }, 0);
                  }}
                  style={selectStyle}
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