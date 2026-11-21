/**
 * NULLSCAPE — Camada de rede (Socket.IO).
 *
 * Protocolo (cliente -> servidor):
 *   hello         { name, clientId }         entrada no lobby (sem cadastro)
 *   room:create   { name?, seed?, private?, code? } -> ack
 *   room:join     { code | roomId, name?, clientId? } -> ack
 *   room:rejoin   { code, clientId }         reconexão
 *   room:leave    {}                          sair
 *   room:list     {}                          diretório público (também HTTP)
 *   input         { seq, dx, dy, run, look }  intenção de movimento
 *   interact      { seq, targetId }           interagir com objeto/próximo
 *   ping:client   { t }                       medição de latência
 *
 * Protocolo (servidor -> cliente):
 *   welcome       { playerId, clientId, room, world, state, serverTime }
 *   w             { seq }                     confirma o último input processado
 *   s             { t, p: [estado jogador] }  snapshots de movimento (20Hz, volatile)
 *   st            { ...estado compartilhado } progresso, portas, criaturas, anomalias
 *   e             { t, events }               eventos narrativos
 *   room:list     { rooms }
 *   error         { message, code }
 */

import { randomUUID } from 'node:crypto';
import { serializeWorld } from '../../shared/world/generator.js';
import { RoomConstants } from './rooms.js';

const MAX_EVENTS_PER_SEC = 45;
const MAX_PAYLOAD_BYTES = 4096;

function makeRateLimiter(maxPerSecond) {
  const buckets = new Map();
  return {
    allow(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b || now - b.start > 1000) {
        b = { start: now, count: 0 };
        buckets.set(key, b);
      }
      b.count++;
      return b.count <= maxPerSecond;
    },
    cleanup(now = Date.now()) {
      for (const [k, b] of buckets) if (now - b.start > 5000) buckets.delete(k);
    },
  };
}

function payloadSize(data) {
  try {
    return JSON.stringify(data).length;
  } catch {
    return Infinity;
  }
}

function validName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/[^\p{L}\p{N} _\-.'’]/gu, '').trim().slice(0, 18);
  return clean || null;
}

function validClientId(id) {
  if (typeof id !== 'string') return null;
  if (!/^[A-Za-z0-9:_-]{8,72}$/.test(id)) return null;
  return id;
}

/** Gera uma identidade de sessão (token de reconexão) válida para o cliente. */
function newClientId(randomUUID) {
  return `ns_${randomUUID()}`;
}

function sanitizeSeed(seed) {
  if (seed === undefined || seed === null) return null;
  if (typeof seed !== 'string' && typeof seed !== 'number') return null;
  const s = String(seed).trim().toUpperCase().replace(/[^A-Z0-9\-:]/g, '').slice(0, 24);
  return s || null;
}

