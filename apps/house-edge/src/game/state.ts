import { colorOf, POCKET_COUNT, resolveSpin, totalStake, type Layout, type SpinResult } from "../engine";
import { offerRelics, uniqueRelicsOf } from "./relics";
import {
  buildEdge,
  costOf,
  levelOf,
  offlineRate,
  spinIntervalMs,
  startingChips,
  denomAt,
  UPGRADE_BY_ID,
  type UpgradeLevels,
} from "./upgrades";

export const SAVE_KEY = "house-edge:v1";
/** Peak chips needed for the first Ivory; ivory = floor(sqrt(peak / scale)). */
export const IVORY_SCALE = 1e6;
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
/** Offline is simulated spin-by-spin up to this many, then extrapolated. */
export const OFFLINE_SIM_CAP = 20_000;
export const HISTORY_LEN = 14;
/** Smallest chip that exists, and so the smallest legal bet. */
export const MIN_CHIP = denomAt(0);
/** The guaranteed minimum a scramble pays out. */
export const HOUSE_STAKE = MIN_CHIP * 2;

/** Relic slots you start with, and one more per this many cash outs. */
export const RELIC_SLOTS_BASE = 5;
export const RELIC_SLOTS_PER_CASHOUT = 5;
export const RELIC_SLOTS_MAX = 8;

/**
 * Owning a relic and using one are deliberately different things. Relics are
 * permanent and additive, so without a cap every player converges on the same
 * everything-equipped build by the time the pool is drafted out. Slots make a
 * loadout a choice, and earning slots makes later prestiges feel different.
 */
export function relicSlots(state: GameState): number {
  return Math.min(
    RELIC_SLOTS_MAX,
    RELIC_SLOTS_BASE + Math.floor(state.cashOuts / RELIC_SLOTS_PER_CASHOUT),
  );
}

/** How many copies of a relic id a list holds. Duplicates stack. */
export function countOf(list: string[], id: string): number {
  return list.filter((r) => r === id).length;
}

/** Equippable when a slot is free and you own a copy that is not already in. */
export function canEquip(state: GameState, id: string): boolean {
  return (
    state.activeRelics.length < relicSlots(state) &&
    countOf(state.activeRelics, id) < countOf(state.relics, id)
  );
}

export function equipRelic(state: GameState, id: string): GameState {
  return canEquip(state, id)
    ? { ...state, activeRelics: [...state.activeRelics, id] }
    : state;
}

export function unequipRelic(state: GameState, id: string): GameState {
  const i = state.activeRelics.indexOf(id);
  if (i < 0) return state;
  const activeRelics = [...state.activeRelics];
  activeRelics.splice(i, 1);
  return { ...state, activeRelics };
}

/**
 * "Loose Change" — the pit boss's game, open whenever the player wants it and
 * the only way back in after going bust. Coins spill across the floor and you
 * scramble for them.
 *
 * There is no fail state, no clock and no forced ending: dropping a coin costs
 * nothing, and the rack keeps spilling for as long as you keep playing. Once
 * you are holding CHANGE_MIN_TAKE you may stop whenever you like, and that is
 * the only way the round ends.
 *
 * Everything here is counted in **cents** and every value is a multiple of 5.
 * Accumulating dollars as floats drifts — 0.1 + 0.2 is famously not 0.3 — and
 * a running total that lands on $10.000000000000002 both reads wrong and makes
 * the take-home comparison flaky. Integers cannot drift.
 */
/**
 * Cents you must be holding — bankroll *plus* change in hand — before the house
 * will let you walk away. Measuring the two together is the point: the line
 * exists to guarantee a playable stake, and someone who arrives with $15
 * already has most of one. Set to meet HOUSE_STAKE exactly, so reaching the
 * line and clearing the floor are the same event.
 */
export const CHANGE_MIN_TAKE = HOUSE_STAKE * 100;
/**
 * What a pile of change is worth, rounded *down* to whole dollars so the payout
 * never quietly credits money that was not caught.
 *
 * Whole dollars rather than whole chips: the take-home line is measured against
 * the bankroll you already hold, so change has to add to chips in the same
 * units. Snapping to the $10 chip would mean a player sitting on $15 could
 * catch $5, watch it round to nothing, and still be told they had reached $20.
 */
