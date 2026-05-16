// Port of crimson/ui/formatting.py

export function formatOrdinal(value1Based: number): string {
  const value = int(value1Based);
  let suffix: string;
  if (value % 100 === 11 || value % 100 === 12 || value % 100 === 13) {
    suffix = 'th';
  } else if (value % 10 === 1) {
    suffix = 'st';
  } else if (value % 10 === 2) {
    suffix = 'nd';
  } else if (value % 10 === 3) {
    suffix = 'rd';
  } else {
    suffix = 'th';
  }
  return `${value}${suffix}`;
}

export function formatTimeMmSs(ms: number): string {
  const totalS = Math.floor(Math.max(0, int(ms)) / 1000);
  const minutes = Math.floor(totalS / 60);
  const seconds = totalS % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