export function attachSocketHandlers({ io, manager, log, env, serverStats }) {
  const limiter = makeRateLimiter(MAX_EVENTS_PER_SEC);
  const actionLimiter = makeRateLimiter(18); // interações por segundo por socket
  const lobbyLimiter = makeRateLimiter(4);

  io.on('connection', (socket) => {
    serverStats.connections++;
    socket.data.connectedAt = Date.now();
    socket.data.name = 'Anônimo';
    socket.data.clientId = null;
    socket.data.roomId = null;
    socket.data.lastSeq = 0;
    socket.data.ip = socket.handshake.address;
    log.debug(`[socket] ${socket.id} conectado (${socket.data.ip})`);

    const guard = (fn) => (payload, ack) => {
      serverStats.messagesIn++;
      if (payloadSize(payload) > MAX_PAYLOAD_BYTES) {
        serverStats.rejected++;
        log.warn(`[socket] payload grande de ${socket.id}`);
        return;
      }
      if (!limiter.allow(socket.id)) {
        serverStats.rejected++;
        if (serverStats.rejected % 20 === 0) log.warn(`[socket] flood detectado (${socket.id})`);
        return;
      }
      try {
        fn(payload || {}, typeof ack === 'function' ? ack : () => {});
      } catch (err) {
        log.error(`[socket] erro em handler: ${err.stack || err.message}`);
      }
    };

    const currentRoom = () => manager.getBySocket(socket.id);

    const sendError = (ack, message, code = 'error') => ack({ ok: false, error: message, code });

    // -- Lobby ---------------------------------------------------------------
    socket.on(
      'hello',
      guard((payload, ack) => {
        const name = validName(payload.name);
        if (name) socket.data.name = name;
        const clientId = validClientId(payload.clientId) || socket.data.clientId || newClientId(randomUUID);
        socket.data.clientId = clientId;
        ack({
          ok: true,
          name: socket.data.name,
          clientId: socket.data.clientId,
          serverTime: Date.now(),
          maxPlayers: RoomConstants.MAX_PLAYERS,
          rooms: manager.listPublic(),
        });
      }),
    );

    socket.on(
      'room:list',
      guard((payload, ack) => {
        if (!lobbyLimiter.allow(socket.id)) return;
        ack({ ok: true, rooms: manager.listPublic() });
      }),
    );

    // -- Criação / entrada ----------------------------------------------------
    socket.on(
      'room:create',
      guard((payload, ack) => {
        if (currentRoom()) return sendError(ack, 'você já está em uma sala');
        if (!lobbyLimiter.allow(socket.id)) return sendError(ack, 'calma — muitas tentativas', 'rate');
        const name = validName(payload.name) || socket.data.name;
        socket.data.name = name;
        const clientId = validClientId(payload.clientId) || socket.data.clientId || newClientId(randomUUID);
        socket.data.clientId = clientId;
        const seed = sanitizeSeed(payload.seed);
        const result = manager.createRoom({
          name: validName(payload.roomName) || `${name} · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
          seed,
          isPrivate: !!payload.private,
          hostId: socket.id,
          hostName: name,
          code: payload.code,
        });
        if (result.error) return sendError(ack, result.error);
        serverStats.roomsCreated++;
        joinRoom(socket, result.room, { name, clientId, ack });
      }),
    );

    socket.on(
      'room:join',
      guard((payload, ack) => {
        if (currentRoom()) return sendError(ack, 'você já está em uma sala');
        if (!lobbyLimiter.allow(socket.id)) return sendError(ack, 'calma — muitas tentativas', 'rate');
        const room = payload.code ? manager.findByCode(payload.code) : manager.get(String(payload.roomId || ''));
        if (!room) return sendError(ack, 'sala não encontrada', 'not_found');
        if (room.players.size >= RoomConstants.MAX_PLAYERS) return sendError(ack, 'sala cheia', 'full');
        const name = validName(payload.name) || socket.data.name;
        socket.data.name = name;
        const clientId = validClientId(payload.clientId) || socket.data.clientId || newClientId(randomUUID);
        socket.data.clientId = clientId;
        joinRoom(socket, room, { name, clientId, ack });
      }),
    );

    socket.on(
      'room:rejoin',
      guard((payload, ack) => {
        const room = payload.code ? manager.findByCode(payload.code) : manager.get(String(payload.roomId || ''));
        if (!room) return sendError(ack, 'sala não existe mais', 'gone');
        const clientId = validClientId(payload.clientId) || socket.data.clientId;
        if (!clientId) return sendError(ack, 'identidade inválida', 'invalid');
        const player = room.reconnectPlayer({ clientId, socketId: socket.id });
        if (!player) return sendError(ack, 'não há sessão para reconectar', 'no_session');
        socket.data.clientId = clientId;
        socket.data.name = player.name;
        socket.data.roomId = room.id;
        socket.join(room.id);
        manager.bindSocket(socket.id, room.id);
        ack({
          ok: true,
          reconnected: true,
          playerId: player.id,
          name: player.name,
          room: manager.publicInfo(room),
          lobby: lobbyState(room),
          serverTime: Date.now(),
        });
        room.pushEvent({ type: 'playerReconnected', playerId: player.id, name: player.name });
        log.info(`[socket] ${socket.id} reconectado em ${room.id} como ${player.name}`);
      }),
    );

    socket.on(
      'room:leave',
      guard((payload, ack) => {
        const room = currentRoom();
        if (room) {
          room.removePlayer(socket.id, 'left');
          socket.leave(room.id);
          manager.unbindSocket(socket.id);
          socket.data.roomId = null;
          io.to(room.id).emit('lobby', lobbyState(room));
          broadcastRoomList();
          if (room.isEmpty()) log.info(`[sala] vazia: ${room.id} aguardando limpeza`);
        }
        ack({ ok: true, rooms: manager.listPublic() });
      }),
    );

    // -- Jogo ----------------------------------------------------------------
    socket.on(
      'input',
      guard((payload) => {
        const room = currentRoom();
        if (!room) return;
        const seq = Number(payload.seq) || 0;
        const result = room.applyInput(socket.id, {
          dx: payload.dx,
          dy: payload.dy,
          run: payload.run,
          look: payload.look,
        });
        if (result.ok) {
          socket.data.lastSeq = seq;
          // ack de reconciliação (levemente agregado para economizar banda)
          if (seq % 3 === 0) socket.volatile.emit('w', { seq });
        }
      }),
    );

    socket.on(
      'interact',
      guard((payload, ack) => {
        const room = currentRoom();
        if (!room) return;
        if (!actionLimiter.allow(socket.id)) return;
        const targetId = typeof payload.targetId === 'string' ? payload.targetId.slice(0, 40) : '';
        if (!targetId) return sendError(ack, 'alvo inválido');
        const result = room.interact(socket.id, targetId);
        ack({ ok: !!result.ok, error: result.error || null, hint: result.hint || null, type: result.type || null, note: result.note || null });
      }),
    );

    socket.on(
      'respawn',
      guard((payload, ack) => {
        const room = currentRoom();
        if (!room) return;
        const ok = room.respawn(socket.id);
        ack({ ok });
      }),
    );

    socket.on(
      'ping:client',
      guard((payload, ack) => {
        ack({ ok: true, t: payload.t, serverTime: Date.now() });
      }),
    );

    socket.on('disconnect', (reason) => {
      const room = currentRoom();
      if (room) {
        const player = room.markDisconnected(socket.id);
        if (player) {
          io.to(room.id).emit('lobby', lobbyState(room));
          broadcastRoomList();
        }
        manager.unbindSocket(socket.id);
      }
      limiter.cleanup();
      log.debug(`[socket] ${socket.id} desconectado (${reason})`);
    });

    function joinRoom(sock, room, { name, clientId, ack }) {
      const result = room.addPlayer({ socketId: sock.id, name, clientId });
      if (result.error) return sendError(ack, result.error);
      sock.join(room.id);
      manager.bindSocket(sock.id, room.id);
      sock.data.roomId = room.id;
      sock.data.name = result.player.name;
      const worldPayload = serializeWorld(room.world);
      ack({
        ok: true,
        playerId: result.player.id,
        clientId,
        name: result.player.name,
        color: result.player.color,
        room: manager.publicInfo(room),
        world: worldPayload,
        state: room.stateSnapshot(),
        lobby: lobbyState(room),
        serverTime: Date.now(),
        tickRate: RoomConstants.TICK_RATE,
      });
      room.pushEvent({ type: 'playerJoined', player: room.publicPlayer(result.player) });
      io.to(room.id).emit('lobby', lobbyState(room));
      broadcastRoomList();
      log.info(`[sala] ${result.player.name} entrou em ${room.id} (${room.players.size}/${RoomConstants.MAX_PLAYERS})`);
    }

    function broadcastRoomList() {
      io.emit('rooms', { rooms: manager.listPublic(), now: Date.now() });
      const room = manager.getBySocket(socket.id);
      if (room) io.to(room.id).emit('lobby', lobbyState(room));
    }
  });

  function lobbyState(room) {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      seed: room.seed,
      private: room.isPrivate,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map((p) => room.publicPlayer(p)),
      max: RoomConstants.MAX_PLAYERS,
      started: room.players.size > 0,
    };
  }

  // Reenvia o diretório para todos a cada 6s (barato: poucas salas)
  setInterval(() => {
    if (manager.rooms.size > 0) io.emit('rooms', { rooms: manager.listPublic(), now: Date.now() });
  }, 6000).unref();

  // Métricas leves nos logs
  setInterval(() => {
    const players = manager.all().reduce((n, r) => n + r.players.size, 0);
    serverStats.peakPlayers = Math.max(serverStats.peakPlayers, players);
    log.debug(`[stats] salas=${manager.rooms.size} jogadores=${players} pico=${serverStats.peakPlayers}`);
  }, 30000).unref();
}