export function changeValue(cents: number): number {
  return Math.floor(cents / 100);
}

/**
 * What stopping right now actually credits. The floor is on the *resulting
 * bankroll*, not on the payout — flooring the payout would hand a solvent
 * player HOUSE_STAKE for opening the game and immediately quitting, which is a
 * free money button. This way the floor only ever tops a player up to
 * HOUSE_STAKE, and a player already above it is paid exactly what they caught.
 */
export function changePayout(chips: number, cents: number): number {
  return Math.max(HOUSE_STAKE, chips + changeValue(cents)) - chips;
}

/**
 * Bank a finished scramble. The change is *added* to the bankroll rather than
 * replacing it. A broke player would not notice the difference, but the game is
 * usually opened voluntarily, and replacing the bankroll there would wipe out a
 * rich player for the crime of playing it.
 */
export function settleChange(state: GameState, cents: number): GameState {
  const chips = state.chips + changePayout(state.chips, cents);
  return { ...state, chips, peak: Math.max(state.peak, chips), miniGame: false };
}

export interface GameState {
  chips: number;
  /** Highest chip count this cycle — what Ivory is paid on. */
  peak: number;
  ivory: number;
  /** Every relic ever drafted, duplicates included. */
  relics: string[];
  /** The subset currently equipped. Only these do anything. */
  activeRelics: string[];
  upgrades: UpgradeLevels;
  layout: Layout;
  /** Index into the unlocked denominations list. */
  chipIndex: number;
  /**
   * How many times each pocket has come up, indexed by pocket number. One
   * array rather than a bag of red/black/odd/even counters: every other statistic
   * is derivable from it, so they cannot drift apart or be double-counted, and a
   * new statistic needs no migration.
   */
  pocketCounts: number[];
  /**
   * Money across the felt this cycle. `wagered` and `returned` are kept rather
   * than a single net, because net alone cannot say whether you ground out a
   * small loss over thousands of spins or lost it all in one — and the ratio
   * between them is the realised house edge, which is the number this game is
   * actually about.
   */
  wagered: number;
  returned: number;
  /** Best and worst single-spin net this cycle. */
  bestWin: number;
  worstLoss: number;
  streak: number;
  bestStreak: number;
  spins: number;
  cashOuts: number;
  /** Most recent pockets, newest first. */
  history: number[];
  autoOn: boolean;
  /** True when the last spin ended with the house re-staking you. */
  /** The Loose Change overlay is open. */
  miniGame: boolean;
  lastSeen: number;
  /** Relic ids drafted by the last cash out, awaiting a pick. */
  offer: string[] | null;
}

export function emptyCounts(): number[] {
  return new Array(POCKET_COUNT).fill(0);
}

function tallied(counts: number[] | undefined, pockets: readonly number[]): number[] {
  // Saves written before this field existed load without it.
  const next = counts && counts.length === POCKET_COUNT ? counts.slice() : emptyCounts();
  // Every ball is tallied, not just the one that was paid. They are all fair
  // draws of the same wheel, and counting only the winner would bias the stats
  // toward whatever the player covers — which would wreck the one thing this
  // panel is for, showing the zero coming up at its honest 2.70%.
  for (const pocket of pockets) next[pocket] += 1;
  return next;
}

/** Everything the stats panel shows, derived from the pocket tally alone. */
export interface WheelStats {
  spins: number;
  red: number;
  black: number;
  zero: number;
  odd: number;
  even: number;
  low: number;
  high: number;
  /** Pockets sorted by how often they have come up, hottest first. */
  ranked: { pocket: number; count: number }[];
}

/** How far from its expected share a pocket must sit to be called out. */
const HEAT_SIGMAS = 1.5;
/**
 * Spins before any of this is worth showing — three times round the wheel.
 *
 * Without it the spread test is far too eager early on, because the normal
 * approximation is poor when the expected count is under one: at ten spins a
 * pocket qualified as hot for coming up *twice*, which is not remarkable in the
 * slightest. Below this the table simply shows nothing.
 */
