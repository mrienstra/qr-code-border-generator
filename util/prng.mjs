// Mulberry32 PRNG — returns a function that generates sequential floats in [0, 1).
// For one-shot hashing, call immediately: mulberry32(seed)()
export function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
