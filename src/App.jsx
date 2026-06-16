import { useState } from "react";

// Targets rescaled so they sum to ~58% * 13 = 754 (7 of 12 present = 58.3% ceiling)
// Tier A (68%): Julian, Henry, Rory, Niko, Maddox
// Tier B (52%): everyone else including Lucas and Winston
const DEFAULT_PLAYERS = [
  { id: 1,  name: "Beckett Gwinn",   isQB: false, isCenter: true,  centerPriority: 2, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 2,  name: "Cooper Kautzman", isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 3,  name: "Hank Sousa",      isQB: false, isCenter: true,  centerPriority: 1, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 4,  name: "Henry Cole",      isQB: true,  isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: true,  safetyAlt: false, targetPct: 75, present: true  },
  { id: 5,  name: "Julian Meadows",  isQB: true,  isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: true,  safetyPrimary: true,  safetyAlt: false, targetPct: 75, present: true  },
  { id: 6,  name: "Lewis Groh",      isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 7,  name: "Lucas Laselle",   isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 8,  name: "Lyndon Villegas", isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: false },
  { id: 9,  name: "Maddox Hille",    isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: true,  safetyPrimary: false, safetyAlt: false, targetPct: 75, present: true  },
  { id: 10, name: "Niko Noyes",      isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: true,  rusherAlt: false, safetyPrimary: false, safetyAlt: true,  targetPct: 75, present: true  },
  { id: 11, name: "Rory Clarke",     isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: true,  rusherAlt: false, safetyPrimary: false, safetyAlt: true,  targetPct: 75, present: true  },
  { id: 12, name: "Theo Woodard",    isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
  { id: 13, name: "Winston Kirsch",  isQB: false, isCenter: true,  centerPriority: 1, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 65, present: true  },
];

const FIELD_SIZE = 7;
const HENRY_ID = 4;
const JULIAN_ID = 5;
// Henry alternates: sits first series of whichever side we open with, then plays the other
// After that, streak-based rotation takes over
const QB_REST_EVERY = 4;

// Critical offense: Henry, Julian, Rory, Maddox, Niko + Hank (or Beckett) as center — no Winston
const CRITICAL_OFFENSE_CORE = [4, 5, 11, 9, 10]; // Henry, Julian, Rory, Maddox, Niko
const CRITICAL_OFFENSE_PREFERRED_CENTERS = [3, 1]; // Hank (3) first, Beckett (1) backup
// Critical defense: Henry, Julian, Rory, Niko, Maddox, Lewis — no Winston
const CRITICAL_DEFENSE_CORE = [4, 5, 11, 10, 9, 6]; // Henry, Julian, Rory, Niko, Maddox, Lewis

function buildCounts(presentIds, history) {
  const counts = {};
  presentIds.forEach((id) => (counts[id] = { offense: 0, defense: 0, total: 0 }));
  history.forEach((s) => {
    s.lineup.forEach((pid) => {
      if (counts[pid]) { counts[pid][s.side]++; counts[pid].total++; }
    });
  });
  return counts;
}

function actualPct(id, counts, totalSeries, side) {
  if (totalSeries === 0) return 0;
  // When side is provided, measure that side's count against half the target
  // (assuming roughly equal offense/defense splits over a game)
  if (side) {
    const sideSeries = counts[id]?.[side] ?? 0;
    // Each side has roughly totalSeries/2 opportunities; target is per-side half of overall target
    const sideOpportunities = Math.max(1, totalSeries / 2);
    return sideSeries / sideOpportunities * 100;
  }
  return (counts[id]?.total ?? 0) / totalSeries * 100;
}

// deficit: negative = behind target = should play, positive = ahead = bench candidate
// When building offense, use offense-side deficit. Defense uses defense-side deficit.
// Blend: 60% side-specific, 40% total — keeps per-side fairness while avoiding total neglect
function deficit(player, counts, totalSeries, side) {
  if (totalSeries === 0) return -player.targetPct;
  const totalDef = actualPct(player.id, counts, totalSeries) - player.targetPct;
  if (!side) return totalDef;
  const sideDef = actualPct(player.id, counts, totalSeries, side) - player.targetPct;
  return sideDef * 0.6 + totalDef * 0.4;
}

// Henry opening rest rule:
// - Open offense: Henry plays, sits FIRST defensive series
// - Open defense: Henry sits, plays FIRST offensive series
// Opening series rules:
// - Open OFFENSE: both QBs play. Henry sits the very next DEFENSIVE series.
// - Open DEFENSE: Henry sits series 1. Henry plays the very next OFFENSIVE series.
// Returns HENRY_ID (force sit Henry), null (force both play), undefined (use normal rotation).
function henryOpeningRest(side, history) {
  if (history.length === 0) {
    // Series 1: sit Henry on defense, both play on offense
    return side === "defense" ? HENRY_ID : null;
  }
  const firstSide = history[0].side;
  const oppositeSide = firstSide === "offense" ? "defense" : "offense";

  if (firstSide === "offense") {
    // Opened on offense. Has Henry played his mandatory first defensive rest yet?
    // Find the first defensive series ever played.
    const firstDefenseSeries = history.find((s) => s.side === "defense");
    if (!firstDefenseSeries) {
      // No defensive series yet — if this is defense, Henry sits
      return side === "defense" ? HENRY_ID : null;
    }
    // First defensive series found. Did Henry sit it?
    const henrySatFirstDef = !firstDefenseSeries.lineup.includes(HENRY_ID);
    if (!henrySatFirstDef) {
      // Henry didn't sit the first defensive series (maybe overridden) — opening rule done
      return undefined;
    }
    // Henry sat the first defensive series correctly — opening rule complete, hand off
    return undefined;
  } else {
    // Opened on defense. Henry sat series 1 (or should have). 
    // Has he played his first offensive series yet?
    const henryAppearedOffense = history.some(
      (s) => s.side === "offense" && s.lineup.includes(HENRY_ID)
    );
    if (!henryAppearedOffense) {
      // Still waiting for first offensive series — sit on defense, play on offense
      return side === "defense" ? HENRY_ID : null;
    }
    return undefined; // opening pattern done
  }
}

// Henry rest: count how many series he's played. Rest him when he's ahead of target.
// Henry's effective target is slightly lower than Julian's — he needs more rest.
// Henry sits when surplus >= 0.7 series ahead of target.
// Julian only sits when surplus >= 1.5 series ahead (he plays as much as possible).
// Count consecutive series a player has appeared in (from most recent backwards)
function streak(playerId, history) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].lineup.includes(playerId)) n++;
    else break;
  }
  return n;
}

