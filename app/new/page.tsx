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

export default function NewTicketPage() {
  const [ticketType, setTicketType] = useState<"single" | "parlay">("single");
  const [bet, setBet] = useState<number>(50);
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

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const statusToStore = ticketType === "parlay" ? (derivedParlayStatus as any) : ticketStatus;
    const leagueToStore = league.trim() === "" ? null : league.trim();

    const { data: ticket, error: ticketErr } = await supabase
      .from("tickets")
      .insert({
        user_id: user.id,
        ticket_type: ticketType,
        stake: bet,
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

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Bet</FieldLabel>
            <input
              type="number"
              value={bet}
              min={0}
              step="0.01"
              onChange={(e) => setBet(Number(e.target.value))}
              style={inputStyle}
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