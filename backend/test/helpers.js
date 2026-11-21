/** Utilidades compartilhadas dos testes. */

/** Garante que um payload é JSON puro (round-trip estável). */
export function sanitizePayload(value) {
  return JSON.parse(JSON.stringify(value));
}
