/**
 * NULLSCAPE — Navegação entre telas.
 * Simples, sem framework: alterna classes e dispara hooks.
 */

const SCREENS = [
  'menu',
  'create',
  'join',
  'lobby',
  'game',
  'settings',
  'codex',
  'help',
  'credits',
];

export class ScreenManager {
  constructor() {
    this.current = 'menu';
    this.stack = [];
    this.listeners = new Map();
    this.elements = new Map();
    for (const name of SCREENS) this.elements.set(name, document.getElementById(`screen-${name}`));
  }

  show(name, { push = true } = {}) {
    if (!this.elements.has(name)) return;
    if (push && this.current !== name) this.stack.push(this.current);
    for (const [key, el] of this.elements) {
      if (!el) continue;
      if (key === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.current = name;
    this.emit('change', name);
  }

  /** Volta para a tela anterior da pilha. */
  back() {
    const prev = this.stack.pop() || 'menu';
    this.show(prev, { push: false });
  }

  clearStack() {
    this.stack = [];
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this.listeners.get(event) || []) fn(data);
  }
}
