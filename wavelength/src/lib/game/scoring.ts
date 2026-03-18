/** Target and guess in [0, 1]. Returns discrete 4/3/2/0 score like the board. */
export function wavelengthScore(target: number, guess: number): number {
  const d = Math.abs(target - guess);
  if (d <= 0.025) return 4;
  if (d <= 0.07) return 3;
  if (d <= 0.125) return 2;
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