const HEAT_MIN_SPINS = POCKET_COUNT * 3;

export type Heat = "hot" | "cold" | null;

/**
 * Which pockets have genuinely run hot or cold, per pocket index.
 *
 * Deliberately *not* the top and bottom five the Cash Out panel shows. A fixed
 * slice always finds five of each, so on a fresh table it dresses pure noise up
 * as a pattern, and on a long fair run it implies outliers that are not there.
 * Measuring against the spread instead makes it self-calibrating, and it settles
 * at roughly 2-3 hot and 2-3 pockets cold out of 37 on a fair wheel however long
 * it runs — enough to be interesting, never enough to paint the board.
 *
 * This describes what the wheel *has done*. It says nothing about what it will
 * do — a fair wheel has no memory, and the game says so on the Cash Out tab.
 * It is worth showing anyway because Weighted Wheel genuinely does bias
 * outcomes, so at high levels these marks stop being noise and start being the
 * upgrade working.
 */
export function pocketHeat(counts: number[] | undefined): Heat[] {
  const c = counts && counts.length === POCKET_COUNT ? counts : emptyCounts();
  const spins = c.reduce((a, b) => a + b, 0);
  if (spins < HEAT_MIN_SPINS) return new Array(POCKET_COUNT).fill(null);
  const p = 1 / POCKET_COUNT;
  const expected = spins * p;
  const sigma = Math.sqrt(spins * p * (1 - p));
  const band = HEAT_SIGMAS * sigma;
  return c.map((n) => {
    if (n >= expected + band) return "hot";
    if (n <= expected - band) return "cold";
    return null;
  });
}

export function wheelStats(counts: number[] | undefined): WheelStats {
  const c = counts && counts.length === POCKET_COUNT ? counts : emptyCounts();
  const out: WheelStats = {
    spins: 0, red: 0, black: 0, zero: 0, odd: 0, even: 0, low: 0, high: 0, ranked: [],
  };
  for (let pocket = 0; pocket < POCKET_COUNT; pocket++) {
    const n = c[pocket];
    out.spins += n;
    out.ranked.push({ pocket, count: n });
    if (pocket === 0) {
      out.zero += n;
      continue;
    }
    // The zero is neither odd/even nor high/low for betting purposes, so it is
    // excluded from those tallies rather than quietly inflating "even".
    if (colorOf(pocket) === "red") out.red += n;
    else out.black += n;
    if (pocket % 2 === 1) out.odd += n;
    else out.even += n;
    if (pocket <= 18) out.low += n;
    else out.high += n;
  }
  out.ranked.sort((a, b) => b.count - a.count || a.pocket - b.pocket);
  return out;
}

export function initialState(): GameState {
  return {
    chips: 400,
    peak: 400,
    ivory: 0,
    relics: [],
    activeRelics: [],
    upgrades: {},
    layout: {},
    chipIndex: 0,
    pocketCounts: emptyCounts(),
    wagered: 0,
    returned: 0,
    bestWin: 0,
    worstLoss: 0,
    streak: 0,
    bestStreak: 0,
    spins: 0,
    cashOuts: 0,
    history: [],
    autoOn: false,
    miniGame: false,
    lastSeen: Date.now(),
    offer: null,
  };
}

/**
 * Keep the table playable. Two things can strand a player: a bankroll ground
 * down to nothing, and a layout left over from richer times that now costs
 * more than the bankroll — the latter makes `canSpin` quietly false, so
 * auto-spin ticks forever doing nothing. This fixes both, and is applied after
 * every committed spin and on load.
 */
/**
 * There is no automatic re-stake. The floor still exists — Loose Change is
 * always available, cannot be failed and always pays at least HOUSE_STAKE — but
 * it is claimed by the player rather than handed over on a timer. That is why
 * the old cooldown is gone too: the thing the cooldown was rate-limiting was a
 * *free* re-stake, and this one costs a minute of actually playing for it, so
 * busting on purpose is already its own punishment.
 */
