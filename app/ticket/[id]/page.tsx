/* =========================================================
   PASTE THIS FILE AT:
   /app/ticket/[id]/page.tsx
   ========================================================= */

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type Ticket = {
  id: string;
  placed_at: string;
  settled_at: string | null;
  ticket_type: "single" | "parlay";
  stake: number;
  status: "open" | "won" | "lost" | "push" | "void" | "partial";
  book: string | null;
  payout: number | null;
  profit: number | null;
  notes: string | null;
  league: string | null;
};

type TicketStatus = Ticket["status"];
type ParlayStatus = Exclude<TicketStatus, "partial">;

type Leg = {
  id: string;
  selection: string;
  american_odds: number;
  status: "open" | "won" | "lost" | "push" | "void";
  notes: string | null;
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

function isoToYyyyMmDd(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error("Invalid American odds");
  }
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function profitColor(n: number) {
  if (n > 0) return "#0f7a2a";
  if (n < 0) return "#b00020";
  return "#111";
}

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

export default function TicketPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);

  // Editable fields
  const [placedDate, setPlacedDate] = useState<string>("");
  const [book, setBook] = useState<string>("");
  const [league, setLeague] = useState<string>("");

  // ✅ Bet Mode + inputs (strings to avoid NaN / clearing issues)
  const [betMode, setBetMode] = useState<"risk" | "towin">("risk");
  const [betInput, setBetInput] = useState<string>("0"); // stake / risk
  const [toWinInput, setToWinInput] = useState<string>(""); // profit target

  // Singles status
  const [singleStatus, setSingleStatus] = useState<TicketStatus>("open");

  // Payout override input (only override if edited)
  const [payoutInput, setPayoutInput] = useState<string>("");
  const [payoutEdited, setPayoutEdited] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: t, error: tErr } = await supabase
        .from("tickets")
        .select(
          "id, placed_at, settled_at, ticket_type, stake, status, book, payout, profit, notes, league"
        )
        .eq("id", id)
        .single();

      if (tErr) {
        console.error(tErr);
        alert("Ticket not found.");
        router.push("/");
        return;
      }

      const { data: l, error: lErr } = await supabase
        .from("legs")
        .select("id, selection, american_odds, status, notes")
        .eq("ticket_id", id)
        .order("id", { ascending: true });

      if (lErr) {
        console.error(lErr);
        alert("Error loading legs.");
        router.push("/");
        return;
      }

      const ticketRow = t as Ticket;

      setTicket(ticketRow);
      setLegs((l ?? []) as Leg[]);

      setPlacedDate(isoToYyyyMmDd(ticketRow.placed_at));
      setBook(ticketRow.book ?? "");
      setLeague(ticketRow.league ?? "");

      // ✅ stake as string input
      setBetInput(String(ticketRow.stake ?? 0));

      setSingleStatus(ticketRow.status);

      setPayoutInput(ticketRow.payout === null ? "" : String(ticketRow.payout));
      setPayoutEdited(false);

      setLoading(false);
    }

    if (id) load();
  }, [id, router]);

  const derivedParlayStatus = useMemo<ParlayStatus | null>(() => {
    if (!ticket || ticket.ticket_type !== "parlay") return null;

    if (legs.some((l) => l.status === "lost")) return "lost";

    const allSettled = legs.every((l) => l.status !== "open");
    if (!allSettled) return "open";

    const allVoidOrPush = legs.every((l) => l.status === "void" || l.status === "push");
    if (allVoidOrPush) return "push";

    if (legs.some((l) => l.status === "won")) return "won";

    return "push";
  }, [ticket, legs]);

  // ✅ Effective multiplier used for To Win calc (single = its leg; parlay = product; push/void = 1)
  const { multiplier, multiplierValid } = useMemo(() => {
    try {
      if (!ticket) return { multiplier: 1, multiplierValid: false };

      if (ticket.ticket_type === "single") {
        if (legs.length !== 1) return { multiplier: 1, multiplierValid: false };
        const a = legs[0].american_odds;
        if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
        return { multiplier: americanToDecimal(a), multiplierValid: true };
      }

      // parlay
      if (legs.length < 2) return { multiplier: 1, multiplierValid: false };

      let m = 1;
      for (const l of legs) {
        if (l.status === "push" || l.status === "void") continue;
        const a = l.american_odds;
        if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
        m *= americanToDecimal(a);
      }
      return { multiplier: m, multiplierValid: m > 1 };
    } catch {
      return { multiplier: 1, multiplierValid: false };
    }
  }, [ticket, legs]);

  function setToWinFromRisk(nextRiskStr: string) {
    setBetInput(nextRiskStr);

    const stake = Number(nextRiskStr);
    if (!multiplierValid || !Number.isFinite(stake) || stake < 0) return;

    const profit = stake * (multiplier - 1);
    setToWinInput(String(round2(profit)));
  }

  function setRiskFromToWin(nextToWinStr: string) {
    setToWinInput(nextToWinStr);

    const desiredProfit = Number(nextToWinStr);
    if (!multiplierValid || !Number.isFinite(desiredProfit) || desiredProfit < 0) return;

    const denom = multiplier - 1;
    if (denom <= 0) return;

    const stake = desiredProfit / denom;
    setBetInput(String(round2(stake)));
  }

  // ✅ Keep paired field synced when multiplier changes (e.g. leg status changes)
  useEffect(() => {
    if (!multiplierValid) return;
    if (betMode === "risk") setToWinFromRisk(betInput);
    else setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplier, multiplierValid]);

  const stakeNum = useMemo(() => {
    const n = Number(betInput);
    return Number.isFinite(n) ? n : 0;
  }, [betInput]);

  const computedPayoutProfit = useMemo(() => {
    if (!ticket) {
      return { payout: null as number | null, profit: null as number | null };
    }

    // Override only if user edited
    if (payoutEdited && payoutInput.trim() !== "") {
      const payoutNum = Number(payoutInput);
      if (Number.isFinite(payoutNum)) {
        const payout = round2(payoutNum);
        const profit = round2(payout - stakeNum);
        return { payout, profit };
      }
    }

    if (ticket.ticket_type === "single") {
      const status = singleStatus;

      if (status === "open") return { payout: null, profit: null };
      if (status === "push" || status === "void") return { payout: round2(stakeNum), profit: 0 };
      if (legs.length !== 1) return { payout: null, profit: null };
      if (status === "lost") return { payout: 0, profit: round2(0 - stakeNum) };

      const dec = americanToDecimal(legs[0].american_odds);
      const payout = round2(stakeNum * dec);
      const profit = round2(payout - stakeNum);
      return { payout, profit };
    }

    // parlay
    const pStatus: ParlayStatus = derivedParlayStatus ?? "open";

    if (pStatus === "open") return { payout: null, profit: null };
    if (pStatus === "push" || pStatus === "void") return { payout: round2(stakeNum), profit: 0 };
    if (pStatus === "lost") return { payout: 0, profit: round2(0 - stakeNum) };

    const winMultiplier = legs.reduce((acc, l) => {
      if (l.status === "push" || l.status === "void") return acc * 1;
      const dec = americanToDecimal(l.american_odds);
      return acc * dec;
    }, 1);

    const payout = round2(stakeNum * winMultiplier);
    const profit = round2(payout - stakeNum);
    return { payout, profit };
  }, [ticket, legs, stakeNum, singleStatus, derivedParlayStatus, payoutInput, payoutEdited]);

  async function saveTicketEdits() {
    if (!ticket) return;

    if (!placedDate) {
      alert("Please select a date.");
      return;
    }

    const stake = Number(betInput);
    if (!Number.isFinite(stake) || stake <= 0) {
      alert("Please enter a valid bet amount.");
      return;
    }

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const leagueToStore = league.trim() === "" ? null : league.trim();

    const statusToStore: TicketStatus =
      ticket.ticket_type === "parlay" ? (derivedParlayStatus ?? "open") : singleStatus;

    const { payout, profit } = computedPayoutProfit;

    const settledAtIso = statusToStore === "open" ? null : placedAtIso;

    const { error } = await supabase
      .from("tickets")
      .update({
        placed_at: placedAtIso,
        book: book.trim() === "" ? null : book.trim(),
        stake,
        league: leagueToStore,
        status: statusToStore,
        payout,
        profit,
        settled_at: settledAtIso,
      })
      .eq("id", ticket.id);

    if (error) {
      console.error(error);
      alert(`Failed to save: ${error.message}`);
      return;
    }

    setPayoutEdited(false);
    router.refresh();
    alert("Saved.");
  }

  async function saveLegStatus(legId: string, nextStatus: Leg["status"]) {
    const { error } = await supabase.from("legs").update({ status: nextStatus }).eq("id", legId);

    if (error) {
      console.error(error);
      alert("Failed to update leg.");
      return;
    }

    setLegs((prev) => prev.map((l) => (l.id === legId ? { ...l, status: nextStatus } : l)));
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!confirm("Delete this ticket? This cannot be undone.")) return;

    const { error: legErr } = await supabase.from("legs").delete().eq("ticket_id", ticket.id);
    if (legErr) {
      console.error(legErr);
      alert("Failed to delete legs.");
      return;
    }

    const { error: tErr } = await supabase.from("tickets").delete().eq("id", ticket.id);
    if (tErr) {
      console.error(tErr);
      alert("Failed to delete ticket.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!ticket) return <div style={{ padding: 24 }}>Not found.</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 980, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Ticket</div>
          <h1 style={{ margin: 0, fontSize: 28 }}>
            {ticket.league ?? "—"} • {ticket.ticket_type.toUpperCase()}
          </h1>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            ID:{" "}
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
              {ticket.id}
            </span>
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

      {/* Summary */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Computed Profit</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color:
                  computedPayoutProfit.profit === null ? "#111" : profitColor(computedPayoutProfit.profit),
              }}
            >
              {computedPayoutProfit.profit === null ? "—" : computedPayoutProfit.profit.toFixed(2)}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Computed Payout</div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>
              {computedPayoutProfit.payout === null ? "—" : computedPayoutProfit.payout.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Ticket fields */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 900, marginBottom: 12 }}>Details</div>

        <div style={rowStyle}>
          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Type</FieldLabel>
            <input value={ticket.ticket_type} disabled style={{ ...inputStyle, opacity: 0.7 }} />
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
            <input type="date" value={placedDate} onChange={(e) => setPlacedDate(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Book</FieldLabel>
            <input value={book} onChange={(e) => setBook(e.target.value)} placeholder="FanDuel, DK…" style={inputStyle} />
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
              style={{ ...inputStyle, opacity: betMode === "risk" ? 1 : 0.85 }}
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
              style={{ ...inputStyle, opacity: betMode === "towin" ? 1 : 0.85 }}
            />
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <FieldLabel>Status</FieldLabel>
            <select
              value={ticket.ticket_type === "parlay" ? (derivedParlayStatus ?? "open") : singleStatus}
              onChange={(e) => setSingleStatus(e.target.value as TicketStatus)}
              disabled={ticket.ticket_type === "parlay"}
              style={{
                ...selectStyle,
                opacity: ticket.ticket_type === "parlay" ? 0.65 : 1,
                cursor: ticket.ticket_type === "parlay" ? "not-allowed" : "pointer",
              }}
            >
              <option value="open">open</option>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="push">push</option>
              <option value="void">void</option>
              <option value="partial">partial</option>
            </select>

            {ticket.ticket_type === "parlay" && (
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                Derived: <b>{derivedParlayStatus ?? "open"}</b>
              </div>
            )}
          </div>

          <div style={{ gridColumn: "span 6" }}>
            <FieldLabel>Actual payout (optional)</FieldLabel>
            <input
              type="number"
              value={payoutInput}
              min={0}
              step="0.01"
              onChange={(e) => {
                setPayoutInput(e.target.value);
                setPayoutEdited(true);
              }}
              placeholder="Total return incl. bet"
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 12 }}>Legs</div>

        <div style={{ display: "grid", gap: 10 }}>
          {legs.map((leg) => (
            <div
              key={leg.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr 160px 160px",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 800 }}>{leg.selection}</div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
                  Odds: {leg.american_odds > 0 ? `+${leg.american_odds}` : leg.american_odds}
                </div>
              </div>

              <div>
                <FieldLabel>Leg Status</FieldLabel>
                <select
                  value={leg.status}
                  onChange={(e) => saveLegStatus(leg.id, e.target.value as Leg["status"])}
                  style={selectStyle}
                >
                  <option value="open">open</option>
                  <option value="won">won</option>
                  <option value="lost">lost</option>
                  <option value="push">push</option>
                  <option value="void">void</option>
                </select>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>This leg</div>
                <div style={{ fontWeight: 900 }}>{leg.status.toUpperCase()}</div>
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
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          onClick={deleteTicket}
          style={{
            border: "1px solid #f1c0c0",
            background: "#fff",
            color: "#b00020",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Delete
        </button>

        <div style={{ display: "flex", gap: 10 }}>
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
            onClick={saveTicketEdits}
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
    </div>
  );
}