// Did this player sit the immediately previous series?
function satLastSeries(playerId, history) {
  if (history.length === 0) return false;
  return !history[history.length - 1].lineup.includes(playerId);
}

function whichQBRests(qbs, counts, totalSeries, history) {
  if (totalSeries < 2) return null;

  const henry = qbs.find((p) => p.id === HENRY_ID);
  const julian = qbs.find((p) => p.id === JULIAN_ID);

  // Henry rests when:
  // - He hasn't sat last series AND
  // - He's played 3+ consecutive series OR is at least 0.5 series over his target
  if (henry && !satLastSeries(HENRY_ID, history)) {
    const played = counts[HENRY_ID]?.total ?? 0;
    const expected = totalSeries * (henry.targetPct / 100);
    const henryStreak = streak(HENRY_ID, history);
    if (henryStreak >= 3 || (played - expected) >= 0.5) return HENRY_ID;
  }

  // Julian rests only when he's played 5+ consecutive OR is 1.0+ series over target
  if (julian && !satLastSeries(JULIAN_ID, history)) {
    const played = counts[JULIAN_ID]?.total ?? 0;
    const expected = totalSeries * (julian.targetPct / 100);
    const julianStreak = streak(JULIAN_ID, history);
    if (julianStreak >= 5 || (played - expected) >= 1.0) return JULIAN_ID;
  }

  return null;
}

function sortByDeficit(arr, counts, totalSeries, side) {
  return [...arr].sort((a, b) => deficit(a, counts, totalSeries, side) - deficit(b, counts, totalSeries, side));
}

function buildCriticalOffense(players, history) {
  const present = players.filter((p) => p.present);
  const counts = buildCounts(present.map((p) => p.id), history);
  const totalSeries = history.length;
  const nonQBCenters = present.filter((p) => p.isCenter && !p.isQB);

  // Lock in core players that are present
  const corePresent = CRITICAL_OFFENSE_CORE.filter((id) => present.find((p) => p.id === id));
  const reservedIds = new Set(corePresent);

  // Preferred center: Hank first, Beckett second, then any other non-QB center — never Winston
  const center = CRITICAL_OFFENSE_PREFERRED_CENTERS
    .map((id) => present.find((p) => p.id === id))
    .find((p) => p && !reservedIds.has(p.id))
    || sortByDeficit(nonQBCenters.filter((p) => !reservedIds.has(p.id) && p.id !== 13), counts, totalSeries)[0];
  if (center) reservedIds.add(center.id);

  // Fill remaining
  const fillerCount = FIELD_SIZE - reservedIds.size;
  const fillers = sortByDeficit(present.filter((p) => !reservedIds.has(p.id)), counts, totalSeries).slice(0, fillerCount);
  const lineup = [...corePresent, ...(center ? [center.id] : []), ...fillers.map((p) => p.id)];
  const lineupSet = new Set(lineup);
  return { lineup, bench: present.filter((p) => !lineupSet.has(p.id)).map((p) => p.id), critical: true };
}

