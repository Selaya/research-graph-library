// Minimal event emitter (vis-data style verbs live on the store; this is just pub/sub).
export function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    off(type, fn) { map.get(type)?.delete(fn); },
    emit(type, payload) {
      const set = map.get(type);
      if (set) for (const fn of [...set]) fn(payload);
      const any = map.get("*");
      if (any) for (const fn of [...any]) fn(type, payload);
    },
  };
}
