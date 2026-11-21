/**
 * NULLSCAPE — HUD.
 * Discreto por princípio: nada de barras chamativas. A informação aparece
 * quando é necessária e desaparece quando não é.
 */

import { THEMES } from '../../../shared/world/themes.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.regionName = document.getElementById('hud-region-name');
    this.objective = document.getElementById('hud-objective');
    this.team = document.getElementById('hud-team');
    this.conn = document.getElementById('hud-conn');
    this.connLabel = document.getElementById('conn-label');
    this.prompt = document.getElementById('hud-prompt');
    this.promptText = document.getElementById('hud-prompt-text');
    this.message = document.getElementById('hud-message');
    this.toastEl = document.getElementById('hud-toast');
    this.whisperEl = document.getElementById('hud-whisper');
    this.flickerEl = document.getElementById('hud-flicker');
    this.vitalBar = document.getElementById('vital-hp');
    this.vitalLabel = document.getElementById('vital-label');
    this.itemsEl = document.getElementById('hud-items');
    this.sigilsEl = document.getElementById('hud-sigils');
    this.deathOverlay = document.getElementById('death-overlay');
    this.pauseOverlay = document.getElementById('pause-overlay');
    this.noteOverlay = document.getElementById('note-overlay');
    this.endingOverlay = document.getElementById('ending-overlay');
    this.timers = {};
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
    this.deathOverlay.hidden = true;
    this.pauseOverlay.hidden = true;
    this.noteOverlay.hidden = true;
    this.endingOverlay.hidden = true;
  }

  setRegion(themeId) {
    const theme = THEMES[themeId] || THEMES.threshold;
    this.regionName.textContent = theme.label;
    this.regionName.style.opacity = '1';
    clearTimeout(this.timers.region);
    this.timers.region = setTimeout(() => {
      this.regionName.style.opacity = '0.45';
    }, 4200);
  }

  setObjective(text) {
    this.objective.textContent = text;
  }

  setTeam(players, myId, remotePositions = []) {
    this.team.innerHTML = '';
    for (const p of players) {
      const line = document.createElement('div');
      line.className = `team-line${p.id === myId ? ' me' : ''}${p.dead ? ' dead' : ''}`;
      const dot = document.createElement('span');
      dot.className = 'dot-mini';
      dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      dot.style.color = `#${p.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('span');
      name.textContent = p.id === myId ? `${p.name} (você)` : p.name;
      const hp = document.createElement('span');
      hp.className = 'hp-mini';
      const hpFill = document.createElement('span');
      hpFill.style.width = `${Math.max(0, p.hp)}%`;
      hp.appendChild(hpFill);
      line.append(dot, name, hp);
      if (p.disconnected) {
        const tag = document.createElement('span');
        tag.className = 'tag-away';
        tag.textContent = 'fora';
        line.appendChild(tag);
      } else {
        const remote = remotePositions.find((r) => r.id === p.id);
        if (remote && p.id !== myId) {
          const self = remotePositions.find((r) => r.id === myId);
          if (self) {
            const distTiles = Math.hypot(remote.x - self.x, remote.y - self.y) / 32;
            if (distTiles > 20) {
              const tag = document.createElement('span');
              tag.className = 'tag-away';
              tag.textContent = 'longe';
              line.appendChild(tag);
            }
          }
        }
      }
      this.team.appendChild(line);
    }
  }

  setConnection({ latency, connected }) {
    if (latency === undefined && connected === undefined) return;
    const classes = ['hud-conn'];
    let label = '—';
    if (connected === false) {
      classes.push('bad');
      label = 'sem sinal';
    } else if (latency < 90) {
      classes.push('good');
      label = `${latency}ms`;
    } else if (latency < 190) {
      classes.push('ok');
      label = `${latency}ms`;
    } else {
      classes.push('bad');
      label = `${latency}ms`;
    }
    this.conn.className = classes.join(' ');
    this.connLabel.textContent = label;
  }

  setPrompt(prompt) {
    if (!prompt) {
      this.prompt.hidden = true;
      return;
    }
    this.prompt.hidden = false;
    this.promptText.textContent = prompt.label;
  }

  showMessage(text, duration = 5200) {
    if (!text) return;
    this.message.textContent = text;
    this.message.hidden = false;
    this.message.classList.add('show');
    clearTimeout(this.timers.message);
    this.timers.message = setTimeout(() => {
      this.message.classList.remove('show');
      this.timers.messageHide = setTimeout(() => (this.message.hidden = true), 700);
    }, duration);
  }

  toast(text, duration = 2600) {
    if (!text) return;
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.classList.add('show');
    clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.timers.toastHide = setTimeout(() => (this.toastEl.hidden = true), 300);
    }, duration);
  }

  whisper(text, duration = 6500) {
    if (!text) return;
    this.whisperEl.textContent = text;
    this.whisperEl.hidden = false;
    this.whisperEl.classList.add('show');
    clearTimeout(this.timers.whisper);
    this.timers.whisper = setTimeout(() => {
      this.whisperEl.classList.remove('show');
      this.timers.whisperHide = setTimeout(() => (this.whisperEl.hidden = true), 900);
    }, duration);
  }

  flicker(strength = 1) {
    this.flickerEl.classList.remove('flicker-a');
    void this.flickerEl.offsetWidth;
    this.flickerEl.style.opacity = String(Math.min(0.8, strength * 0.4));
    this.flickerEl.classList.add('flicker-a');
    setTimeout(() => {
      this.flickerEl.style.opacity = '0';
    }, 900);
  }

  setVitals(hp, dead) {
    const pct = Math.max(0, Math.min(100, hp));
    this.vitalBar.style.width = `${pct}%`;
    this.vitalBar.parentElement.classList.toggle('low', pct < 40);
    this.vitalLabel.textContent = dead ? 'perdido' : pct > 80 ? 'íntegro' : pct > 45 ? 'abalado' : 'quase';
  }

  setInventory(items) {
    this.itemsEl.innerHTML = '';
    for (const item of items) {
      const chip = document.createElement('div');
      chip.className = 'item-chip';
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = item.glyph || '◈';
      const label = document.createElement('span');
      label.textContent = item.label;
      chip.append(glyph, label);
      this.itemsEl.appendChild(chip);
    }
  }

  setSigils({ delivered = 0, total = 4, revealed = [], taken = [], mine = [] } = {}) {
    this.sigilsEl.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `${delivered}/${total}`;
    this.sigilsEl.appendChild(label);
    for (let i = 0; i < total; i++) {
      const pip = document.createElement('span');
      const id = `sigil-${i}`;
      pip.className = 'sigil-pip';
      if (delivered > i) pip.classList.add('filled');
      else if (revealed.includes(id) || taken.includes(id) || mine.includes(id)) pip.classList.add('revealed');
      pip.title = delivered > i ? 'entregue' : taken.includes(id) || mine.includes(id) ? 'em posse da equipe' : revealed.includes(id) ? 'revelado' : 'oculto';
      this.sigilsEl.appendChild(pip);
    }
  }

  showDeath(seconds = 9) {
    this.deathOverlay.hidden = false;
    const sub = document.getElementById('death-sub');
    let left = seconds;
    clearInterval(this.timers.death);
    sub.textContent = `O mundo te devolve em ${left}s.`;
    this.timers.death = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(this.timers.death);
        sub.textContent = 'Voltando…';
      } else {
        sub.textContent = `O mundo te devolve em ${left}s.`;
      }
    }, 1000);
  }

  hideDeath() {
    this.deathOverlay.hidden = true;
    clearInterval(this.timers.death);
  }

  showPause(info = {}) {
    this.pauseOverlay.hidden = false;
    const box = document.getElementById('pause-info');
    box.innerHTML = '';
    const rows = [
      ['Sala', info.roomCode || '—'],
      ['Semente', info.seed || '—'],
      ['Região', info.region || '—'],
      ['Jogadores', `${info.players ?? 0} / 6`],
      ['Latência', info.latency != null ? `${info.latency}ms` : '—'],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('span');
      dt.textContent = k;
      const dd = document.createElement('span');
      dd.textContent = v;
      box.append(dt, dd);
    }
  }

  hidePause() {
    this.pauseOverlay.hidden = true;
  }

  showNote(note) {
    if (!note) return;
    document.getElementById('note-title').textContent = note.title || 'Anotação';
    document.getElementById('note-text').textContent = note.text || '';
    this.noteOverlay.hidden = false;
  }

  hideNote() {
    this.noteOverlay.hidden = true;
  }

  showEnding(ev, durationMs) {
    this.endingOverlay.hidden = false;
    const stats = ev.stats || {};
    const list = document.getElementById('ending-stats');
    list.innerHTML = '';
    const rows = [
      ['Encerrado por', ev.byName || 'alguém'],
      ['Sigilos', '4 / 4'],
      ['Distância', `${stats.distanceTiles ?? 0} tiles`],
      ['Anotacões', String(stats.notes ?? 0)],
      ['Anomalias', String(stats.anomalies ?? 0)],
      ['Perdas', String(stats.deaths ?? 0)],
      ['Duração', formatDuration(stats.durationMs ?? durationMs ?? 0)],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      list.append(dt, dd);
    }
    document.getElementById('ending-text').textContent =
      'Os quatro sigilos repousam no Altar. A porta que não existia agora existe, e ela dá para o mesmo corredor. ' +
      'Vocês podem continuar explorando — o mundo não se importa em ser resolvido.';
  }

  hideEnding() {
    this.endingOverlay.hidden = true;
  }
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
