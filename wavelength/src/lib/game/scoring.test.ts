import { describe, expect, it } from "vitest";
import { shuffle, wavelengthScore } from "./scoring";

describe("wavelengthScore", () => {
  it("gives high score when very close", () => {
    expect(wavelengthScore(0.5, 0.51)).toBeGreaterThanOrEqual(8);
  });
  it("gives low score when far", () => {
    expect(wavelengthScore(0.1, 0.9)).toBe(0);
  });
});

describe("shuffle", () => {
  it("permutes array", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = shuffle(a);
    expect(s).toHaveLength(a.length);
    expect(new Set(s)).toEqual(new Set(a));
  });
});
