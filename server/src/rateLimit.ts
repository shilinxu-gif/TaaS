type BucketState = {
  windowStartMs: number;
  count: number;
};

const secondBuckets = new Map<string, BucketState>();

export function checkRateLimit(
  key: string,
  limitPerSecond: number | null | undefined
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (!limitPerSecond || limitPerSecond <= 0) {
    return { ok: true };
  }
  const now = Date.now();
  const bucket = secondBuckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= 1000) {
    secondBuckets.set(key, { windowStartMs: now, count: 1 });
    return { ok: true };
  }
  if (bucket.count >= limitPerSecond) {
    return { ok: false, retryAfterSeconds: 1 };
  }
  bucket.count += 1;
  secondBuckets.set(key, bucket);
  return { ok: true };
}
