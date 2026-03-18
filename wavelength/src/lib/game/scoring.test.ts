import { describe, expect, it } from "vitest";
import { shuffle, wavelengthScore } from "./scoring";

describe("wavelengthScore", () => {
  it("gives 4 points in the center band", () => {
    expect(wavelengthScore(0.5, 0.5)).toBe(4);
    expect(wavelengthScore(0.5, 0.52)).toBe(4);
  });
  it("gives 3 points in the middle band", () => {
    expect(wavelengthScore(0.5, 0.56)).toBe(3);
  });
  it("gives 2 points in the outer band", () => {
    expect(wavelengthScore(0.5, 0.62)).toBe(2);
  });
  it("gives 0 when outside all bands", () => {
    expect(wavelengthScore(0.5, 0.8)).toBe(0);
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