function buildCriticalDefense(players, history) {
  const present = players.filter((p) => p.present);
  const counts = buildCounts(present.map((p) => p.id), history);
  const totalSeries = history.length;

  const corePresent = CRITICAL_DEFENSE_CORE.filter((id) => present.find((p) => p.id === id));
  const reservedIds = new Set(corePresent);

  const fillerCount = FIELD_SIZE - reservedIds.size;
  const fillers = sortByDeficit(present.filter((p) => !reservedIds.has(p.id)), counts, totalSeries).slice(0, fillerCount);
  const lineup = [...corePresent, ...fillers.map((p) => p.id)];
  const lineupSet = new Set(lineup);
  return { lineup, bench: present.filter((p) => !lineupSet.has(p.id)).map((p) => p.id), critical: true };
}

function buildOffenseLineup(players, history, forceRestId) {
  const present = players.filter((p) => p.present);
  const totalSeries = history.length;
  const counts = buildCounts(present.map((p) => p.id), history);
  const qbs = present.filter((p) => p.isQB);
  const nonQBCenters = present.filter((p) => p.isCenter && !p.isQB);

  if (present.length < FIELD_SIZE) return { error: `Need at least ${FIELD_SIZE} present. Have ${present.length}.` };
  if (qbs.length < 2) return { error: "Need both Henry and Julian present for offense." };
  if (nonQBCenters.length === 0) return { error: "No center available (Hank, Winston, or Beckett)." };

  let restingQBId;
  if (forceRestId === "none") {
    restingQBId = null;
  } else if (forceRestId != null) {
    restingQBId = forceRestId;
  } else {
    // Check Henry opening rule first
    const openingRest = henryOpeningRest("defense", history);
    if (openingRest !== undefined) {
      restingQBId = openingRest;
    } else {
      restingQBId = whichQBRests(qbs, counts, totalSeries, history);
    }
  }

  let activeQBs = restingQBId ? qbs.filter((p) => p.id !== restingQBId) : [...qbs];
  if (activeQBs.length === 0) { restingQBId = null; activeQBs = [...qbs]; }
  const reservedIds = new Set(activeQBs.map((p) => p.id));

  const availCenters = nonQBCenters
    .filter((p) => !reservedIds.has(p.id))
    .sort((a, b) => {
      const defDiff = deficit(a, counts, totalSeries, "offense") - deficit(b, counts, totalSeries, "offense");
      if (a.centerPriority !== b.centerPriority && Math.abs(defDiff) < 10)
        return a.centerPriority - b.centerPriority;
      return defDiff;
    });
  if (availCenters.length === 0) return { error: "No eligible center available." };
  const pickedCenter = availCenters[0];
  reservedIds.add(pickedCenter.id);

  const fillerCount = FIELD_SIZE - reservedIds.size;
  const fillers = sortByDeficit(present.filter((p) => !reservedIds.has(p.id)), counts, totalSeries, "offense").slice(0, fillerCount);

  const offense = [...activeQBs, pickedCenter, ...fillers];
  const offenseIds = new Set(offense.map((p) => p.id));
  return {
    lineup: offense.map((p) => p.id),
    bench: present.filter((p) => !offenseIds.has(p.id)).map((p) => p.id),
    restingSuggestion: restingQBId ?? null,
  };
}

