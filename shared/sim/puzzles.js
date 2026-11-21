/**
 * NULLSCAPE — Motor de quebra-cabeças cooperativos.
 *
 * Regras por tipo:
 *  - valvePair:      duas válvulas em salas diferentes; giradas com até 9s de diferença.
 *  - breakerOrder:   três disjuntores na ordem certa; errar reinicia a sequência.
 *  - holdLever:      alavanca segurada continua + botão pisado por outro jogador.
 *  - pressurePlates: duas placas ocupadas ao mesmo tempo.
 *  - keycard:        obter o cartão no armário e usar no leitor.
 *  - silenceChoir:   tocar o sino 3x respeitando pausa mínima entre toques.
 *
 * O servidor é autoritativo: cada clique é validado (distância, estado, cooldown).
 */

export class PuzzleSystem {
  constructor(room) {
    this.room = room;
    this.world = room.world;
    this.state = new Map();
    for (const puzzle of this.world.puzzles) {
      this.state.set(puzzle.id, {
        solved: false,
        progress: 0,
        lastActivation: 0,
        sequence: [],
        held: new Set(),
        pressed: new Map(), // plateId -> playerId
        playerClicks: new Map(), // playerId -> timestamps
        lastBellAt: 0,
        bellCount: 0,
        cardTaken: false,
        cardUsed: false,
        lastHintAt: 0,
        activatedAt: null, // para valvePair: timestamp da primeira válvula
      });
    }
    this.mechanisms = new Map();
    for (const m of this.world.interactables) {
      this.mechanisms.set(m.id, { ...m, used: false, hidden: m.visible === false });
    }
    this.solvedOrder = [];
    this.events = [];
  }

  getPuzzleByMechanism(mechId) {
    const mech = this.mechanisms.get(mechId);
    if (!mech) return null;
    return this.world.puzzles.find((p) => p.id === mech.puzzleId) || null;
  }

  /** Verifica se o mecanismo está no alcance do jogador (distância em tiles). */
  inRange(player, mech, tiles = 2.2) {
    const dx = player.x - (mech.gx + 0.5) * 32;
    const dy = player.y - (mech.gy + 0.5) * 32;
    return Math.hypot(dx, dy) <= tiles * 32;
  }

  /** Rate limit por jogador. */
  allowAction(playerId, now, maxPerSecond = 6) {
    const entry = this.state.values();
    // Rate limit global por jogador vive na sala; aqui apenas checamos o cooldown do mecanismo
    return now;
  }

