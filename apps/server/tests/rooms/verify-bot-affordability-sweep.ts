/**
 * **A wider run of the bot-affordability property than the suite can afford.**
 *
 * `bot-affordability.test.ts` ships four seeds per preset, because sixteen
 * matches is about the most a unit suite should spend. That is enough to *hold*
 * the invariant once it is true and nowhere near enough to *establish* it: the
 * reported stall needed a particular board position, a particular balance and a
 * particular rival standing before the policy would even pick the branch, and
 * the whole reason the bug shipped is that the one match the old tests played
 * never reached it.
 *
 * So this is the same harness — the same {@link playBotOnlyMatch}, the same
 * {@link overdrafts} oracle, not a second copy of either — driven over many more
 * seeds, reporting counts rather than asserting a single array. Run it by hand
 * when the policy changes:
 *
 * ```sh
 * bun run --cwd apps/server tests/rooms/verify-bot-affordability-sweep.ts
 * bun run --cwd apps/server tests/rooms/verify-bot-affordability-sweep.ts --seeds 24
 * ```
 *
 * Two things it reports that the shipped test deliberately does not.
 *
 * 1. **Rejections grouped by code.** "Unexpected rejection" is one assertion in
 *    the suite; here the code is broken out, because the code is what says whose
 *    bug it is. `INSUFFICIENT_RESOURCE`/`ILLEGAL_ACTION` on a bot's own decision
 *    is the policy's. `SERIALIZATION_FAILED` is the write side refusing a command
 *    the engine *accepted* — a real stall, and not the policy's at all. Reporting
 *    one number for both is how a green-looking run hides the interesting half.
 * 2. **Whether a preset can terminate.** The suite asserts the affordable half of
 *    termination (no match ever *freezes*). This script's second phase spends a
 *    much larger drive budget on a couple of seeds per preset and reports the
 *    actual `MatchEndReason`, so "does a bot-only match end, or does it burn the
 *    budget" is answered from evidence instead of assumed.
 */
import { ROOM_MODES } from "@office-ladder/contracts";
import {
  isBotDrainDefect,
  type BotDrainStop,
} from "../../src/rooms/bots/bot-driver";
import {
  describeRejection,
  describeStop,
  playBotOnlyMatch,
  type MatchOutcome,
} from "./bot-affordability-harness";

/**
 * Seeds beyond the four the suite ships, named so a failure replays exactly.
 *
 * Deterministic rather than generated for the reason the test file gives: a
 * property run that invented its own inputs would fail on a different match
 * every time, and "a bot-only match stalled" with no reproduction is not a bug
 * report.
 */
function sweepSeeds(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `sweep-seed-${String(index + 1).padStart(2, "0")}`);
}

/** Drives per match in the termination phase. ~120 commands each. */
const TERMINATION_DRIVES = 400;

/** Seeds per preset in the termination phase — deliberately few; each is long. */
const TERMINATION_SEEDS = 2;

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Rejection stops, with the code kept — the field that assigns the bug. */
function rejections(
  outcome: MatchOutcome,
): readonly { readonly code: string; readonly decision: string; readonly line: string }[] {
  return outcome.stops.flatMap((stop: BotDrainStop) =>
    stop.kind === "command-rejected" && !stop.expected
      ? [{ code: String(stop.code), decision: String(stop.decision), line: describeRejection(outcome, stop) }]
      : [],
  );
}