function buildDefenseLineup(players, history, forceRestId) {
  const present = players.filter((p) => p.present);
  const totalSeries = history.length;
  const counts = buildCounts(present.map((p) => p.id), history);
  const qbs = present.filter((p) => p.isQB);

  if (present.length < FIELD_SIZE) return { error: `Need at least ${FIELD_SIZE} present. Have ${present.length}.` };

  let restingQBId;
  if (forceRestId === "none") {
    restingQBId = null;
  } else if (forceRestId != null) {
    restingQBId = forceRestId;
  } else {
    const openingRest = henryOpeningRest("defense", history);
    if (openingRest !== undefined) {
      restingQBId = openingRest;
    } else {
      restingQBId = whichQBRests(qbs, counts, totalSeries, history);
    }
  }

  let activeQBs = restingQBId ? qbs.filter((p) => p.id !== restingQBId) : [...qbs];
  if (activeQBs.length === 0) { restingQBId = null; activeQBs = [...qbs]; }
  const reservedIds = new Set(activeQBs.map((p) => p.id));

  // Active QBs are already on the field — they can also fill rusher/safety roles.
  // So search the full present list for position eligibility, not just non-reserved.
  // We only need to add to reservedIds for players NOT already on field.
  const activeQBIds = new Set(activeQBs.map((p) => p.id));

  const rushers = present
    .filter((p) => (p.rusherPrimary || p.rusherAlt) && (!reservedIds.has(p.id) || activeQBIds.has(p.id)))
    .sort((a, b) => {
      const defDiff = deficit(a, counts, totalSeries, "defense") - deficit(b, counts, totalSeries, "defense");
      if (a.rusherPrimary !== b.rusherPrimary && Math.abs(defDiff) < 10)
        return (b.rusherPrimary ? 1 : 0) - (a.rusherPrimary ? 1 : 0);
      return defDiff;
    });
  if (rushers.length === 0) return { error: "No pass rusher available (Niko, Rory, Maddox, or Julian)." };
  const pickedRusher = rushers[0];
  if (!activeQBIds.has(pickedRusher.id)) reservedIds.add(pickedRusher.id);

  const safeties = present
    .filter((p) => (p.safetyPrimary || p.safetyAlt) && (!reservedIds.has(p.id) || activeQBIds.has(p.id)))
    .sort((a, b) => {
      const defDiff = deficit(a, counts, totalSeries, "defense") - deficit(b, counts, totalSeries, "defense");
      if (a.safetyPrimary !== b.safetyPrimary && Math.abs(defDiff) < 10)
        return (b.safetyPrimary ? 1 : 0) - (a.safetyPrimary ? 1 : 0);
      return defDiff;
    });
  if (safeties.length === 0) return { error: "No safety available (Julian, Henry, Rory, or Niko)." };
  const pickedSafety = safeties[0];
  if (!activeQBIds.has(pickedSafety.id)) reservedIds.add(pickedSafety.id);

  // Build lineup without duplicates. QBs may already cover rusher/safety roles.
  const lineupIds = new Set(activeQBs.map((p) => p.id));
  if (!lineupIds.has(pickedRusher.id)) lineupIds.add(pickedRusher.id);
  if (!lineupIds.has(pickedSafety.id)) lineupIds.add(pickedSafety.id);

  const fillerCount = FIELD_SIZE - lineupIds.size;
  const fillers = sortByDeficit(
    present.filter((p) => !lineupIds.has(p.id)),
    counts, totalSeries, "defense"
  ).slice(0, fillerCount);
  fillers.forEach((p) => lineupIds.add(p.id));

  const lineupArr = present.filter((p) => lineupIds.has(p.id));
  return {
    lineup: lineupArr.map((p) => p.id),
    bench: present.filter((p) => !lineupIds.has(p.id)).map((p) => p.id),
    restingSuggestion: restingQBId ?? null,
  };
}

