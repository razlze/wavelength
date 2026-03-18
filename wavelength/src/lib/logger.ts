export function log(
  level: "info" | "warn" | "error",
  msg: string,
  meta?: Record<string, unknown>
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