function tally(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value}×${count}`)
    .join(" ");
}

async function main(): Promise<void> {
  const seedCount = arg("seeds", 12);
  const seeds = sweepSeeds(seedCount);

  console.log(
    `\n=== Phase 1: affordability sweep — ${ROOM_MODES.length} presets × ${seedCount} seeds ` +
      `= ${ROOM_MODES.length * seedCount} bot-only matches ===\n`,
  );

  const matches: MatchOutcome[] = [];
  for (const modeId of ROOM_MODES) {
    for (const seed of seeds) {
      matches.push(await playBotOnlyMatch(modeId, seed));
    }
    const forMode = matches.filter((outcome) => outcome.modeId === modeId);
    const rejected = forMode.flatMap(rejections);
    console.log(
      `${modeId.padEnd(16)} matches=${String(forMode.length).padStart(3)} ` +
        `rounds=${Math.max(...forMode.map((outcome) => outcome.round))} ` +
        `ended=${forMode.filter((outcome) => outcome.ended).length} ` +
        `projects=${forMode[0]?.projectsEnabled === true ? "on" : "off"} ` +
        `rejections=${rejected.length} wedges=${forMode.filter((o) => o.wedge !== null).length} ` +
        `overdrafts=${forMode.flatMap((outcome) => outcome.overdrafts).length}`,
    );
  }

  const allRejections = matches.flatMap(rejections);
  const overdrafts = matches.flatMap((outcome) => outcome.overdrafts);
  const wedges = matches.flatMap((outcome) => (outcome.wedge === null ? [] : [outcome.wedge]));
  const otherDefects = matches.flatMap((outcome) =>
    outcome.stops
      .filter((stop) => isBotDrainDefect(stop) && stop.kind !== "action-cap")
      .map((stop) => describeRejection(outcome, stop)),
  );

  console.log(`\nmatches simulated:      ${matches.length}`);
  console.log(`unexpected rejections:  ${allRejections.length}`);
  console.log(`  by code:              ${tally(allRejections.map((r) => r.code)) || "none"}`);
  console.log(`  by decision:          ${tally(allRejections.map((r) => r.decision)) || "none"}`);
  console.log(`overdrafts (oracle):    ${overdrafts.length}`);
  console.log(`frozen matches:         ${wedges.length}`);
  console.log(`other drain defects:    ${otherDefects.length}`);
  console.log(
    `decision slugs reached: ${[...new Set(matches.flatMap((outcome) => outcome.decisions))]
      .sort()
      .join(" ")}`,
  );

  for (const line of [...allRejections.map((r) => r.line), ...overdrafts, ...wedges, ...otherDefects]) {
    console.log(`  DEFECT ${line}`);
  }

  console.log(
    `\n=== Phase 2: termination — every preset, ${TERMINATION_SEEDS} seeds, ` +
      `up to ${TERMINATION_DRIVES} drives (~${TERMINATION_DRIVES * 120} commands) ===\n`,
  );

  const long: MatchOutcome[] = [];
  for (const modeId of ROOM_MODES) {
    for (const seed of seeds.slice(0, TERMINATION_SEEDS)) {
      const started = Date.now();
      const outcome = await playBotOnlyMatch(modeId, `term-${seed}`, {
        maxDrives: TERMINATION_DRIVES,
      });
      long.push(outcome);
      console.log(
        `${modeId.padEnd(16)} ${seed.padEnd(14)} ended=${String(outcome.ended).padEnd(5)} ` +
          `reason=${(outcome.endReason ?? "—").padEnd(20)} round=${String(outcome.round).padStart(3)} ` +
          `drives=${String(outcome.drives).padStart(4)} wedge=${outcome.wedge === null ? "no" : "YES"} ` +
          `stop=${describeStop(outcome.stops.at(-1))} ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
  }

  const perMode = ROOM_MODES.map((modeId) => ({
    modeId,
    ended: long.filter((outcome) => outcome.modeId === modeId && outcome.ended).length,
    total: long.filter((outcome) => outcome.modeId === modeId).length,
  }));
  console.log("");
  for (const row of perMode) {
    console.log(`${row.modeId.padEnd(16)} terminated ${row.ended}/${row.total}`);
  }

  const failed =
    allRejections.length + overdrafts.length + wedges.length + otherDefects.length +
    long.flatMap((outcome) => rejections(outcome)).length +
    long.filter((outcome) => outcome.wedge !== null).length;
  console.log(`\n${failed === 0 ? "PASS" : `FAIL — ${failed} defects`}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

await main();