export function refit(state: GameState): GameState {
  const chips = state.chips;

  const stake = totalStake(state.layout);
  // An empty table is a valid state — the player has simply not bet yet. Only
  // an existing layout that outgrew the bankroll gets rebuilt.
  if (stake === 0 || stake <= chips) return state;

  // Scale every bet by the same factor so the shape of the layout survives,
  // snapped down to whole chips so the result is a layout the player could
  // have built by tapping, and can rebuild by hand.
  const scale = stake > 0 ? chips / stake : 0;
  const layout: Layout = {};
  for (const [id, amount] of Object.entries(state.layout)) {
    const next = Math.floor((amount * scale) / MIN_CHIP) * MIN_CHIP;
    if (next > 0) layout[id] = next;
  }
  if (totalStake(layout) === 0) {
    // Everything rounded away — keep one spot alive so the wheel can still turn.
    const first = Object.keys(state.layout)[0] ?? "red";
    layout[first] = MIN_CHIP;
  }
  return { ...state, layout };
}

export function edgeOf(state: GameState) {
  // The layout is passed because Sector Play scales with how many separate
  // numbers are covered, so the edge is a function of the bet, not just the build.
  return buildEdge(state.upgrades, state.activeRelics, state.ivory, state.layout);
}

export function intervalOf(state: GameState): number {
  return spinIntervalMs(state.upgrades, uniqueRelicsOf(state.activeRelics));
}

export function autoUnlocked(state: GameState): boolean {
  return levelOf(state.upgrades, "auto") > 0;
}

/**
 * Scale every bet on the table at once, snapped to whole chips. Refuses rather
 * than clamping when the result would exceed the bankroll, so doubling never
 * silently reshapes a layout into something the player did not choose.
 */
export function scaleLayout(state: GameState, factor: number): GameState {
  const entries = Object.entries(state.layout).filter(([, amount]) => amount > 0);
  if (entries.length === 0) return state;
  const layout: Layout = {};
  for (const [id, amount] of entries) {
    layout[id] = Math.max(MIN_CHIP, Math.round((amount * factor) / MIN_CHIP) * MIN_CHIP);
  }
  if (totalStake(layout) > state.chips) return state;
  return { ...state, layout };
}

/** Raise every bet as far as the bankroll allows, keeping the layout's shape. */
export function maxLayout(state: GameState): GameState {
  const stake = stakeOf(state);
  if (stake <= 0) return state;
  return scaleLayout(state, Math.floor(state.chips / stake));
}

export function stakeOf(state: GameState): number {
  return totalStake(state.layout);
}

/** True when the layout is affordable and there is something on the table. */
export function canSpin(state: GameState): boolean {
  const stake = stakeOf(state);
  return stake > 0 && stake <= state.chips;
}

/**
 * Roll a spin without committing it. Pure — the caller holds the result while
 * the wheel animates and commits it with `applyResult` when the ball lands, so
 * buying an upgrade mid-animation cannot be clobbered by a stale snapshot.
 */
export function rollSpin(state: GameState, rng: () => number): SpinResult | null {
  if (!canSpin(state)) return null;
  return resolveSpin({
    layout: state.layout,
    edge: edgeOf(state),
    bankroll: state.chips,
    streak: state.streak,
    rng,
  });
}

/**
 * Chips leave the table the moment the ball is launched, exactly as they would
 * when you push them across the felt. Deliberately does NOT refit: a bankroll
 * momentarily at zero mid-flight is not a broke player, and re-staking them
 * before the payout arrives would hand out free chips on every all-in spin.
 */
export function commitStake(state: GameState, result: SpinResult): GameState {
  return {
    ...state,
    chips: state.chips - result.stake,
    // Counted here rather than on landing, because this is where the money
    // actually leaves: a spin abandoned mid-flight still cost you the stake.
    wagered: (state.wagered ?? 0) + result.stake,
  };
}

/**
 * Winnings arrive when the ball does. Applied functionally against the latest
 * state, so an upgrade bought mid-flight is never clobbered.
 */
