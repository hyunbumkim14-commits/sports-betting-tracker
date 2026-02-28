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

  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);

  const [placedDate, setPlacedDate] = useState("");
  const [book, setBook] = useState("");
  const [league, setLeague] = useState("");

  const [betMode, setBetMode] = useState<"risk" | "towin">("risk");
  const [betInput, setBetInput] = useState("0");
  const [toWinInput, setToWinInput] = useState("");

  const [singleStatus, setSingleStatus] = useState<TicketStatus>("open");

  const [payoutInput, setPayoutInput] = useState("");
  const [payoutEdited, setPayoutEdited] = useState(false);

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
    router.push("/?tab=OPEN");
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
              {ticket.league ?? "—"} • {ticket.ticket_type.toUpperCase()}
            </h1>
            <div className="mt-1 text-[11px] text-zinc-600">ID: {ticket.id}</div>
          </div>

          <Link href="/" className="text-sm font-semibold text-zinc-700 hover:underline">
            Home
          </Link>
        </div>

        {/* Summary */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className={cardClass}>
            <div className="text-[11px] font-semibold text-zinc-600">Computed Profit</div>
            <div
              className="mt-1 text-lg font-bold"
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

          <div className={cardClass}>
            <div className="text-[11px] font-semibold text-zinc-600">Computed Payout</div>
            <div className="mt-1 text-lg font-bold text-zinc-900">
              {computedPayoutProfit.payout === null ? "—" : computedPayoutProfit.payout.toFixed(2)}
            </div>
          </div>
        </div>

        {ticket.ticket_type === "single" && (
          <div className="mt-2 text-[11px] text-zinc-600">
            Single: leg status mirrors ticket status
          </div>
        )}

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
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-900">
                      {leg.selection}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-600">
                      Odds: {leg.american_odds > 0 ? `+${leg.american_odds}` : leg.american_odds}
                    </div>
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
        </div>

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
              <button type="button" onClick={() => router.push("/")} className={smallBtn}>
                Cancel
              </button>
              <button type="button" onClick={saveTicketEdits} className={primaryBtn}>
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}