/**
 * Minimal structured logger. Writes one JSON object per line to stderr, so it
 * never corrupts the stdio transport (which owns stdout).
 */
export type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[raw] ?? ORDER.info;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  process.stderr.write(
    JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }) + "\n",
  );
}