// ---- App ----
export default function App() {
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [history, setHistory] = useState([]);
  const [currentSeries, setCurrentSeries] = useState(null);
  const [seriesNum, setSeriesNum] = useState(1);
  const [view, setView] = useState("attendance");
  const [gameStarted, setGameStarted] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [swapTarget, setSwapTarget] = useState(null);
  const [error, setError] = useState("");

  const present = players.filter((p) => p.present);
  const totalSeries = history.length;
  const counts = buildCounts(present.map((p) => p.id), history);
  const playerById = (id) => players.find((p) => p.id === id);

  const buildLineup = (side, forceRestId, critical = false) => {
    if (critical) return side === "offense" ? buildCriticalOffense(players, history) : buildCriticalDefense(players, history);
    return side === "offense" ? buildOffenseLineup(players, history, forceRestId) : buildDefenseLineup(players, history, forceRestId);
  };

  const selectSide = (side, critical = false) => {
    setError(""); setSwapTarget(null);
    const result = buildLineup(side, null, critical);
    if (result.error) { setError(result.error); return; }
    setCurrentSeries({ side, critical: !!critical, ...result });
  };

  const endSeries = () => {
    if (!currentSeries) return;
    setHistory((h) => [...h, { series: seriesNum, side: currentSeries.side, lineup: currentSeries.lineup }]);
    setSeriesNum((n) => n + 1);
    setCurrentSeries(null);
    setSwapTarget(null);
    setError("");
  };

  const applyRestOverride = (override) => {
    if (!currentSeries) return;
    const result = buildLineup(currentSeries.side, override);
    if (result.error) { setError(result.error); return; }
    setCurrentSeries({ ...currentSeries, ...result });
    setSwapTarget(null); setError("");
  };

  const swapPlayer = (inId) => {
    if (!swapTarget || !currentSeries) return;
    const newLineup = currentSeries.lineup.map((id) => id === swapTarget ? inId : id);
    const newBench = currentSeries.bench.map((id) => id === inId ? swapTarget : id);
    const lp = newLineup.map((id) => playerById(id));
    if (currentSeries.side === "offense") {
      if (!lp.some((p) => p?.isCenter && !p?.isQB)) { setError("Need a center on offense."); return; }
    } else {
      if (!lp.some((p) => p?.isQB)) { setError("At least one of Henry/Julian must be on defense."); return; }
      if (!lp.some((p) => p?.rusherPrimary || p?.rusherAlt)) { setError("Need a pass rusher on defense."); return; }
      if (!lp.some((p) => p?.safetyPrimary || p?.safetyAlt)) { setError("Need a safety on defense."); return; }
    }
    setCurrentSeries({ ...currentSeries, lineup: newLineup, bench: newBench, restingSuggestion: null });
    setSwapTarget(null); setError("");
  };

  const resetGame = () => {
    setHistory([]); setCurrentSeries(null); setSeriesNum(1);
    setSwapTarget(null); setError(""); setGameStarted(false); setView("attendance");
  };

  const togglePresent = (id) => setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, present: !p.present } : p));
  const toggleQB     = (id) => setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, isQB: !p.isQB } : p));
  const toggleCenter = (id) => setPlayers((ps) => ps.map((p) => p.id === id ? { ...p, isCenter: !p.isCenter } : p));
  const addPlayer = () => {
    const name = newPlayerName.trim(); if (!name) return;
    setPlayers((ps) => [...ps, { id: Date.now(), name, isQB: false, isCenter: false, centerPriority: 0, rusherPrimary: false, rusherAlt: false, safetyPrimary: false, safetyAlt: false, targetPct: 52, present: true }]);
    setNewPlayerName("");
  };
  const removePlayer = (id) => setPlayers((ps) => ps.filter((p) => p.id !== id));

  const c = {
    bg: "#161f16", card: "#1e2b1e", cardAlt: "#192519",
    border: "#2a3d2a", accent: "#c9961a",
    green: "#2a6e2a", blueLight: "#3a6aaa", red: "#8a2a2a",
    text: "#e8ede8", muted: "#5a7a5a", danger: "#5a1515",
    offBg: "#1c3020", defBg: "#1a2030", warnBg: "#2a1f00", critBg: "#2a1a00",
  };

  const s = {
    app: { minHeight: "100vh", background: c.bg, color: c.text, fontFamily: "'Inter','Helvetica Neue',sans-serif", paddingBottom: "max(48px, calc(env(safe-area-inset-bottom, 0px) + 24px))", WebkitTapHighlightColor: "transparent" },
    header: { background: "#111811", paddingTop: "max(12px, env(safe-area-inset-top, 12px))", paddingBottom: "12px", paddingLeft: "max(16px, env(safe-area-inset-left, 16px))", paddingRight: "max(16px, env(safe-area-inset-right, 16px))", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${c.border}` },
    title: { fontSize: 17, fontWeight: 700, letterSpacing: "0.03em", margin: 0 },
    sub: { fontSize: 11, color: c.muted, marginTop: 2 },
    tabs: { display: "flex", gap: 5 },
    tab: (a) => ({ padding: "6px 10px", borderRadius: 6, border: "1px solid", borderColor: a ? c.accent : c.border, background: a ? c.accent : "transparent", color: a ? "#111" : c.muted, fontSize: 11, fontWeight: 700, cursor: "pointer" }),
    body: { padding: "14px 16px", maxWidth: 520, margin: "0 auto" },
    card: (side) => ({ background: side === "offense" ? c.offBg : side === "defense" ? c.defBg : side === "critical" ? c.critBg : c.card, borderRadius: 10, border: `1px solid ${side === "critical" ? "#6a3a00" : c.border}`, marginBottom: 12, overflow: "hidden" }),
    cardHead: { padding: "9px 13px", background: "rgba(0,0,0,0.25)", borderBottom: `1px solid rgba(255,255,255,0.05)`, display: "flex", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: c.muted, textTransform: "uppercase" },
    row: (mode) => ({ display: "flex", alignItems: "center", padding: "9px 13px", borderBottom: `1px solid rgba(0,0,0,0.2)`, gap: 7, cursor: (mode === "tap" || mode === "swap") ? "pointer" : "default", background: mode === "swap" ? "#3a2800" : "transparent" }),
    name: { flex: 1, fontSize: 14, fontWeight: 500 },
    badge: (t) => ({ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.04em", background: t === "QB" ? c.accent : t === "C" ? c.blueLight : t === "R" ? "#7a2a2a" : t === "S" ? "#2a5a7a" : t === "ON" ? c.green : t === "CRIT" ? "#8a3a00" : "#2a3a2a", color: t === "QB" ? "#111" : c.text }),
    btn: (v) => ({ padding: v === "sm" ? "5px 9px" : "9px 16px", borderRadius: 7, border: v === "ghost" ? `1px solid ${c.border}` : "none", background: v === "primary" ? c.accent : v === "off" ? "#1e4a2a" : v === "def" ? "#1e2a4a" : v === "crit" ? "#6a2a00" : v === "ghost" ? "transparent" : v === "danger" ? c.danger : v === "warn" ? "#3a2800" : c.border, color: v === "primary" ? "#111" : c.text, fontSize: v === "sm" ? 11 : 13, fontWeight: 700, cursor: "pointer" }),
    input: { flex: 1, background: c.cardAlt, border: `1px solid ${c.border}`, borderRadius: 6, padding: "7px 10px", color: c.text, fontSize: 13, outline: "none" },
    err: { fontSize: 12, color: "#e05050", padding: "8px 13px", background: "#2a1010", borderRadius: 8, marginBottom: 10 },
    sideLabel: (side, crit) => ({ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: crit ? "#e09040" : side === "offense" ? "#5aaa6a" : "#5a7aaa", padding: "2px 7px", borderRadius: 4, background: crit ? "#3a1800" : side === "offense" ? "#1a3a20" : "#1a2a3a", border: `1px solid ${crit ? "#6a3a00" : side === "offense" ? "#2a5a2a" : "#2a3a5a"}` }),
    checkBox: (on) => ({ width: 22, height: 22, borderRadius: 5, border: "2px solid", borderColor: on ? "#2e9e2e" : c.border, background: on ? "#2e9e2e" : "transparent", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700 }),
  };

  const positionBadges = (p, side) => {
    const b = [];
    if (p.isQB) b.push(<span key="qb" style={s.badge("QB")}>QB</span>);
    if (side === "offense" && p.isCenter && !p.isQB) b.push(<span key="c" style={s.badge("C")}>C</span>);
    if (side === "defense") {
      if (p.rusherPrimary || p.rusherAlt) b.push(<span key="r" style={s.badge("R")}>R</span>);
      if (p.safetyPrimary || p.safetyAlt) b.push(<span key="s" style={s.badge("S")}>S</span>);
    }
    return b;
  };

  const PctBar = ({ actual, target }) => {
    const over = actual > target + 4;
    const under = actual < target - 4;
    const color = over ? "#c9961a" : under ? "#5a7aaa" : "#2a9e4a";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
        <div style={{ flex: 1, height: 5, background: "#2a3a2a", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(actual, 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 11, color, minWidth: 34, textAlign: "right" }}>{Math.round(actual)}%</span>
      </div>
    );
  };

  // ---- Attendance ----
  const renderAttendance = () => (
    <>
      <div style={{ fontSize: 13, color: c.muted, marginBottom: 12 }}>Mark who's here today, then start the game.</div>
      <div style={s.card(null)}>
        <div style={s.cardHead}>
          <span style={s.cardTitle}>Today's Roster</span>
          <span style={{ fontSize: 11, color: c.muted }}>{present.length} present</span>
        </div>
        {players.map((p) => (
          <div key={p.id} style={s.row("tap")} onClick={() => togglePresent(p.id)}>
            <div style={s.checkBox(p.present)}>{p.present ? "✓" : ""}</div>
            <span style={{ ...s.name, color: p.present ? c.text : c.muted }}>{p.name}</span>
            {p.isQB && <span style={s.badge("QB")}>QB</span>}
            {p.isCenter && !p.isQB && <span style={s.badge("C")}>C</span>}
          </div>
        ))}
      </div>
      <button
        style={{ ...s.btn("primary"), width: "100%", padding: "13px", fontSize: 15, opacity: present.length >= FIELD_SIZE ? 1 : 0.4 }}
        onClick={() => { if (present.length >= FIELD_SIZE) { setGameStarted(true); setView("game"); } }}
      >
        Start Game ({present.length} players)
      </button>
      {present.length < FIELD_SIZE && (
        <div style={{ fontSize: 12, color: "#e05050", textAlign: "center", marginTop: 8 }}>Need at least {FIELD_SIZE} players.</div>
      )}
    </>
  );

  // ---- Game ----
  const renderGame = () => {
    const restingPlayer = currentSeries?.restingSuggestion ? playerById(currentSeries.restingSuggestion) : null;
    const otherQB = restingPlayer ? players.find((p) => p.isQB && p.id !== restingPlayer.id && p.present) : null;
    const isCritical = currentSeries?.critical;

    return (
      <>
        {error && <div style={s.err}>{error}</div>}

        {/* Side selector */}
        {!currentSeries ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>Series {seriesNum}: select side:</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <button style={{ ...s.btn("off"), padding: "13px 0", fontSize: 15, flex: 1, borderRadius: 10 }} onClick={() => selectSide("offense")}>⚡ Offense</button>
              <button style={{ ...s.btn("def"), padding: "13px 0", fontSize: 15, flex: 1, borderRadius: 10 }} onClick={() => selectSide("defense")}>🛡 Defense</button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...s.btn("crit"), padding: "10px 0", fontSize: 13, flex: 1, borderRadius: 8 }} onClick={() => selectSide("offense", true)}>🔥 Critical Offense</button>
              <button style={{ ...s.btn("crit"), padding: "10px 0", fontSize: 13, flex: 1, borderRadius: 8 }} onClick={() => selectSide("defense", true)}>🔥 Critical Defense</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button style={s.btn("primary")} onClick={endSeries}>End Series / Next &rarr;</button>
            <button style={s.btn("ghost")} onClick={() => { setCurrentSeries(null); setError(""); setSwapTarget(null); }}>Change Side</button>
            <span style={{ flex: 1 }} />
            {isCritical && <span style={s.sideLabel(currentSeries.side, true)}>CRITICAL</span>}
            <span style={s.sideLabel(currentSeries.side)}>{currentSeries.side}</span>
          </div>
        )}

        {/* Rest suggestion */}
        {currentSeries && restingPlayer && !isCritical && (
          <div style={{ background: c.warnBg, border: `1px solid #4a3a00`, borderRadius: 8, padding: "10px 13px", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: c.accent, marginBottom: 7 }}>
              <strong>{restingPlayer.name}</strong> is over their playing time target. Good series to rest them.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={s.btn("warn")} onClick={() => applyRestOverride("none")}>Keep in</button>
              {otherQB && <button style={s.btn("warn")} onClick={() => applyRestOverride(otherQB.id)}>Rest {otherQB.name} instead</button>}
            </div>
          </div>
        )}

        {/* Active lineup */}
        {currentSeries && (
          <div style={s.card(isCritical ? "critical" : currentSeries.side)}>
            <div style={s.cardHead}>
              <span style={s.cardTitle}>Series {seriesNum}{isCritical ? " CRITICAL" : ""} · {currentSeries.side}</span>
              <span style={{ fontSize: 11, color: c.muted }}>Tap to swap</span>
            </div>
            {currentSeries.lineup.map((id) => {
              const p = playerById(id); if (!p) return null;
              const isOut = swapTarget === id;
              return (
                <div key={id} style={{ ...s.row(isOut ? "swap" : "tap"), background: isOut ? "#3a2800" : "transparent" }}
                  onClick={() => { setSwapTarget(isOut ? null : id); setError(""); }}>
                  <span style={s.name}>{p.name}</span>
                  {positionBadges(p, currentSeries.side)}
                  <span style={s.badge("ON")}>ON</span>
                </div>
              );
            })}
            {currentSeries.bench.length > 0 && (
              <>
                <div style={{ ...s.cardHead, borderTop: `1px solid rgba(255,255,255,0.04)` }}>
                  <span style={s.cardTitle}>Bench</span>
                  {swapTarget && <span style={{ fontSize: 11, color: c.accent }}>Tap to sub in</span>}
                </div>
                {currentSeries.bench.map((id) => {
                  const p = playerById(id); if (!p) return null;
                  return (
                    <div key={id} style={s.row(swapTarget ? "tap" : null)} onClick={() => swapTarget && swapPlayer(id)}>
                      <span style={{ ...s.name, color: swapTarget ? c.text : c.muted }}>{p.name}</span>
                      {positionBadges(p, currentSeries.side)}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Playing time */}
        {(totalSeries > 0 || currentSeries) && (
          <div style={s.card(null)}>
            <div style={s.cardHead}>
              <span style={s.cardTitle}>Playing Time</span>
              <span style={{ fontSize: 11, color: c.muted }}>{totalSeries} series logged</span>
            </div>
            {[...present]
              .sort((a, b) => (counts[b.id]?.total ?? 0) - (counts[a.id]?.total ?? 0))
              .map((p) => {
                const tot = counts[p.id]?.total ?? 0;
                const off = counts[p.id]?.offense ?? 0;
                const def = counts[p.id]?.defense ?? 0;
                const act = totalSeries > 0 ? tot / totalSeries * 100 : 0;
                const onNow = currentSeries?.lineup.includes(p.id);
                return (
                  <div key={p.id} style={{ padding: "8px 13px", borderBottom: `1px solid rgba(0,0,0,0.15)`, display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                    {p.isQB && <span style={s.badge("QB")}>QB</span>}
                    {onNow && <span style={s.badge("ON")}>ON</span>}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, minWidth: 150 }}>
                      <PctBar actual={act} target={p.targetPct} />
                      <span style={{ fontSize: 10, color: c.muted }}>{off}O / {def}D · target {p.targetPct}%</span>
                    </div>
                  </div>
                );
              })}
            <div style={{ padding: "6px 13px", fontSize: 10, color: c.muted }}>
              <span style={{ color: "#2a9e4a" }}>■</span> on track &nbsp;
              <span style={{ color: "#c9961a" }}>■</span> over &nbsp;
              <span style={{ color: "#5a7aaa" }}>■</span> under
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={s.card(null)}>
            <div style={s.cardHead}>
              <span style={s.cardTitle}>History</span>
              <button style={{ ...s.btn("ghost"), padding: "3px 8px", fontSize: 11 }} onClick={resetGame}>Reset</button>
            </div>
            {[...history].reverse().map((h, i) => (
              <div key={i} style={{ padding: "7px 13px", borderBottom: `1px solid rgba(0,0,0,0.2)` }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 3, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: c.muted }}>Series {h.series}</span>
                  <span style={s.sideLabel(h.side)}>{h.side}</span>
                  {h.critical && <span style={s.sideLabel(h.side, true)}>CRITICAL</span>}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                  {h.lineup.map((id) => { const p = playerById(id); return p ? <span key={id} style={{ marginRight: 10 }}>{p.name}</span> : null; })}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // ---- Roster ----
  const renderRoster = () => (
    <>
      <div style={s.card(null)}>
        <div style={s.cardHead}><span style={s.cardTitle}>Add Player</span></div>
        <div style={{ padding: 12, display: "flex", gap: 8 }}>
          <input style={s.input} placeholder="Full name" value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <button style={s.btn("primary")} onClick={addPlayer}>Add</button>
        </div>
      </div>
      <div style={s.card(null)}>
        <div style={s.cardHead}>
          <span style={s.cardTitle}>Full Roster</span>
          <span style={{ fontSize: 11, color: c.muted }}>Attendance on Game Day tab</span>
        </div>
        {players.map((p) => (
          <div key={p.id} style={{ ...s.row(null), flexWrap: "wrap", gap: 6 }}>
            <span style={{ ...s.name, minWidth: 120 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: c.muted }}>target {p.targetPct}%</span>
            <button style={{ ...s.btn("sm"), background: p.isQB ? c.accent : c.border, color: p.isQB ? "#111" : c.muted }} onClick={() => toggleQB(p.id)}>QB</button>
            <button style={{ ...s.btn("sm"), background: p.isCenter ? c.blueLight : c.border, color: p.isCenter ? "#fff" : c.muted }} onClick={() => toggleCenter(p.id)}>C</button>
            <button style={{ ...s.btn("sm"), background: c.danger, padding: "5px 7px" }} onClick={() => removePlayer(p.id)}>✕</button>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Flag Football Rotations</div>
          <div style={s.sub}>7v7 · Offense and Defense</div>
        </div>
        <div style={s.tabs}>
          <button style={s.tab(view === "attendance")} onClick={() => setView("attendance")}>{gameStarted ? "Attendance" : "Game Day"}</button>
          <button style={s.tab(view === "game")} onClick={() => gameStarted && setView("game")} disabled={!gameStarted}>Game</button>
          <button style={s.tab(view === "roster")} onClick={() => setView("roster")}>Roster</button>
        </div>
      </div>
      <div style={s.body}>
        {view === "attendance" && renderAttendance()}
        {view === "game" && renderGame()}
        {view === "roster" && renderRoster()}
      </div>
    </div>
  );
}
