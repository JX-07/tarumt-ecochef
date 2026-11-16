export function timePosition(capturedAt: string, windowStart: number, windowEnd: number) {
  const share = (Date.parse(capturedAt) - windowStart) / Math.max(windowEnd - windowStart, 1);
  return Math.max(0, Math.min(1, share));
}
