/**
 * NULLSCAPE — Preferências persistentes.
 * Tudo local (localStorage), nada enviado ao servidor.
 */

const KEY = 'nullscape:settings:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  grain: 35,
  darkness: 62,
  fog: 40,
  reduced: false,
  shake: true,
  volume: 70,
  ambience: 55,
  mute: false,
  name: '',
});

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* modo privado */
  }
}

export function loadCodex() {
  try {
    const raw = localStorage.getItem('nullscape:codex:v1');
    return raw ? JSON.parse(raw) : { creatures: [], anomalies: [], notes: [], puzzles: [], runs: 0, best: null };
  } catch {
    return { creatures: [], anomalies: [], notes: [], puzzles: [], runs: 0, best: null };
  }
}

export function saveCodex(codex) {
  try {
    localStorage.setItem('nullscape:codex:v1', JSON.stringify(codex));
  } catch {
    /* ignorar */
  }
}

export function recordDiscovery(kind, id, meta = {}) {
  const codex = loadCodex();
  const list = codex[kind] || (codex[kind] = []);
  if (list.some((e) => e.id === id)) return false;
  list.push({ id, at: Date.now(), ...meta });
  saveCodex(codex);
  return true;
}

export function applySettingsToDom(settings) {
  const root = document.documentElement;
  root.style.setProperty('--grain', String(settings.grain / 100));
  root.style.setProperty('--shade', String(settings.darkness / 100));
  document.body.classList.toggle('reduce-fx', !!settings.reduced);
}
