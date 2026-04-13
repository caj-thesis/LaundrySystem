export function normalizeWeight(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;

  const safeValue = Math.max(0, parsed);
  return Math.round((safeValue + Number.EPSILON) * 100) / 100;
}

export function formatWeight(value: unknown): string {
  return `${normalizeWeight(value).toFixed(2)} kg`;
}
