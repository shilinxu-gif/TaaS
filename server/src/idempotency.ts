type CachedPayload = { response: unknown; tokens: number };

const store = new Map<string, CachedPayload>();

export function getIdempotency(key: string): CachedPayload | undefined {
  return store.get(key);
}

export function setIdempotency(key: string, payload: CachedPayload): void {
  store.set(key, payload);
  if (store.size > 500) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
}
