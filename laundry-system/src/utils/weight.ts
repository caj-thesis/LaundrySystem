export function normalizeWeight(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;

  return parsed;
}

export function getChargeableWeight(value: unknown): number {
  return Math.max(0, normalizeWeight(value));
}

export function formatWeight(value: unknown): string {
  return `${normalizeWeight(value).toFixed(2)} kg`;
}
