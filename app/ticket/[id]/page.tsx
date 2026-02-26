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
  if (!Number.isFinite(american) || american === 0) throw new Error("Invalid American odds");
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
  return <div className="text-xs font-bold opacity-70">{children}</div>;
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

  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);

  const [placedDate, setPlacedDate] = useState<string>("");
  const [book, setBook] = useState<string>("");
  const [league, setLeague] = useState<string>("");

  const [betMode, setBetMode] = useState<"risk" | "towin">("risk");
  const [betInput, setBetInput] = useState<string>("0");
  const [toWinInput, setToWinInput] = useState<string>("");

  const [singleStatus, setSingleStatus] = useState<TicketStatus>("open");

  const [payoutInput, setPayoutInput] = useState<string>("");
  const [payoutEdited, setPayoutEdited] = useState<boolean>(false);

  const inputClass =
    "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base";
  const cardClass =
    "rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)]";

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: t, error: tErr } = await supabase
        .from("tickets")
        .select("id, placed_at, settled_at, ticket_type, stake, status, book, payout, profit, notes, league")
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

  useEffect(() => {
    if (!ticket || ticket.ticket_type !== "single") return;
    const mapped = mapTicketStatusToLegStatus(singleStatus);
    setLegs((prev) => prev.map((l) => ({ ...l, status: mapped })));
  }, [ticket, singleStatus]);

  const { multiplier, multiplierValid } = useMemo(() => {
    try {
      if (!ticket) return { multiplier: 1, multiplierValid: false };

      if (ticket.ticket_type === "single") {
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

    if (!placedDate) return alert("Please select a date.");

    const stake = Number(betInput);
    if (!Number.isFinite(stake) || stake <= 0) return alert("Please enter a valid bet amount.");

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const leagueToStore = league.trim() === "" ? null : league.trim();

    const statusToStore: TicketStatus =
      ticket.ticket_type === "parlay" ? (derivedParlayStatus ?? "open") : singleStatus;

    const { payout, profit } = computedPayoutProfit;

    const settledAtIso = statusToStore === "open" || statusToStore === "partial" ? null : placedAtIso;

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

    if (ticket.ticket_type === "single") {
      const mapped = mapTicketStatusToLegStatus(statusToStore);
      const firstLegId = legs[0]?.id;
      if (firstLegId) {
        const { error: legErr } = await supabase.from("legs").update({ status: mapped }).eq("id", firstLegId);
        if (legErr) {
          console.error(legErr);
          alert("Saved ticket, but failed to sync single leg status.");
          return;
        }
      }
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

  if (loading) return <div className="px-4 py-6">Loading…</div>;
  if (!ticket) return <div className="px-4 py-6">Not found.</div>;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs opacity-70">Ticket</div>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
            {ticket.league ?? "—"} • {ticket.ticket_type.toUpperCase()}
          </h1>
          <div className="mt-1 text-xs opacity-70">
            ID:{" "}
            <span className="font-mono">{ticket.id}</span>
          </div>
        </div>

        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-bold"
        >
          Home
        </Link>
      </div>

      {/* Summary */}
      <div className={`${cardClass} mt-4`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <div className="text-xs opacity-70">Computed Profit</div>
            <div
              className="mt-1 text-2xl font-black"
              style={{
                color:
                  computedPayoutProfit.profit === null
                    ? "#111"
                    : profitColor(computedPayoutProfit.profit),
              }}
            >
              {computedPayoutProfit.profit === null ? "—" : computedPayoutProfit.profit.toFixed(2)}
            </div>
          </div>

          <div>
            <div className="text-xs opacity-70">Computed Payout</div>
            <div className="mt-1 text-2xl font-black">
              {computedPayoutProfit.payout === null ? "—" : computedPayoutProfit.payout.toFixed(2)}
            </div>
          </div>

          {ticket.ticket_type === "single" && (
            <div className="text-xs opacity-70 sm:text-right">
              Single: leg status mirrors ticket status
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div className={`${cardClass} mt-4`}>
        <div className="mb-3 font-black">Details</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <FieldLabel>Type</FieldLabel>
            <input value={ticket.ticket_type} disabled className={inputClass + " opacity-70"} />
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>League</FieldLabel>
            <input
              list="league-options"
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              placeholder="Select or type…"
              className={inputClass}
            />
            <datalist id="league-options">
              {LEAGUE_OPTIONS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>Date</FieldLabel>
            <input
              type="date"
              value={placedDate}
              onChange={(e) => setPlacedDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>Book</FieldLabel>
            <input
              value={book}
              onChange={(e) => setBook(e.target.value)}
              placeholder="FanDuel, DK…"
              className={inputClass}
            />
          </div>

          {/* Bet Mode */}
          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-2">
            <FieldLabel>Bet input mode</FieldLabel>
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="betMode"
                    checked={betMode === "risk"}
                    onChange={() => {
                      setBetMode("risk");
                      setToWinFromRisk(betInput);
                    }}
                  />
                  <span className="font-bold">Risk (Stake)</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="betMode"
                    checked={betMode === "towin"}
                    onChange={() => {
                      setBetMode("towin");
                      setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                    }}
                  />
                  <span className="font-bold">To Win (Profit)</span>
                </label>
              </div>

              <div className="text-xs opacity-70">
                Multiplier: <b>{multiplierValid ? round2(multiplier).toFixed(2) : "—"}</b>
              </div>
            </div>
          </div>

          <div className="grid gap-1.5">
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
              className={inputClass}
              style={{ opacity: betMode === "risk" ? 1 : 0.85 }}
            />
          </div>

          <div className="grid gap-1.5">
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
              className={inputClass}
              style={{ opacity: betMode === "towin" ? 1 : 0.85 }}
            />
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>Status</FieldLabel>
            <select
              value={ticket.ticket_type === "parlay" ? (derivedParlayStatus ?? "open") : singleStatus}
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
              <div className="text-xs opacity-70">
                Derived: <b>{derivedParlayStatus ?? "open"}</b>
              </div>
            )}
          </div>

          <div className="grid gap-1.5 sm:col-span-2 lg:col-span-2">
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
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Legs */}
      <div className={`${cardClass} mt-4`}>
        <div className="mb-3 font-black">Legs</div>

        <div className="grid gap-3">
          {legs.map((leg) => (
            <div key={leg.id} className="rounded-2xl border border-zinc-200 bg-white p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-center">
                <div>
                  <div className="font-black">{leg.selection}</div>
                  <div className="mt-1 text-xs opacity-70">
                    Odds: {leg.american_odds > 0 ? `+${leg.american_odds}` : leg.american_odds}
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <FieldLabel>Leg Status</FieldLabel>
                  <select
                    value={leg.status}
                    disabled={ticket.ticket_type === "single"}
                    onChange={(e) => saveLegStatus(leg.id, e.target.value as Leg["status"])}
                    className={inputClass}
                    style={{
                      opacity: ticket.ticket_type === "single" ? 0.65 : 1,
                      cursor: ticket.ticket_type === "single" ? "not-allowed" : "pointer",
                    }}
                  >
                    <option value="open">open</option>
                    <option value="won">won</option>
                    <option value="lost">lost</option>
                    <option value="push">push</option>
                    <option value="void">void</option>
                  </select>

                  {ticket.ticket_type === "single" && (
                    <div className="text-xs opacity-70">Mirrors ticket status</div>
                  )}
                </div>

                <div className="sm:text-right">
                  <div className="text-xs opacity-70">This leg</div>
                  <div className="font-black">{leg.status.toUpperCase()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky actions */}
      <div className="sticky bottom-0 mt-4 border-t border-zinc-200 bg-white/90 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={deleteTicket}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-red-200 bg-white px-4 font-bold text-red-700"
          >
            Delete
          </button>

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 font-bold"
            >
              Cancel
            </Link>

            <button
              onClick={saveTicketEdits}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 font-black text-white"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}