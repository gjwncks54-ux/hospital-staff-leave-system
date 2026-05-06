import { describe, expect, it } from "vitest";
import { buildDiceStatus, getDiceActiveCutoffDate, getNextDiceRollKind } from "../../functions/lib/dice";

describe("dice game status", () => {
  it("allows one regular roll when no bonus exists", () => {
    const status = buildDiceStatus({
      regularRolledToday: 0,
      rolledToday: 0,
      unusedBonusCount: 0,
    });

    expect(status.canRoll).toBe(true);
    expect(status.regularAvailable).toBe(true);
    expect(status.bonusAvailable).toBe(0);
    expect(status.rollsRemaining).toBe(1);
    expect(getNextDiceRollKind(status)).toBe("REGULAR");
  });

  it("uses the regular daily chance before any bonus reroll", () => {
    const status = buildDiceStatus({
      regularRolledToday: 0,
      rolledToday: 0,
      unusedBonusCount: 1,
    });

    expect(status.canRoll).toBe(true);
    expect(status.regularAvailable).toBe(true);
    expect(status.bonusAvailable).toBe(1);
    expect(status.rollsRemaining).toBe(1);
    expect(getNextDiceRollKind(status)).toBe("REGULAR");
  });

  it("uses bonus as a reroll only after the daily regular roll", () => {
    const status = buildDiceStatus({
      regularRolledToday: 1,
      rolledToday: 1,
      unusedBonusCount: 1,
      lastRollValue: 4,
      lastRollKind: "REGULAR",
    });

    expect(status.canRoll).toBe(true);
    expect(status.regularAvailable).toBe(false);
    expect(status.bonusAvailable).toBe(1);
    expect(status.rollsRemaining).toBe(1);
    expect(getNextDiceRollKind(status)).toBe("BONUS");
  });

  it("stops when regular is used and no bonus remains", () => {
    const status = buildDiceStatus({
      regularRolledToday: 1,
      rolledToday: 1,
      unusedBonusCount: 0,
    });

    expect(status.canRoll).toBe(false);
    expect(status.rollsRemaining).toBe(0);
    expect(getNextDiceRollKind(status)).toBeNull();
  });

  it("uses a one-year active query window", () => {
    expect(getDiceActiveCutoffDate("2026-05-06")).toBe("2025-05-06");
  });
});
