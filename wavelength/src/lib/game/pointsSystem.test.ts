import { describe, expect, it } from "vitest";
import { calculateRoundAwards } from "./pointsSystem";

describe("calculateRoundAwards", () => {
  const guesserIds = ["g1", "g2"];
  const psychicId = "p1";

  it("awards only psychic points in psychic dominant mode", () => {
    const awards = calculateRoundAwards({
      pointsSystem: "PSYCHIC_DOMINANT",
      baseScore: 3,
      guesserIds,
      psychicId,
    });
    expect(awards.get(psychicId)).toBe(3);
    expect(awards.get("g1")).toBeUndefined();
    expect(awards.get("g2")).toBeUndefined();
  });

  it("adds guesser bonus in psychic biased mode for scoring zones", () => {
    const awards = calculateRoundAwards({
      pointsSystem: "PSYCHIC_BIASED",
      baseScore: 2,
      guesserIds,
      psychicId,
    });
    expect(awards.get(psychicId)).toBe(2);
    expect(awards.get("g1")).toBe(1);
    expect(awards.get("g2")).toBe(1);
  });

  it("awards guessers dial score and psychic bonus in guesser biased mode", () => {
    const awards = calculateRoundAwards({
      pointsSystem: "GUESSER_BIASED",
      baseScore: 4,
      guesserIds,
      psychicId,
    });
    expect(awards.get("g1")).toBe(4);
    expect(awards.get("g2")).toBe(4);
    expect(awards.get(psychicId)).toBe(1);
  });

  it("awards only guessers in guesser dominant mode", () => {
    const awards = calculateRoundAwards({
      pointsSystem: "GUESSER_DOMINANT",
      baseScore: 3,
      guesserIds,
      psychicId,
    });
    expect(awards.get("g1")).toBe(3);
    expect(awards.get("g2")).toBe(3);
    expect(awards.get(psychicId)).toBeUndefined();
  });

  it("does not give bonus points when base score is zero", () => {
    const awards = calculateRoundAwards({
      pointsSystem: "GUESSER_BIASED",
      baseScore: 0,
      guesserIds,
      psychicId,
    });
    expect(awards.size).toBe(0);
  });
});
