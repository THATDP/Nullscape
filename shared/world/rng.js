/**
 * NULLSCAPE — RNG determinístico.
 *
 * Tudo no mundo nasce de uma semente (seed). O mesmo seed produz exatamente o
 * mesmo layout, garantindo reprodutibilidade para testes e para partidas.
 *
 * Este arquivo é compartilhado com o cliente (ver scripts/sync-shared.mjs).
 */

/** Hash de string -> função geradora de seeds (xmur3). */
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function nextHash() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** PRNG mulberry32 de 32 bits. */
export function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normaliza qualquer entrada em uma seed textual estável. */
export function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') {
    // Semente baseada em entropia (somente usada para criar salas novas).
    const entropy = `${Date.now()}-${Math.random()}`;
    return hashString(entropy)().toString(36).toUpperCase().slice(0, 8);
  }
  const s = String(seed).trim().toUpperCase();
  return s.length > 32 ? s.slice(0, 32) : s;
}

export class Rng {
  constructor(seed) {
    this.seed = normalizeSeed(seed);
    const h = hashString(this.seed);
    this._next = mulberry32(h());
    this._calls = 0;
  }

  /** Float em [0, 1). */
  next() {
    this._calls++;
    return this._next();
  }

  /** Inteiro em [min, max] (inclusivo). */
  int(min, max) {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float em [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Escolhe { item, weight } de forma ponderada. */
  weighted(pairs) {
    const total = pairs.reduce((acc, p) => acc + p.weight, 0);
    let roll = this.next() * total;
    for (const p of pairs) {
      roll -= p.weight;
      if (roll <= 0) return p.item;
    }
    return pairs[pairs.length - 1]?.item;
  }

  /** Fisher-Yates (cópia — não muta a entrada). */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Quantidade de itens distintos. */
  sample(arr, n) {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)));
  }

  /** Deriva um sub-gerador determinístico (para fases independentes). */
  fork(label) {
    const h = hashString(`${this.seed}::${label}`);
    return new Rng(`${this.seed}-${h().toString(36)}`);
  }
}

/** Hash determinístico de uma estrutura de dados (usado nos testes). */
export function stableHash(value) {
  const json = JSON.stringify(value, (key, val) => {
    if (val instanceof Uint8Array) return Array.from(val);
    if (val instanceof Set) return Array.from(val).sort();
    if (val instanceof Map) return Array.from(val.entries()).sort();
    if (typeof val === 'number' && !Number.isFinite(val)) return String(val);
    return val;
  });
  // FNV-1a 32 bits
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
