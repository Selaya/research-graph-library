// Keyed diff between two id sets — drives scene.commit()'s enter/update/exit split.

/** diffKeys(oldIterable, newIterable) -> {enter, update, exit} (arrays of keys). */
export function diffKeys(oldIterable, newIterable) {
  const oldSet = new Set(oldIterable);
  const newSet = new Set(newIterable);
  const enter = [], update = [], exit = [];
  for (const k of newSet) (oldSet.has(k) ? update : enter).push(k);
  for (const k of oldSet) if (!newSet.has(k)) exit.push(k);
  return { enter, update, exit };
}