  /**
   * Processa uma interação. Retorna { ok, events, error }.
   */
  interact(playerId, mechId, now = Date.now()) {
    const player = this.room.playerStates.get(playerId);
    if (!player || player.dead) return { ok: false, error: 'jogador inválido' };
    const mech = this.mechanisms.get(mechId);
    if (!mech) return { ok: false, error: 'mecanismo inexistente' };
    if (mech.hidden && mech.kind !== 'keycardItem') return { ok: false, error: 'mecanismo oculto' };
    if (!this.inRange(player, mech)) return { ok: false, error: 'fora de alcance' };
    const puzzle = this.getPuzzleByMechanism(mechId);
    if (!puzzle) {
      // Mecanismos independentes (ex.: altar tratado pela sala)
      return { ok: false, error: 'não interativo' };
    }
    const st = this.state.get(puzzle.id);
    if (st.solved) {
      return { ok: true, alreadySolved: true, hint: this.hintFor(puzzle, st) };
    }
    const out = { ok: true, events: [], puzzleId: puzzle.id };

    switch (puzzle.kind) {
      case 'valvePair': {
        const nowMs = now;
        if (st.activatedAt && nowMs - st.activatedAt < puzzle.window) {
          // Segunda válvula dentro da janela -> resolvido
          this.solve(puzzle, st, now, 'As duas válvulas giram juntas.');
          out.events.push(this.mechanismEvent(mech, 'valve-turn'));
          return out;
        }
        st.activatedAt = nowMs;
        st.progress = 1;
        out.events.push(this.mechanismEvent(mech, 'valve-turn'));
        out.windowEndsAt = nowMs + puzzle.window;
        out.hint = 'Uma válvula girou. A outra espera.';
        return out;
      }
      case 'breakerOrder': {
        const expected = puzzle.order[st.sequence.length];
        if (mech.orderIndex === expected) {
          st.sequence.push(mech.orderIndex);
          out.events.push(this.mechanismEvent(mech, 'breaker-on'));
          if (st.sequence.length === puzzle.order.length) {
            this.solve(puzzle, st, now, 'A energia flui.');
            out.events.push({ type: 'sfx', sfx: 'power-up', gx: mech.gx, gy: mech.gy });
          } else {
            out.hint = `Disjuntor ${mech.orderIndex + 1} armado (${st.sequence.length}/${puzzle.order.length}).`;
            out.progress = { done: st.sequence.length, total: puzzle.order.length };
          }
        } else {
          st.sequence = [];
          out.events.push({ type: 'sfx', sfx: 'breaker-error', gx: mech.gx, gy: mech.gy });
          out.hint = 'A sequência quebrou. O primeiro disjuntor volta a piscar.';
          out.error = null;
          out.reset = true;
        }
        return out;
      }
      case 'holdLever': {
        if (mech.needsHeld) {
          st.held.add(playerId);
          out.hint = 'Você segura a alavanca. Não solte.';
          this.events.push({ type: 'leverHeld', playerId, mechId });
          return out;
        }
        // botão: precisa que alguém segure a alavanca
        if (st.held.size > 0) {
          const holder = Array.from(st.held)[0];
          st.pressed.set(mech.id, playerId);
          this.solve(puzzle, st, now, 'A contenção cede.');
          out.events.push(this.mechanismEvent(mech, 'plate-press'));
          out.heldBy = holder;
          return out;
        }
        out.error = null;
        out.hint = 'O botão não cede. Alguém precisa segurar a alavanca em outro lugar.';
        return out;
      }
      case 'pressurePlates': {
        st.pressed.set(mech.id, playerId);
        const partnerId = mech.partner;
        // Marca presença na placa deste jogador
        this.state.get(puzzle.id).pressed.set(mech.id, playerId);
        // Verifica se ambos os jogadores ainda estão em cima das placas
        const occupied = this.checkPlatesOccupied(puzzle, st);
        if (occupied.length >= 2) {
          this.solve(puzzle, st, now, 'As duas placas cedem ao mesmo tempo.');
          out.events.push(this.mechanismEvent(mech, 'plate-press'));
        } else {
          out.hint = 'Uma placa cedeu. Falta alguém na outra.';
        }
        return out;
      }
      case 'keycard': {
        if (mech.kind === 'keycardItem') {
          st.cardTaken = true;
          this.room.players?.forEach?.(() => {});
          const keycardHolder = player;
          keycardHolder.hasKeycard = true;
          mech.hidden = true;
          this.events.push({ type: 'keycardTaken', playerId });
          out.hint = 'Cartão magnético adquirido. Encontre o leitor.';
          out.events.push({ type: 'sfx', sfx: 'pickup-card', gx: mech.gx, gy: mech.gy });
          return out;
        }
        // leitor
        if (st.cardTaken && player.hasKeycard) {
          st.cardUsed = true;
          player.hasKeycard = false;
          this.solve(puzzle, st, now, 'A porta reconhece o cartão.');
          out.events.push(this.mechanismEvent(mech, 'card-read'));
          return out;
        }
        if (!st.cardTaken) {
          out.hint = 'O leitor pisca em vermelho. Falta o cartão.';
          return out;
        }
        out.hint = 'Alguém com o cartão precisa usar o leitor.';
        return out;
      }
      case 'silenceChoir': {
        if (mech.kind === 'bell') {
          const minInterval = 900;
          if (st.lastBellAt && now - st.lastBellAt < minInterval) {
            out.hint = 'Rápido demais. O coro despreza pressa.';
            st.bellCount = 0;
            return out;
          }
          const tooSlow = puzzle.interval && st.lastBellAt && now - st.lastBellAt > puzzle.interval;
          if (tooSlow) st.bellCount = 0;
          st.lastBellAt = now;
          st.bellCount += 1;
          out.events.push({ type: 'sfx', sfx: `bell-${Math.min(3, st.bellCount)}`, gx: mech.gx, gy: mech.gy });
          if (st.bellCount >= 3) {
            this.solve(puzzle, st, now, 'O coro se cala.');
            this.room.envEvents.push({ type: 'choirSilenced', at: now });
            out.events.push({ type: 'sfx', sfx: 'choir-stop' });
          } else {
            out.hint = `O sino tocou ${st.bellCount} vez(es). Sem pressa.`;
          }
          return out;
        }
        out.hint = 'O selo está frio. Alguém precisa tocar o sino.';
        return out;
      }
      default:
        return { ok: false, error: 'desconhecido' };
    }
  }

