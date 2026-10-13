// Integer microcredits keep small charges exact (one unit = 0.00000001 credit).
export const CREDIT_SCALE = 100_000_000n;
export function creditUnits(value: string): bigint {
  if (!/^-?\d+(\.\d{1,8})?$/.test(value)) throw new Error("Invalid credit amount.");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const amount = BigInt(whole) * CREDIT_SCALE + BigInt(fraction.padEnd(8, "0"));
  return value.startsWith("-") ? -amount : amount;
}
export function creditAmount(units: bigint): string {
  const negative = units < 0n;
  const value = negative ? -units : units;
  return `${negative ? "-" : ""}${value / CREDIT_SCALE}.${String(value % CREDIT_SCALE).padStart(8, "0")}`;
}
export function sumCredits(values: (string | undefined)[]): string {
  return creditAmount(values.reduce<bigint>((sum, value) => sum + creditUnits(value ?? "0"), 0n));
}
export function formatCredits(value: string): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(Number(value));
}
