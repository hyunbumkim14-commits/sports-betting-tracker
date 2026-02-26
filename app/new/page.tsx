/* =========================================================
   PASTE THIS FILE AT:
   /app/new/page.tsx
   ========================================================= */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const raw = prevMonthEndingBankroll * 0.05;
  const roundedDown = Math.floor(raw / 50) * 50;
  const nonNegative = Math.max(0, roundedDown);
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

function mapTicketStatusToLegStatus(s: TicketStatus): LegDraft["status"] {
  if (s === "won") return "won";
  if (s === "lost") return "lost";
  if (s === "push") return "push";
  if (s === "void") return "void";
  return "open";
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-zinc-600">{children}</div>;
}

export default function NewTicketPage() {
  const router = useRouter();

  const [ticketType, setTicketType] = useState<"single" | "parlay">("single");

  // ✅ Default bet mode = To Win (Profit)
  const [betMode, setBetMode] = useState<"risk" | "towin">("towin");

  // store as strings so the user can clear the input without NaN fights
  const [betInput, setBetInput] = useState(""); // stake / risk
  const [toWinInput, setToWinInput] = useState(""); // profit target

  // ✅ Default book = Bovada
  const [book, setBook] = useState("Bovada");

  const [league, setLeague] = useState("");
  const [placedDate, setPlacedDate] = useState(() => todayYyyyMmDd());
  const [ticketStatus, setTicketStatus] = useState<TicketStatus>("open");
  const [actualPayout, setActualPayout] = useState("");

  const [legs, setLegs] = useState<LegDraft[]>([
    { selection: "", american_odds: "-110", status: "open" },
  ]);

  // Unit seeding (1 unit -> toWin)
  const [unitLoading, setUnitLoading] = useState(true);
  const [unitSize, setUnitSize] = useState(0);
  const [seededDefaults, setSeededDefaults] = useState(false);

  const canAddLeg = ticketType === "parlay";
  const addLeg = () => setLegs([...legs, { selection: "", american_odds: "-110", status: "open" }]);
  const removeLeg = (idx: number) => setLegs(legs.filter((_, i) => i !== idx));

  // ✅ Compact UI tokens
  const inputClass =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400";
  const selectClass =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-zinc-400";
  const cardClass =
    "rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)]";
  const smallBtn =
    "inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold";
  const primaryBtn =
    "inline-flex h-9 items-center justify-center rounded-lg bg-black px-4 text-sm font-semibold text-white";
  const dangerBtn =
    "inline-flex h-9 items-center justify-center rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700";

  // ✅ derive decimal multiplier for the ticket (single or parlay)
  const { multiplier, multiplierValid } = useMemo(() => {
    try {
      if (ticketType === "single") {
        if (legs.length !== 1) return { multiplier: 1, multiplierValid: false };
        const a = Number(legs[0].american_odds);
        if (!Number.isFinite(a) || a === 0) return { multiplier: 1, multiplierValid: false };
        return { multiplier: americanToDecimal(a), multiplierValid: true };
      }

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

  // ✅ Single: leg status mirrors ticket status
  useEffect(() => {
    if (ticketType !== "single") return;

    setLegs((prev) => {
      if (prev.length !== 1)
        return [
          { selection: "", american_odds: "-110", status: mapTicketStatusToLegStatus(ticketStatus) },
        ];
      const next = [...prev];
      next[0] = { ...next[0], status: mapTicketStatusToLegStatus(ticketStatus) };
      return next;
    });
  }, [ticketType, ticketStatus]);

  // ✅ Fetch Unit Size so To Win defaults to 1 unit
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

      const { data: prof } = await supabase
        .from("profiles")
        .select("starting_bankroll")
        .eq("id", uid)
        .single();

      const startingBankroll = Number(prof?.starting_bankroll) || 0;

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

      if (tixErr) console.error(tixErr);

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

      if (!seededDefaults) {
        const toWin = String(round2(u));
        setToWinInput(toWin);
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

    if (typeof payoutOverride === "number" && Number.isFinite(payoutOverride)) {
      const payout = round2(payoutOverride);
      const profit = round2(payout - stake);
      return { payout, profit, settled_at: statusToStore === "open" ? null : "SET_NOW" };
    }

    if (ticketType === "single") {
      if (statusToStore === "open" || statusToStore === "partial")
        return { payout: null, profit: null, settled_at: null };
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

    const pStatus = (derivedParlayStatus ?? "open") as TicketStatus;
    if (pStatus === "open") return { payout: null, profit: null, settled_at: null };
    if (pStatus === "push" || pStatus === "void")
      return { payout: round2(stake), profit: 0, settled_at: "SET_NOW" };
    if (pStatus === "lost") return { payout: 0, profit: round2(0 - stake), settled_at: "SET_NOW" };
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
      alert("Not logged in.\nGo to /login.");
      return;
    }

    if (!placedDate) return alert("Please select a date.");
    if (!league.trim()) return alert("Please select a league.");
    if (legs.some((l) => !l.selection.trim())) return alert("Please fill all selections.");
    if (ticketType === "single" && legs.length !== 1) return alert("Single must have exactly 1 leg.");
    if (ticketType === "parlay" && legs.length < 2) return alert("Parlay must have 2+ legs.");
    if (
      legs.some((l) => {
        const n = Number(l.american_odds);
        return !Number.isFinite(n) || n === 0;
      })
    )
      return alert("Invalid odds detected.");

    const stakeNum = Number(betInput);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) return alert("Please enter a valid bet amount.");

    const placedAtIso = new Date(placedDate + "T00:00:00").toISOString();
    const statusToStore: TicketStatus =
      ticketType === "parlay" ? ((derivedParlayStatus as any) ?? "open") : ticketStatus;

    const leagueToStore = league.trim() === "" ? null : league.trim();
    const payoutOverride = actualPayout === "" ? null : Number(actualPayout);

    const computed = computePayoutProfitForCreate({
      ticketType,
      stake: stakeNum,
      statusToStore,
      legs,
      payoutOverride,
      derivedParlayStatus: derivedParlayStatus as any,
    });

    const settledAtIso = computed.settled_at === "SET_NOW" ? placedAtIso : null;

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

    router.push("/");
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <div className="mx-auto max-w-3xl px-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-500">Create</div>
            <h1 className="text-xl font-bold tracking-tight">New Bet</h1>
            <div className="mt-1 text-xs text-zinc-600">
              Default To Win:{" "}
              {unitLoading ? "Loading unit…" : `${unitSize.toFixed(2)} (1 Unit)`}
            </div>
          </div>

          <Link href="/" className="text-sm font-semibold text-zinc-700 hover:underline">
            Home
          </Link>
        </div>

        {/* Ticket Info */}
        <div className={`mt-4 ${cardClass}`}>
          <div className="mb-2 text-sm font-bold">Ticket</div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
            <div className="col-span-1">
              <FieldLabel>Type</FieldLabel>
              <select
                value={ticketType}
                onChange={(e) => {
                  const next = e.target.value as "single" | "parlay";
                  setTicketType(next);
                  if (next === "single") {
                    setLegs([
                      {
                        selection: "",
                        american_odds: "-110",
                        status: mapTicketStatusToLegStatus(ticketStatus),
                      },
                    ]);
                  }
                }}
                className={selectClass}
              >
                <option value="single">Single</option>
                <option value="parlay">Parlay</option>
              </select>
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
              <div className="mt-1 text-[11px] text-zinc-500">Default: Bovada</div>
            </div>

            <div className="col-span-1 md:col-span-2">
              <FieldLabel>Status</FieldLabel>
              <select
                value={ticketStatus}
                onChange={(e) => setTicketStatus(e.target.value as any)}
                disabled={ticketType === "parlay"}
                className={selectClass}
                style={{
                  opacity: ticketType === "parlay" ? 0.65 : 1,
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
                <div className="mt-1 text-[11px] text-zinc-600">
                  Derived: <span className="font-semibold">{derivedParlayStatus}</span>
                </div>
              )}
            </div>
          </div>

          {/* Bet Mode */}
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold">Bet</div>
              <div className="flex items-center gap-3 text-xs font-semibold text-zinc-600">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={betMode === "risk"}
                    onChange={() => {
                      setBetMode("risk");
                      setToWinFromRisk(betInput === "" ? "0" : betInput);
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
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="col-span-2 md:col-span-1">
                <FieldLabel>Multiplier</FieldLabel>
                <div className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-sm leading-9 text-zinc-700">
                  {multiplierValid ? round2(multiplier).toFixed(2) : "—"}
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
                <div className="mt-1 text-[11px] text-zinc-500">Tip: set To Win = 1 unit</div>
              </div>

              <div className="col-span-2 md:col-span-1">
                <FieldLabel>Actual payout (optional)</FieldLabel>
                <input
                  value={actualPayout}
                  onChange={(e) =>
                    setActualPayout(e.target.value === "" ? "" : String(Number(e.target.value)))
                  }
                  placeholder="Total return incl. bet"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Legs */}
        <div className={`mt-3 ${cardClass}`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">Legs</div>
            {canAddLeg && (
              <button type="button" onClick={addLeg} className={smallBtn}>
                + Add Leg
              </button>
            )}
          </div>

          {ticketType === "single" && (
            <div className="mt-1 text-[11px] text-zinc-600">
              Single bet: leg status is synced to ticket status.
            </div>
          )}

          <div className="mt-2 space-y-2">
            {legs.map((leg, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-zinc-200 bg-white p-2"
              >
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-12 md:col-span-7">
                    <FieldLabel>
                      {ticketType === "single" ? "Selection" : `Leg ${idx + 1} Selection`}
                    </FieldLabel>
                    <input
                      value={leg.selection}
                      onChange={(e) => {
                        const copy = [...legs];
                        copy[idx] = { ...copy[idx], selection: e.target.value };
                        setLegs(copy);
                      }}
                      placeholder={ticketType === "single" ? "e.g. Lakers -2.5" : "Leg selection"}
                      className={inputClass}
                    />
                  </div>

                  <div className="col-span-6 md:col-span-2">
                    <FieldLabel>Odds</FieldLabel>
                    <input
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
                      className={inputClass}
                    />
                  </div>

                  <div className="col-span-6 md:col-span-2">
                    <FieldLabel>Leg Status</FieldLabel>
                    <select
                      value={leg.status}
                      onChange={(e) => {
                        const copy = [...legs];
                        copy[idx] = { ...copy[idx], status: e.target.value as any };
                        setLegs(copy);

                        setTimeout(() => {
                          if (betMode === "risk") setToWinFromRisk(betInput === "" ? "0" : betInput);
                          else setRiskFromToWin(toWinInput === "" ? "0" : toWinInput);
                        }, 0);
                      }}
                      className={selectClass}
                      style={{
                        opacity: ticketType === "single" ? 0.65 : 1,
                        cursor: ticketType === "single" ? "not-allowed" : "pointer",
                      }}
                      disabled={ticketType === "single"}
                    >
                      <option value="open">open</option>
                      <option value="won">won</option>
                      <option value="lost">lost</option>
                      <option value="push">push</option>
                      <option value="void">void</option>
                    </select>
                  </div>

                  <div className="col-span-12 md:col-span-1 md:flex md:items-end">
                    {canAddLeg && legs.length > 2 ? (
                      <button type="button" onClick={() => removeLeg(idx)} className={dangerBtn}>
                        Remove
                      </button>
                    ) : null}
                  </div>
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
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => router.push("/")} className={smallBtn}>
              Cancel
            </button>
            <button type="button" onClick={save} className={primaryBtn}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}