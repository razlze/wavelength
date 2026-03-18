/** Target and guess in [0, 1]. Returns 0–10 style score (closer = higher). */
export function wavelengthScore(target: number, guess: number): number {
  const d = Math.abs(target - guess);
  if (d <= 0.02) return 10;
  if (d <= 0.05) return 9;
  if (d <= 0.08) return 8;
  if (d <= 0.11) return 7;
  if (d <= 0.14) return 6;
  if (d <= 0.17) return 5;
  if (d <= 0.21) return 4;
  if (d <= 0.26) return 3;
  if (d <= 0.32) return 2;
  if (d <= 0.4) return 1;
  return 0;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