export function applyReturn(state: GameState, result: SpinResult): GameState {
  const chips = state.chips + result.returned;
  const streak = result.won ? state.streak + 1 : 0;
  return refit({
    ...state,
    chips,
    peak: Math.max(state.peak, chips),
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    spins: state.spins + 1,
    history: [result.pocket, ...state.history].slice(0, HISTORY_LEN),
    pocketCounts: tallied(state.pocketCounts, result.balls),
    returned: (state.returned ?? 0) + result.returned,
    bestWin: Math.max(state.bestWin ?? 0, result.net),
    worstLoss: Math.min(state.worstLoss ?? 0, result.net),
  });
}

/** Both halves at once — for headless sims, where there is no flight time. */
export function applyResult(state: GameState, result: SpinResult): GameState {
  return applyReturn(commitStake(state, result), result);
}

/** Roll and commit in one step — used by auto-spin catch-up and headless sims. */
export function spin(
  state: GameState,
  rng: () => number,
): { state: GameState; result: SpinResult } | null {
  const result = rollSpin(state, rng);
  if (!result) return null;
  return { result, state: applyResult(state, result) };
}

export function upgradeCost(state: GameState, id: string): number | null {
  const upgrade = UPGRADE_BY_ID.get(id);
  if (!upgrade) return null;
  // `requires` is a real gate, not just a UI filter, so an upgrade listed as
  // locked cannot be bought by any path.
  if (upgrade.requires && levelOf(state.upgrades, upgrade.requires) === 0) return null;
  const level = levelOf(state.upgrades, id);
  if (level >= upgrade.maxLevel) return null;
  return costOf(upgrade, level);
}

export function buyUpgrade(state: GameState, id: string): GameState {
  const cost = upgradeCost(state, id);
  if (cost === null || cost > state.chips) return state;
  // Refit: spending can leave the bankroll below the layout's own stake, which
  // makes `canSpin` false and stalls auto-spin with no visible cause.
  return refit({
    ...state,
    chips: state.chips - cost,
    upgrades: { ...state.upgrades, [id]: levelOf(state.upgrades, id) + 1 },
  });
}

export function ivoryFor(peak: number): number {
  return Math.floor(Math.sqrt(Math.max(0, peak) / IVORY_SCALE));
}

/** Ivory a cash-out would pay right now, over and above what you already hold. */
export function pendingIvory(state: GameState): number {
  return ivoryFor(state.peak);
}

export function canCashOut(state: GameState): boolean {
  return pendingIvory(state) > 0 && state.offer === null;
}

/**
 * Cash out: bank the Ivory, wipe the cycle (chips, upgrades, layout) and draft
 * three relics to choose from. Ivory, relics and lifetime counters survive.
 */
export function cashOut(state: GameState, rng: () => number): GameState {
  if (!canCashOut(state)) return state;
  const ivory = state.ivory + pendingIvory(state);
  const seed = startingChips(uniqueRelicsOf(state.activeRelics));
  // An exhausted relic pool drafts nothing. Storing the empty array would be
  // truthy — an un-dismissable offer overlay, and cash-outs blocked forever.
  const offer = offerRelics(state.relics, rng);
  return {
    ...state,
    chips: seed,
    peak: seed,
    ivory,
    upgrades: {},
    layout: {},
    chipIndex: 0,
    // Statistics follow the bankroll: a cash-out is a fresh cycle, and a wheel
    // history carried across it would describe a table you no longer play.
    pocketCounts: emptyCounts(),
    wagered: 0,
    returned: 0,
    bestWin: 0,
    worstLoss: 0,
    streak: 0,
    spins: 0,
    cashOuts: state.cashOuts + 1,
    history: [],
    autoOn: false,
    offer: offer.length > 0 ? offer : null,
  };
}

export function takeRelic(state: GameState, id: string): GameState {
  if (!state.offer?.includes(id)) return state;
  const taken = { ...state, relics: [...state.relics, id], offer: null };
  // Auto-equip while there is room, so slots only demand attention once they
  // actually bind.
  return taken.activeRelics.length < relicSlots(taken)
    ? { ...taken, activeRelics: [...taken.activeRelics, id] }
    : taken;
}

