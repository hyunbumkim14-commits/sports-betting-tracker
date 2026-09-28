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
  bet_mode: "risk" | "towin" | null;
  status: "open" | "won" | "lost" | "push" | "void" | "partial";
  book: string | null;
  payout: number | null;
  profit: number | null;
  notes: string | null;
  league: string | null;
  bet_source?: "sportsbook" | "kalshi" | null;
  market_title?: string | null;
  kalshi_side?: "yes" | "no" | null;
  kalshi_price_cents?: number | null;
  kalshi_shares?: number | null;
  kalshi_fee?: number | null;
};

type KalshiStatus = "open" | "won" | "lost" | "void";

type TicketStatus = Ticket["status"];
type ParlayStatus = Exclude<TicketStatus, "partial">;

type Leg = {
  id: string;
  selection: string;
  american_odds: number;
  status: "open" | "won" | "lost" | "push" | "void";
  notes: string | null;
};

// oddsText is a free-typing view of american_odds kept in sync only on valid parses,
// so calculations always read a valid number even mid-edit.
type LegState = Leg & { oddsText: string };

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
  if (!Number.isFinite(american) || american === 0) throw new Error("Invalid American odds");
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function computeMultiplier(
  ticketType: Ticket["ticket_type"],
  legs: Leg[]
): { multiplier: number; multiplierValid: boolean } {
  try {
    if (ticketType === "single") {
      if (legs.length !== 1) return { multiplier: 1, multiplierValid: false };
      const a = legs[0].american_odds;
      if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
      return { multiplier: americanToDecimal(a), multiplierValid: true };
    }

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
}

function profitColor(n: number) {
  if (n > 0) return "#0f7a2a";
  if (n < 0) return "#b00020";
  return "#111";
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-zinc-600">{children}</div>;
}

function mapTicketStatusToLegStatus(s: TicketStatus): Leg["status"] {
  if (s === "won") return "won";
  if (s === "lost") return "lost";
  if (s === "push") return "push";
  if (s === "void") return "void";
  return "open";
}

export default function TicketPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  // Where to return to on Cancel/Save/Delete — passed by the dashboard so we
  // land back on the exact tab (and calendar day) the user came from.
  const [backHref] = useState<string>(() => {
    if (typeof window === "undefined") return "/";
    const from = new URLSearchParams(window.location.search).get("from");
    return from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  });

  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [legs, setLegs] = useState<LegState[]>([]);

  const [placedDate, setPlacedDate] = useState("");
  const [book, setBook] = useState("");
  const [league, setLeague] = useState("");

  const [betMode, setBetMode] = useState<"risk" | "towin">("risk");
  const [betInput, setBetInput] = useState("0");
  const [toWinInput, setToWinInput] = useState("");

  const [singleStatus, setSingleStatus] = useState<TicketStatus>("open");

  const [payoutInput, setPayoutInput] = useState("");
  const [payoutEdited, setPayoutEdited] = useState(false);

  // Kalshi-specific edit state
  const [kalshiMarketTitle, setKalshiMarketTitle] = useState("");
  const [kalshiSideEdit, setKalshiSideEdit] = useState<"yes" | "no">("yes");
  const [kalshiPriceCentsInput, setKalshiPriceCentsInput] = useState("");
  const [kalshiSharesInput, setKalshiSharesInput] = useState("");
  const [kalshiFeeInput, setKalshiFeeInput] = useState("");
  const [kalshiStatusEdit, setKalshiStatusEdit] = useState<KalshiStatus>("open");

  // ✅ Compact UI tokens
  const inputClass =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400";
  const cardClass =
    "rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]";
  const smallBtn =
    "inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold";
  const primaryBtn =
    "inline-flex h-9 items-center justify-center rounded-lg bg-black px-4 text-sm font-semibold text-white";
  const dangerBtn =
    "inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700";

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: t, error: tErr } = await supabase
        .from("tickets")
        .select(
          "id, placed_at, settled_at, ticket_type, stake, bet_mode, status, book, payout, profit, notes, league, bet_source, market_title, kalshi_side, kalshi_price_cents, kalshi_shares, kalshi_fee"
        )
        .eq("id", id)
        .single();

      if (tErr) {
        console.error(tErr);
        alert("Ticket not found.");
        router.push(backHref);
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
        router.push(backHref);
        return;
      }

      const ticketRow = t as Ticket;
      const legRows = (l ?? []) as Leg[];

      setTicket(ticketRow);
      setLegs(legRows.map((leg) => ({ ...leg, oddsText: String(leg.american_odds) })));
      setPlacedDate(isoToYyyyMmDd(ticketRow.placed_at));
      setBook(ticketRow.book ?? "");
      setLeague(ticketRow.league ?? "");

      const mode = (ticketRow.bet_mode === "towin" || ticketRow.bet_mode === "risk")
        ? ticketRow.bet_mode
        : "risk";
      setBetMode(mode);

      // The DB "stake" column always holds the risk amount regardless of bet_mode,
      // so derive To Win directly from the freshly-fetched legs/odds right here —
      // no need to wait for state/effects to catch up.
      const stake = Number(ticketRow.stake) || 0;
      const { multiplier: mult, multiplierValid: multValid } = computeMultiplier(
        ticketRow.ticket_type,
        legRows
      );
      setBetInput(String(stake));
      setToWinInput(multValid ? String(round2(stake * (mult - 1))) : "");

      setSingleStatus(ticketRow.status);
      setPayoutInput(ticketRow.payout === null ? "" : String(ticketRow.payout));
      setPayoutEdited(false);

      if (ticketRow.bet_source === "kalshi") {
        setKalshiMarketTitle(ticketRow.market_title ?? "");
        setKalshiSideEdit(ticketRow.kalshi_side === "no" ? "no" : "yes");
        setKalshiPriceCentsInput(
          ticketRow.kalshi_price_cents === null || ticketRow.kalshi_price_cents === undefined
            ? ""
            : String(ticketRow.kalshi_price_cents)
        );
        setKalshiSharesInput(
          ticketRow.kalshi_shares === null || ticketRow.kalshi_shares === undefined
            ? ""
            : String(ticketRow.kalshi_shares)
        );
        setKalshiFeeInput(
          ticketRow.kalshi_fee === null || ticketRow.kalshi_fee === undefined
            ? "0"
            : String(ticketRow.kalshi_fee)
        );
        setKalshiStatusEdit(
          ticketRow.status === "won" || ticketRow.status === "lost" || ticketRow.status === "void"
            ? ticketRow.status
            : "open"
        );
      }

      setLoading(false);
    }

    if (id) load();
  }, [id, router, backHref]);

  const derivedParlayStatus = useMemo(() => {
    if (!ticket || ticket.ticket_type !== "parlay") return null;
    if (legs.some((l) => l.status === "lost")) return "lost";
    const allSettled = legs.every((l) => l.status !== "open");
    if (!allSettled) return "open";
    const allVoidOrPush = legs.every((l) => l.status === "void" || l.status === "push");
    if (allVoidOrPush) return "push";
    if (legs.some((l) => l.status === "won")) return "won";
    return "push";
  }, [ticket, legs]);

  useEffect(() => {
    if (!ticket || ticket.ticket_type !== "single") return;
    const mapped = mapTicketStatusToLegStatus(singleStatus);
    setLegs((prev) => prev.map((l) => ({ ...l, status: mapped })));
  }, [ticket, singleStatus]);

  const { multiplier, multiplierValid } = useMemo(() => {
    if (!ticket) return { multiplier: 1, multiplierValid: false };
    return computeMultiplier(ticket.ticket_type, legs);
  }, [ticket, legs]);

  // Editing an existing Kalshi position just needs the actual price/shares/fee
  // that happened — no need to re-solve the buy-side calculator from new/page.tsx.
  const kalshiEditCalc = useMemo(() => {
    const priceCents = Number(kalshiPriceCentsInput);
    const priceValid = Number.isInteger(priceCents) && priceCents >= 1 && priceCents <= 99;
    const priceDollars = priceValid ? priceCents / 100 : 0;

    const shares = Number(kalshiSharesInput);
    const sharesValid = Number.isFinite(shares) && shares > 0;

    const fee = Number(kalshiFeeInput);
    const feeValid = Number.isFinite(fee) && fee >= 0;

    const valid = priceValid && sharesValid && feeValid;
    const stake = valid ? round2(shares * priceDollars + fee) : 0;

    let payout: number | null = null;
    let profit: number | null = null;

    if (valid) {
      if (payoutEdited && payoutInput.trim() !== "") {
        const p = Number(payoutInput);
        if (Number.isFinite(p)) {
          payout = round2(p);
          profit = round2(payout - stake);
        }
      } else if (kalshiStatusEdit === "won") {
        payout = round2(shares * 1);
        profit = round2(payout - stake);
      } else if (kalshiStatusEdit === "lost") {
        payout = 0;
        profit = round2(0 - stake);
      } else if (kalshiStatusEdit === "void") {
        payout = stake;
        profit = 0;
      }
    }

    return { priceValid, priceDollars, sharesValid, feeValid, valid, shares, fee, stake, payout, profit };
  }, [kalshiPriceCentsInput, kalshiSharesInput, kalshiFeeInput, kalshiStatusEdit, payoutInput, payoutEdited]);

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
    if (!ticket) return { payout: null as number | null, profit: null as number | null };

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
      if (status === "open" || status === "partial") return { payout: null, profit: null };
      if (status === "push" || status === "void") return { payout: round2(stakeNum), profit: 0 };
      if (legs.length !== 1) return { payout: null, profit: null };
      if (status === "lost") return { payout: 0, profit: round2(0 - stakeNum) };
      const dec = americanToDecimal(legs[0].american_odds);
      const payout = round2(stakeNum * dec);
      const profit = round2(payout - stakeNum);
      return { payout, profit };
    }

    const pStatus: ParlayStatus = (derivedParlayStatus ?? "open") as ParlayStatus;
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

  async function saveKalshiEdits() {
    if (!ticket) return;
    if (!placedDate) return alert("Please select a date.");
    if (!kalshiMarketTitle.trim()) return alert("Please enter the market question.");
    if (!kalshiEditCalc.priceValid) return alert("Price must be a whole number between 1 and 99 cents.");
    if (!kalshiEditCalc.sharesValid) return alert("Shares must be a positive number.");
    if (!kalshiEditCalc.feeValid) return alert("Fee must be 0 or greater.");

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const settledAtIso = kalshiStatusEdit === "open" ? null : placedAtIso;

    const { error } = await supabase
      .from("tickets")
      .update({
        placed_at: placedAtIso,
        market_title: kalshiMarketTitle.trim(),
        league: league.trim() === "" ? null : league.trim(),
        kalshi_side: kalshiSideEdit,
        kalshi_price_cents: Number(kalshiPriceCentsInput),
        kalshi_shares: kalshiEditCalc.shares,
        kalshi_fee: kalshiEditCalc.fee,
        stake: kalshiEditCalc.stake,
        status: kalshiStatusEdit,
        payout: kalshiEditCalc.payout,
        profit: kalshiEditCalc.profit,
        settled_at: settledAtIso,
      })
      .eq("id", ticket.id);

    if (error) {
      console.error(error);
      alert(`Failed to save: ${error.message}`);
      return;
    }

    setPayoutEdited(false);
    router.push(backHref);
  }

  async function saveTicketEdits() {
    if (!ticket) return;

   if (!placedDate) return alert("Please select a date.");

    // ✅ Compute stake at save-time to avoid stale state when using To Win
    if (!multiplierValid) return alert("Odds/multiplier are invalid. Please check your odds.");

    let stake = 0;

    if (betMode === "risk") {
      stake = Number(betInput);
      if (!Number.isFinite(stake) || stake <= 0) return alert("Please enter a valid Stake (Risk).");
    } else {
      const desiredProfit = Number(toWinInput);
      if (!Number.isFinite(desiredProfit) || desiredProfit < 0) return alert("Please enter a valid To Win amount.");
      const denom = multiplier - 1;
      if (denom <= 0) return alert("Invalid multiplier. Check your odds.");
      stake = round2(desiredProfit / denom);
      if (!Number.isFinite(stake) || stake <= 0) return alert("Computed stake is invalid. Check your inputs.");
    }

    // Keep the input field in sync so the UI matches what is saved
    setBetInput(String(stake));

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const leagueToStore = league.trim() === "" ? null : league.trim();

    const statusToStore: TicketStatus =
      ticket.ticket_type === "parlay" ? ((derivedParlayStatus ?? "open") as any) : singleStatus;

    const { payout, profit } = computedPayoutProfit;
    const settledAtIso = statusToStore === "open" || statusToStore === "partial" ? null : placedAtIso;

    const { error } = await supabase
      .from("tickets")
      .update({
        placed_at: placedAtIso,
        book: book.trim() === "" ? null : book.trim(),
        stake,
        league: leagueToStore,
        bet_mode: betMode,
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

    const legResults = await Promise.all(
      legs.map((leg) => {
        const status =
          ticket.ticket_type === "single" ? mapTicketStatusToLegStatus(statusToStore) : leg.status;
        return supabase
          .from("legs")
          .update({ selection: leg.selection.trim(), american_odds: leg.american_odds, status })
          .eq("id", leg.id);
      })
    );
    const legError = legResults.find((r) => r.error)?.error;
    if (legError) {
      console.error(legError);
      alert("Saved ticket, but failed to save leg changes.");
      return;
    }

    setPayoutEdited(false);
    router.push(backHref);
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

  function updateLegSelection(legId: string, value: string) {
    setLegs((prev) => prev.map((l) => (l.id === legId ? { ...l, selection: value } : l)));
  }

  function updateLegOdds(legId: string, value: string) {
    setLegs((prev) =>
      prev.map((l) => {
        if (l.id !== legId) return l;
        const n = Number(value);
        const valid = value.trim() !== "" && Number.isFinite(n) && n !== 0;
        return { ...l, oddsText: value, american_odds: valid ? n : l.american_odds };
      })
    );
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

    router.push(backHref);
    router.refresh();
  }

  if (loading) return <div className="p-4 text-sm text-zinc-600">Loading…</div>;
  if (!ticket) return <div className="p-4 text-sm text-zinc-600">Not found.</div>;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-3xl px-4 pt-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-500">Ticket</div>
            <h1 className="text-xl font-bold tracking-tight">
              {ticket.bet_source === "kalshi"
                ? `KALSHI • ${ticket.market_title ?? "—"}`
                : `${ticket.league ?? "—"} • ${ticket.ticket_type.toUpperCase()}`}
            </h1>
            <div className="mt-1 text-[11px] text-zinc-600">ID: {ticket.id}</div>
          </div>

          <Link href={backHref} className="text-sm font-semibold text-zinc-700 hover:underline">
            Home
          </Link>
        </div>

        {/* Summary */}
        {(() => {
          const summary =
            ticket.bet_source === "kalshi"
              ? { profit: kalshiEditCalc.profit, payout: kalshiEditCalc.payout }
              : computedPayoutProfit;
          return (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className={cardClass}>
                <div className="text-[11px] font-semibold text-zinc-600">Computed Profit</div>
                <div
                  className="mt-1 text-lg font-bold"
                  style={{ color: summary.profit === null ? "#111" : profitColor(summary.profit) }}
                >
                  {summary.profit === null ? "—" : summary.profit.toFixed(2)}
                </div>
              </div>

              <div className={cardClass}>
                <div className="text-[11px] font-semibold text-zinc-600">Computed Payout</div>
                <div className="mt-1 text-lg font-bold text-zinc-900">
                  {summary.payout === null ? "—" : summary.payout.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })()}

        {ticket.bet_source !== "kalshi" && ticket.ticket_type === "single" && (
          <div className="mt-2 text-[11px] text-zinc-600">
            Single: leg status mirrors ticket status
          </div>
        )}

        {ticket.bet_source === "kalshi" ? (
        <>
        {/* Kalshi Market */}
        <div className={`mt-3 ${cardClass}`}>
          <div className="mb-2 text-sm font-bold">Market</div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="col-span-2 md:col-span-4">
              <FieldLabel>Market question</FieldLabel>
              <input
                value={kalshiMarketTitle}
                onChange={(e) => setKalshiMarketTitle(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Category</FieldLabel>
              <input
                value={league}
                onChange={(e) => setLeague(e.target.value)}
                placeholder="Politics, Econ…"
                className={inputClass}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>Date</FieldLabel>
              <input
                type="date"
                value={placedDate}
                onChange={(e) => setPlacedDate(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>Side</FieldLabel>
              <div className="flex h-9 items-center gap-3 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={kalshiSideEdit === "yes"}
                    onChange={() => setKalshiSideEdit("yes")}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={kalshiSideEdit === "no"}
                    onChange={() => setKalshiSideEdit("no")}
                  />
                  No
                </label>
              </div>
            </div>

            <div className="col-span-1">
              <FieldLabel>Price (¢)</FieldLabel>
              <input
                value={kalshiPriceCentsInput}
                onChange={(e) => setKalshiPriceCentsInput(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>Shares</FieldLabel>
              <input
                value={kalshiSharesInput}
                onChange={(e) => setKalshiSharesInput(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>Fee ($)</FieldLabel>
              <input
                value={kalshiFeeInput}
                onChange={(e) => setKalshiFeeInput(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>Total cost</FieldLabel>
              <div className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-700">
                {kalshiEditCalc.valid ? `$${kalshiEditCalc.stake.toFixed(2)}` : "—"}
              </div>
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Status</FieldLabel>
              <select
                value={kalshiStatusEdit}
                onChange={(e) => setKalshiStatusEdit(e.target.value as KalshiStatus)}
                className={inputClass}
              >
                <option value="open">open</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="void">void</option>
              </select>
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Actual payout (optional)</FieldLabel>
              <input
                value={payoutInput}
                onChange={(e) => {
                  setPayoutInput(e.target.value);
                  setPayoutEdited(true);
                }}
                placeholder="Total return incl. cost"
                className={inputClass}
              />
            </div>
          </div>
        </div>
        </>
        ) : (
        <>
        {/* Details */}
        <div className={`mt-3 ${cardClass}`}>
          <div className="mb-2 text-sm font-bold">Details</div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="col-span-1">
              <FieldLabel>Type</FieldLabel>
              <div className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-700">
                {ticket.ticket_type}
              </div>
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>League</FieldLabel>
              <input
                value={league}
                onChange={(e) => setLeague(e.target.value)}
                placeholder="Select or type…"
                className={inputClass}
                list="league_options"
              />
              <datalist id="league_options">
                {LEAGUE_OPTIONS.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>

            <div className="col-span-1">
              <FieldLabel>Date</FieldLabel>
              <input
                type="date"
                value={placedDate}
                onChange={(e) => setPlacedDate(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Book</FieldLabel>
              <input
                value={book}
                onChange={(e) => setBook(e.target.value)}
                placeholder="FanDuel, DK…"
                className={inputClass}
              />
            </div>

            {/* Bet mode */}
            <div className="col-span-2 md:col-span-2">
              <FieldLabel>Bet input mode</FieldLabel>
              <div className="flex h-9 items-center gap-3 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={betMode === "risk"}
                    onChange={() => {
                      setBetMode("risk");
                      setToWinFromRisk(betInput);
                    }}
                  />
                  Risk
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={betMode === "towin"}
                    onChange={() => {
                      setBetMode("towin");
                      setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                    }}
                  />
                  To Win
                </label>

                <div className="ml-auto text-[11px] text-zinc-600">
                  Mult: {multiplierValid ? round2(multiplier).toFixed(2) : "—"}
                </div>
              </div>
            </div>

            <div className="col-span-1">
              <FieldLabel>Stake (Risk)</FieldLabel>
              <input
                value={betInput}
                onChange={(e) => {
                  const next = e.target.value;
                  if (betMode === "risk") setToWinFromRisk(next);
                  else setBetInput(next);
                }}
                className={inputClass}
                style={{ opacity: betMode === "risk" ? 1 : 0.85 }}
              />
            </div>

            <div className="col-span-1">
              <FieldLabel>To Win (Profit)</FieldLabel>
              <input
                value={toWinInput}
                onChange={(e) => {
                  const next = e.target.value;
                  if (betMode === "towin") setRiskFromToWin(next);
                  else setToWinInput(next);
                }}
                placeholder={betMode === "towin" ? "" : "Auto (switch to To Win)"}
                className={inputClass}
                style={{ opacity: betMode === "towin" ? 1 : 0.85 }}
              />
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Status</FieldLabel>
              <select
                value={singleStatus}
                onChange={(e) => setSingleStatus(e.target.value as TicketStatus)}
                disabled={ticket.ticket_type === "parlay"}
                className={inputClass}
                style={{
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
                <div className="mt-1 text-[11px] text-zinc-600">
                  Derived: <span className="font-semibold">{derivedParlayStatus ?? "open"}</span>
                </div>
              )}
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Actual payout (optional)</FieldLabel>
              <input
                value={payoutInput}
                onChange={(e) => {
                  setPayoutInput(e.target.value);
                  setPayoutEdited(true);
                }}
                placeholder="Total return incl. bet"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        {/* Legs */}
        <div className={`mt-3 ${cardClass}`}>
          <div className="mb-2 text-sm font-bold">Legs</div>

          <div className="space-y-2">
            {legs.map((leg) => (
              <div key={leg.id} className="rounded-xl border border-zinc-200 bg-white p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <FieldLabel>Selection</FieldLabel>
                    <input
                      value={leg.selection}
                      onChange={(e) => updateLegSelection(leg.id, e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div className="w-24">
                    <FieldLabel>Odds</FieldLabel>
                    <input
                      value={leg.oddsText}
                      onChange={(e) => updateLegOdds(leg.id, e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div className="w-36">
                    <FieldLabel>Leg Status</FieldLabel>
                    <select
                      value={leg.status}
                      onChange={(e) => saveLegStatus(leg.id, e.target.value as Leg["status"])}
                      className={inputClass}
                      style={{
                        opacity: ticket.ticket_type === "single" ? 0.65 : 1,
                        cursor: ticket.ticket_type === "single" ? "not-allowed" : "pointer",
                      }}
                      disabled={ticket.ticket_type === "single"}
                    >
                      <option value="open">open</option>
                      <option value="won">won</option>
                      <option value="lost">lost</option>
                      <option value="push">push</option>
                      <option value="void">void</option>
                    </select>

                    {ticket.ticket_type === "single" && (
                      <div className="mt-1 text-[11px] text-zinc-600">Mirrors ticket status</div>
                    )}
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-zinc-600">
                  This leg: <span className="font-semibold">{leg.status.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            Selection and odds save when you tap Save below. Leg status saves immediately.
          </div>
        </div>
        </>
        )}

        {/* bottom padding so sticky bar doesn't cover content */}
        <div className="h-20" />
      </div>

      {/* Sticky actions (compact) */}
      <div className="sticky bottom-0 border-t border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={deleteTicket} className={dangerBtn}>
              Delete
            </button>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => router.push(backHref)} className={smallBtn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={ticket.bet_source === "kalshi" ? saveKalshiEdits : saveTicketEdits}
                className={primaryBtn}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}