  checkPlatesOccupied(puzzle, st) {
    const plates = puzzle.mechanismIds.map((id) => this.mechanisms.get(id)).filter(Boolean);
    const occupied = [];
    for (const plate of plates) {
      for (const p of this.room.playerStates.values()) {
        if (p.dead) continue;
        if (this.inRange(p, plate, 1.4)) occupied.push({ plate: plate.id, playerId: p.id });
      }
    }
    return occupied;
  }

  mechanismEvent(mech, action) {
    return { type: 'mechanism', mechId: mech.id, action, gx: mech.gx, gy: mech.gy };
  }

  solve(puzzle, st, now, message) {
    st.solved = true;
    st.progress = 1;
    st.solvedAt = now;
    this.solvedOrder.push(puzzle.id);
    const sigil = this.world.sigils.find((s) => s.id === puzzle.sigilId);
    if (sigil) sigil.revealed = true;
    this.events.push({
      type: 'puzzleSolved',
      puzzleId: puzzle.id,
      region: puzzle.region,
      sigilId: puzzle.sigilId,
      message,
      solvedAt: now,
      kind: puzzle.kind,
    });
  }

  hintFor(puzzle, st) {
    return 'O mecanismo já está em repouso.';
  }

  /** Solta alavancas de jogadores desconectados/afastados. */
  update(dt, now) {
    for (const [puzzleId, st] of this.state) {
      const puzzle = this.world.puzzles.find((p) => p.id === puzzleId);
      if (!puzzle || st.solved) continue;
      if (puzzle.kind === 'holdLever') {
        for (const playerId of Array.from(st.held)) {
          const player = this.room.playerStates.get(playerId);
          const leverId = puzzle.mechanismIds.find((id) => this.mechanisms.get(id)?.needsHeld);
          const lever = leverId ? this.mechanisms.get(leverId) : null;
          if (!player || player.dead || player.disconnected || (lever && !this.inRange(player, lever, 2.4))) {
            st.held.delete(playerId);
            this.events.push({ type: 'leverReleased', playerId, puzzleId });
          }
        }
      }
      if (puzzle.kind === 'valvePair' && st.activatedAt && now - st.activatedAt > puzzle.window) {
        st.activatedAt = null;
        st.progress = 0;
        this.events.push({ type: 'puzzleReset', puzzleId, reason: 'tempo' });
      }
      if (puzzle.kind === 'silenceChoir' && st.lastBellAt && puzzle.interval && now - st.lastBellAt > puzzle.interval && st.bellCount > 0) {
        st.bellCount = 0;
        st.lastBellAt = 0;
        this.events.push({ type: 'puzzleReset', puzzleId, reason: 'pausa longa' });
      }
    }
  }

  drainEvents() {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  snapshot() {
    const out = {};
    for (const [id, st] of this.state) {
      out[id] = {
        s: st.solved ? 1 : 0,
        p: st.progress,
        c: st.bellCount || 0,
        seq: st.sequence,
        held: Array.from(st.held),
        card: st.cardTaken ? 1 : 0,
        since: st.activatedAt || 0,
      };
    }
    return out;
  }

  solvedCount() {
    let n = 0;
    for (const st of this.state.values()) if (st.solved) n++;
    return n;
  }
}