export interface CatchUpReport {
  awayMs: number;
  spins: number;
  net: number;
  /** True when the table stopped early because it could not cover the stake. */
  brokeEarly: boolean;
}

/**
 * Simulate auto-spin for time spent away. Runs the real resolver rather than
 * an analytic EV so every relic and upgrade is honoured; past OFFLINE_SIM_CAP
 * spins the sampled average is extrapolated instead.
 */
export function catchUp(
  state: GameState,
  now: number,
  rng: () => number,
): { state: GameState; report: CatchUpReport | null } {
  const awayMs = Math.min(Math.max(0, now - state.lastSeen), OFFLINE_CAP_MS);
  const idle = refit({ ...state, lastSeen: now });
  if (!state.autoOn || !autoUnlocked(state) || !canSpin(state)) {
    return { state: idle, report: null };
  }

  const interval = intervalOf(state);
  const wanted = Math.floor(awayMs / interval);
  if (wanted <= 0) return { state: idle, report: null };

  const rate = offlineRate(uniqueRelicsOf(state.activeRelics));
  const simulated = Math.min(wanted, OFFLINE_SIM_CAP);
  let cursor = idle;
  let done = 0;
  let brokeEarly = false;

  for (; done < simulated; done++) {
    const step = spin(cursor, rng);
    if (!step) {
      brokeEarly = true;
      break;
    }
    cursor = step.state;
  }

  let net = (cursor.chips - state.chips) * rate;
  let spins = done;
  if (!brokeEarly && wanted > simulated && done > 0) {
    // Extrapolate the sampled average across the remaining spins.
    net = (net / done) * wanted;
    spins = wanted;
  }

  const chips = Math.max(0, state.chips + net);
  return {
    state: {
      ...idle,
      chips,
      peak: Math.max(state.peak, chips),
      spins: state.spins + spins,
      streak: cursor.streak,
      bestStreak: cursor.bestStreak,
      history: cursor.history,
    },
    report: { awayMs, spins, net, brokeEarly },
  };
}

/**
 * Persist as-is. `lastSeen` is deliberately NOT stamped here: it marks when the
 * player last had the game in front of them, and the caller owns that. Stamping
 * it on every autosave would erase every backgrounded stretch, so offline
 * earnings would only ever accrue while the tab was fully closed.
 */
export function save(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota — the game is still playable, just not persistent.
  }
}

/**
 * Upgrades withdrawn from the shop; levels on old saves are refunded.
 *
 * Comp Points is **not** on this list any more. It was withdrawn because a
 * rebate made the red/black hedge profitable, and net settlement has since
 * closed that structurally — a rebate now comes off a net loss and cannot carry
 * a spin above zero. Gilded Payouts stays retired: a flat multiplier on every
 * win is a different thing from softening a loss, and Ivory fills that role.
 */
const RETIRED_UPGRADES = ["payout"] as const;
/** The original curves, kept only to price the refund. */
const RETIRED_REFUND: Record<string, (level: number) => number> = {
  payout: (l) => sumGeometric(150, 1.16, l),
};
function sumGeometric(base: number, growth: number, levels: number): number {
  let total = 0;
  for (let i = 0; i < levels; i++) total += Math.ceil(base * Math.pow(growth, i));
  return total;
}

export function load(): GameState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as Partial<GameState>;
    const state = { ...initialState(), ...parsed };
    // Saves predating relic slots have no loadout; equip what fits rather than
    // silently switching every relic they own off.
    if (!parsed.activeRelics && state.relics.length > 0) {
      state.activeRelics = state.relics.slice(0, relicSlots(state));
    }
    // Gilded Payouts is gone. Its levels are inert once buildEdge stops reading
    // them, so refund the spend rather than pocketing it — a save made before
    // the change paid real money for it. Saves that still carry a Comp Points
    // level keep it: that upgrade works again, so deleting it now would take
    // away something the player can currently buy.
    for (const id of RETIRED_UPGRADES) {
      const level = state.upgrades[id];
      if (!level) continue;
      state.chips += RETIRED_REFUND[id](level);
      delete state.upgrades[id];
    }
    return state;
  } catch {
    return initialState();
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

export type { Layout };
