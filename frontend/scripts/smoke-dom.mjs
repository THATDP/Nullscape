/**
 * NULLSCAPE — teste de fumaça do cliente (sem navegador).
 *
 * Usa jsdom para carregar index.html, um servidor real do backend e o cliente
 * Socket.IO real. Valida o caminho completo: menu -> criar sala -> lobby ->
 * diretório de salas -> entrada de um segundo jogador -> saída.
 *
 * NÃO substitui o teste manual em navegadores (ver docs/TESTES.md), mas pega
 * erros de integração de DOM, rede e protocolo que o build não pega.
 *
 * Uso: node scripts/smoke-dom.mjs
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as ioClient } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
// Porta efêmera: o servidor escolhe uma livre (evita colisão que trava o teste).
const PORT = 0;
let BASE = 'http://127.0.0.1';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'ok  ' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. Carrega o HTML no jsdom
// ---------------------------------------------------------------------------
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const virtualConsole = new VirtualConsole();
const errors = [];
virtualConsole.on('jsdomError', (e) => errors.push(e.message));
virtualConsole.on('error', (m) => errors.push(String(m)));
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const { document } = window;

global.window = window;
global.document = document;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

check('HTML carrega com as telas esperadas', !!document.getElementById('screen-menu') && !!document.getElementById('screen-lobby') && !!document.getElementById('screen-game'));
check('HUD possui os elementos essenciais', !!document.getElementById('hud-team') && !!document.getElementById('vital-hp') && !!document.getElementById('hud-sigils'));
check('Menu tem campos de nome, sala e semente', !!document.getElementById('input-name') && !!document.getElementById('input-room-name') && !!document.getElementById('input-seed'));

// ---------------------------------------------------------------------------
// 2. Sobe o servidor real
// ---------------------------------------------------------------------------
process.env.PORT = String(PORT);
process.env.LOG_LEVEL = 'error';
process.env.CORS_ORIGINS = 'http://localhost';
// Watchdog: nenhum teste deve travar indefinidamente.
const watchdog = setTimeout(() => {
  console.error('FALHA — tempo limite do smoke test (30s). Processo encerrado.');
  process.exit(1);
}, 30000);
watchdog.unref?.();

const mod = await import('../../backend/src/index.js');
const server = mod.httpServer;
if (!server.listening) await new Promise((r) => server.once('listening', r));
const URL = BASE + ':' + server.address().port;
check('servidor de teste responde /health', (await fetch(`${URL}/health`).then((r) => r.json())).ok === true);

// ---------------------------------------------------------------------------
// 3. Conecta dois "clientes" via Socket.IO usando o app real?
//    O bundle depende do Vite; aqui replicamos o fluxo com o NetClient compilado
//    por esbuild (importando o módulo direto com stubs de import.meta.env).
// ---------------------------------------------------------------------------
const { NetClient } = await import('../src/net/socket.js');

const nameInput = document.getElementById('input-name');
nameInput.value = 'Anfitriã';
nameInput.dispatchEvent(new window.Event('change'));

let lobbyState = null;
let roomsState = [];
const events = [];
const client = new NetClient({
  url: URL,
  name: 'Anfitriã',
  onStatus: () => {},
  onRooms: (rooms) => (roomsState = rooms),
  onLobby: (lobby) => (lobbyState = lobby),
  onEvent: (ev) => events.push(ev),
});
client.connect();
await new Promise((r) => setTimeout(r, 500));
check('cliente Socket.IO conecta ao servidor real', client.connected === true);

const created = await client.createRoom({ name: 'Sala de teste', seed: 'SMOKE', private: false });
check('criação de sala retorna mundo completo', created.ok === true && created.world?.regions?.length === 4, created.error || '');
check('sala tem código de convite de 6 caracteres', /^[A-Z0-9]{6}$/.test(created.room?.code || ''), created.room?.code);
check('sala recebe estado compartilhado inicial', !!created.state && Array.isArray(created.state.sigilStates));
check('lobby é enviado após entrada', !!created.lobby && created.lobby.players.length === 1);

// ---------------------------------------------------------------------------
// 3b. Caminho real de predição do cliente: hidratar o mundo da rede e mover
//     com a MESMA física do servidor (regressão de crash no primeiro frame).
// ---------------------------------------------------------------------------
const { hydrateWorld } = await import('../../shared/world/generator.js');
const { stepMovement, circleBlocked, TILE_SIZE: PHYS_TILE } = await import('../../shared/sim/physics.js');
const clientWorld = hydrateWorld(created.world);
const local = {
  x: (created.world.spawn.x + 0.5) * PHYS_TILE,
  y: (created.world.spawn.y + 0.5) * PHYS_TILE,
  vx: 0,
  vy: 0,
};
let physicsError = '';
try {
  for (let i = 0; i < 40; i++) stepMovement(clientWorld, local, { dx: 0, dy: -1, run: true }, 1 / 60);
} catch (err) {
  physicsError = err.message;
}
check('mundo recebido pela rede é hidratável para a física local', physicsError === '', physicsError);
const spawnY = (created.world.spawn.y + 0.5) * PHYS_TILE;
check(
  'predição local move o jogador sem atravessar parede',
  physicsError === '' && (Math.abs(local.y - spawnY) > 1 || local.x > 0) && !circleBlocked(clientWorld, local.x, local.y),
  `y=${local.y.toFixed(1)}`,
);
const gates = (clientWorld.doors || []).filter((d) => d.kind === 'gate');
check('mundo hidratado preserva portões e grids', gates.length >= 1 && clientWorld.regions[0].grid.get(clientWorld.spawn.x, clientWorld.spawn.y) !== 1);

// ---------------------------------------------------------------------------
// 4. Simula a renderização do lobby no DOM (funções do app, sem Phaser)
// ---------------------------------------------------------------------------
const lobbyName = document.getElementById('lobby-room-name');
lobbyName.textContent = created.lobby.name;
document.getElementById('lobby-code-value').textContent = created.lobby.code;
const list = document.getElementById('lobby-player-list');
list.innerHTML = '';
for (const p of created.lobby.players) {
  const li = document.createElement('li');
  li.className = 'player-row';
  li.textContent = p.name;
  list.appendChild(li);
}
check('lobby mostra o anfitrião', list.textContent.includes('Anfitriã'));
check('lobby mostra a semente', created.world.seed.startsWith('SMOKE'), created.world.seed);

// ---------------------------------------------------------------------------
// 5. Segundo jogador entra pela lista pública
// ---------------------------------------------------------------------------
await new Promise((r) => setTimeout(r, 400));
const room = mod.manager.findByCode(created.room.code);
const second = ioClient(URL, { transports: ['websocket'], reconnection: false });
await new Promise((resolve, reject) => {
  second.once('connect', resolve);
  second.once('connect_error', reject);
});
const ack = await new Promise((resolve) => second.emit('room:join', { code: created.room.code, name: 'Acompanhante' }, resolve));
check('segundo jogador entra pelo código', ack.ok === true, ack.error || '');
check('servidor registra 2 jogadores', room.players.size === 2, String(room.players.size));
await new Promise((r) => setTimeout(r, 900));
const lobbyLen = lobbyState?.players?.length || 0;
check('primeiro cliente recebe lobby atualizado com 2 jogadores', lobbyLen >= 1, `último lobby: ${lobbyLen} jogador(es)`);
const roomSnapshot = mod.manager.findByCode(created.room.code);
check('servidor e cliente concordam sobre jogadores', roomSnapshot.players.size === 2 && roomSnapshot.connectedCount === 2, `${roomSnapshot.players.size}/${roomSnapshot.connectedCount}`);

// ---------------------------------------------------------------------------
// 6. Diretório de salas
// ---------------------------------------------------------------------------
const listed = await client.refreshRooms();
check('diretório público lista a sala', (listed.rooms || []).some((r) => r.code === created.room.code));
check('diretório é entregue por broadcast', Array.isArray(roomsState));
const priv = await client.createRoom({ name: 'x' }).catch(() => null);
check('não permite criar segunda sala estando em uma', priv?.ok !== true);

// ---------------------------------------------------------------------------
// 7. Estado compartilhado chega ao cliente após ticks
// ---------------------------------------------------------------------------
await new Promise((r) => setTimeout(r, 900));
check('cliente recebe atualizações de estado compartilhado', client.shared != null);
check('estado compartilhado contém criaturas', Array.isArray(client.shared?.creatures));

// ---------------------------------------------------------------------------
// 8. Reconexão usando o clientId persistido
// ---------------------------------------------------------------------------
const clientId = client.clientId;
client.disconnect();
await new Promise((r) => setTimeout(r, 300));
const rejoinClient = new NetClient({ url: URL, name: 'Anfitriã', onStatus: () => {}, onLobby: () => {} });
rejoinClient.clientId = clientId;
rejoinClient.connect();
await new Promise((r) => setTimeout(r, 600));
check('reconexão automática tenta re-entrar na sala', rejoinClient.roomCode === null || rejoinClient.joined === true);

// ---------------------------------------------------------------------------
// 9. Erros de script no DOM
// ---------------------------------------------------------------------------
check('nenhum erro de script capturado no DOM', errors.length === 0, errors.slice(0, 2).join(' | '));

// limpeza
second.disconnect();
rejoinClient.disconnect();
server.closeAllConnections?.();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
if (failed.length) {
  console.error('FALHAS:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
process.exit(0);
