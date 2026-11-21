/**
 * NULLSCAPE — Identidade dos ambientes.
 *
 * Cada ambiente (tema) possui paleta, materiais, mobiliário, nomes de sala,
 * ambiência sonora, iluminação e criaturas associadas. As cores são
 * deliberadamente dessaturadas, com um único acento estranho por região.
 *
 * Compartilhado com o cliente.
 */

export const TILE = 32;

export const T = Object.freeze({
  FLOOR: 0,
  WALL: 1,
  WATER: 2,
  VOID: 3,
  OBSTACLE: 4,
  DOORWAY: 5,
});

/** Materiais de chão por tema — o gerador escolhe variações. */
export const THEMES = {
  offices: {
    id: 'offices',
    label: 'Escritórios Intermináveis',
    ambience: 'office-hum',
    lighting: { density: 0.72, radius: [3, 5], unstable: 0.16, steady: 0.9 }, // fluorescente regular
    accent: '#d8cf9a',
    palette: {
      floor: 0x4b4a43,
      floorAlt: 0x504f47,
      carpet: 0x3f3e39,
      wall: 0x6c6a60,
      wallTop: 0x82806f,
      wallShadow: 0x2a2a26,
      trim: 0xb0a978,
      glow: 0xf2eccf,
      fog: 0x101110,
      ambient: 0.42,
    },
    props: ['desk', 'chair', 'cabinet', 'printer', 'plant', 'monitor', 'watercooler', 'whiteboard'],
    floorPattern: 'carpet',
    names: [
      'Ala 7-C', 'Sala de Espera 3', 'Departamento de Nada', 'Sala de Reuniões 12',
      'Copa Vazia', 'Depósito de Formulários', 'Sala dos Relógios', 'Ala do Silêncio',
      'Sala 404', 'Recursos Inumanos', 'Arquivo Morto', 'Sala de Espera 3 (repetida)',
    ],
    notes: [
      { title: 'Memorando 118', text: 'O expediente termina quando todos esquecerem que começou. Por favor, não desligue as luzes da ala norte. Elas são as únicas que ainda sabem o caminho de volta.' },
      { title: 'Formulário 7-B', text: 'Se você encontrar uma porta que não deveria existir, preencha o Anexo C. Se não houver Anexo C, você está na ala correta. Não ligue para o ramal 9. O ramal 9 liga para você.' },
    ],
  },
  hotel: {
    id: 'hotel',
    label: 'Hotel Vazio',
    ambience: 'hotel-drone',
    lighting: { density: 0.5, radius: [3, 5], unstable: 0.22, steady: 0.72 }, // abajures + corredor
    accent: '#c9a48a',
    palette: {
      floor: 0x46313a,
      floorAlt: 0x4b3640,
      carpet: 0x3a2831,
      wall: 0x6b5348,
      wallTop: 0x7d6455,
      wallShadow: 0x271c20,
      trim: 0xa07b5f,
      glow: 0xffd9a8,
      fog: 0x120d10,
      ambient: 0.38,
    },
    props: ['bed', 'nightstand', 'luggage', 'armchair', 'mirror', 'tvcrt', 'lampshade', 'dresser'],
    floorPattern: 'carpet',
    names: [
      'Corredor 3º Andar', 'Suíte 217', 'Quarto 118', 'Hall dos Espelhos',
      'Recepção Noturna', 'Quarto 0', 'Corredor Leste', 'Suíte Nupcial Vazia',
      'Quarto 217 (espelho)', 'Sala de Bagagens', 'Corredor 3º Andar (repetido)',
    ],
    notes: [
      { title: 'Livro de Registro', text: 'Quarto 217: hóspede recorrente. Check-in todas as noites às 03:33. Check-out: nunca. Observação da gerência: não pergunte o nome dele. Ele responde com o seu.' },
      { title: 'Cartão de Serviço', text: 'A governanta pede para não arrumar a cama do quarto 12. A cama se desfaz sozinha. Se ouvir batidas na parede, responda em três toques. Nunca em dois.' },
    ],
  },
  pool: {
    id: 'pool',
    label: 'Piscinas Internas Impossíveis',
    ambience: 'pool-reverb',
    lighting: { density: 0.62, radius: [4, 6], unstable: 0.3, steady: 0.95 }, // reflexo d'água no teto
    accent: '#8fd3c6',
    palette: {
      floor: 0x5a6f6c,
      floorAlt: 0x5f7572,
      carpet: 0x415552,
      wall: 0x7d9a95,
      wallTop: 0x92aca6,
      wallShadow: 0x253635,
      trim: 0xcfeee6,
      glow: 0xd8fff4,
      fog: 0x0d1616,
      ambient: 0.46,
    },
    props: ['lounger', 'umbrella', 'locker', 'divingboard', 'poolfloat', 'towel', 'signpool'],
    floorPattern: 'tile',
    water: true,
    names: [
      'Piscina Térmica 2', 'Vestiário Submerso', 'Piscina Olímpica (interior)',
      'Sala das Espreguiçadeiras', 'Piscina Infantil 0,4m', 'Borda Funda',
      'Piscina de Treinamento Vazia', 'Casa de Máquinas', 'Piscina Térmica 2 (repetida)',
    ],
    notes: [
      { title: 'Placa de Segurança', text: 'Profundidade: 1,2m — 3,8m — 11m — 1,2m. Não mergulhe na última poça. Ela não tem fundo, apenas paciência. Toalhas disponíveis na recepção. As toalhas murcham se você as observar.' },
      { title: 'Aviso do Salva-vidas', text: 'Se a água estiver calma demais, saia. A calmaria é o som que ela faz quando está prestando atenção em você.' },
    ],
  },
  garage: {
    id: 'garage',
    label: 'Estacionamentos Abandonados',
    ambience: 'garage-wind',
    lighting: { density: 0.4, radius: [4, 6], unstable: 0.5, steady: 0.6 }, // sódio velho
    accent: '#e0b465',
    palette: {
      floor: 0x393a3b,
      floorAlt: 0x3e3f40,
      carpet: 0x2f3031,
      wall: 0x54565a,
      wallTop: 0x63656a,
      wallShadow: 0x1a1b1d,
      trim: 0xc8a44e,
      glow: 0xffc978,
      fog: 0x0b0c0d,
      ambient: 0.3,
    },
    props: ['car', 'pillar', 'cone', 'barrel', 'signexit', 'cart', 'crate', 'puddle'],
    floorPattern: 'concrete',
    names: [
      'Nível -3', 'Nível -3 (outra vez)', 'Rampa B', 'Estacionamento Subsolo',
      'Nível -7', 'Casa de Escadas', 'Vaga 99', 'Nível -1', 'Oficina Abandonada',
      'Nível -3 (de novo)', 'Eco do Nível -3',
    ],
    notes: [
      { title: 'Bilhete no Para-brisa', text: 'Estacionei aqui há seis anos. O carro está aqui. Eu estou aqui. O nível -3 não estava aqui. Se encontrar uma saída, por favor, leve o carro. E o bilhete.' },
      { title: 'Apólice do Seguro', text: 'Cobertura válida para colisão, roubo, incêndio, inundação e repetição de trajeto. Não cobre desaparecimento de corredores. O nível -3 é considerado corredor.' },
    ],
  },
  school: {
    id: 'school',
    label: 'Escolas sem Alunos',
    ambience: 'school-tone',
    lighting: { density: 0.8, radius: [3, 6], unstable: 0.12, steady: 1.0 }, // tudo aceso
    accent: '#b9c48a',
    palette: {
      floor: 0x6a6a58,
      floorAlt: 0x70705e,
      carpet: 0x555544,
      wall: 0x8b8a72,
      wallTop: 0x9d9c83,
      wallShadow: 0x2c2c24,
      trim: 0x6f8a56,
      glow: 0xf6f3d7,
      fog: 0x11120e,
      ambient: 0.5,
    },
    props: ['studentdesk', 'locker', 'blackboard', 'teachersdesk', 'globe', 'stairs', 'bell', 'poster'],
    floorPattern: 'linoleum',
    names: [
      'Sala 12', 'Sala 13', 'Sala 13-B', 'Quadro-negro', 'Recreio Coberto',
      'Sala dos Professores', 'Auditório Vazio', 'Sala 12 (espelho)', 'Ginásio',
      'Biblioteca Silenciosa', 'Sala do Sino', 'Corredor dos Armários',
    ],
    notes: [
      { title: 'Prova de Recuperação', text: 'Questão 1: Quantos corredores existem nesta escola? (a) três (b) quatro (c) os que você já percorreu. Resposta correta: (c). Todas as outras respostas ficaram presas no quadro-negro.' },
      { title: 'Ata da Reunião', text: 'Presentes: ninguém. Pauta: por que o sino tocou hoje? Deliberação: o sino não tocou. Se você ouviu o sino, permaneça na sala até que ele toque de novo. Se ele tocar de novo, saia imediatamente. Ninguém assinou.' },
    ],
  },
  industrial: {
    id: 'industrial',
    label: 'Salas Industriais',
    ambience: 'industrial-hum',
    lighting: { density: 0.34, radius: [3, 5], unstable: 0.5, steady: 0.52 }, // lâmpadas de emergência
    accent: '#cf7f59',
    palette: {
      floor: 0x4a4c4d,
      floorAlt: 0x4f5152,
      carpet: 0x3c3e3f,
      wall: 0x5d6062,
      wallTop: 0x6e7173,
      wallShadow: 0x1f2122,
      trim: 0xb06538,
      glow: 0xffb27a,
      fog: 0x0c0d0e,
      ambient: 0.32,
    },
    props: ['crate', 'barrel', 'pipe', 'valve', 'machine', 'conveyor', 'shelf', 'panel'],
    floorPattern: 'metal',
    names: [
      'Sala de Máquinas', 'Casa de Bombas', 'Linha de Produção 0', 'Depósito de Peças',
      'Sala de Controle', 'Compressor', 'Válvula Norte', 'Oficina de Manutenção',
      'Sala de Espera dos Turnos', 'Almoxarifado', 'Refrigeração',
    ],
    notes: [
      { title: 'Ordem de Serviço 114', text: 'Nunca desligue a bomba 3. Ela não bombeia água. Ninguém sabe o que ela bombeia, e é exatamente isso que mantém a linha funcionando. Se ela parar, o prédio começa a lembrar.' },
      { title: 'Cracha Queimado', text: 'TURNO: SEM FIM. SETOR: Manutenção. FUNÇÃO: Observar a válvula. A válvula observa de volta. É um cargo reciproco. Não receba salário; não há com o que pagar.' },
    ],
  },
  residential: {
    id: 'residential',
    label: 'Residências Distorcidas',
    ambience: 'residential-tone',
    lighting: { density: 0.44, radius: [2, 4], unstable: 0.28, steady: 0.66 }, // luz doméstica
    accent: '#c99ab8',
    palette: {
      floor: 0x4a3c31,
      floorAlt: 0x4f4035,
      carpet: 0x3c3028,
      wall: 0x6a5a58,
      wallTop: 0x7b6a67,
      wallShadow: 0x241d1c,
      trim: 0x9a7a78,
      glow: 0xffe0bd,
      fog: 0x100c0b,
      ambient: 0.36,
    },
    props: ['sofa', 'tv', 'clock', 'lamp', 'table', 'frame', 'bookshelf', 'radiator'],
    floorPattern: 'wood',
    names: [
      'Sala de Estar', 'Cozinha 2', 'Quarto das Crianças', 'Corredor de Casa',
      'Banheiro Inexistente', 'Sala de Jantar 1', 'Quarto de Hóspedes', 'Sala de Estar (outra)',
      'Hall de Entrada', 'Despensa Longa', 'Quarto dos Espelhos',
    ],
    notes: [
      { title: 'Lista de Compras', text: 'Leite, pão, lâmpadas, mais lâmpadas, um corredor do tamanho exato da casa, algo para o jantar que não faça barulho. Não compre peixe. O peixe sabe.' },
      { title: 'Carta Não Enviada', text: 'Querida, a casa aumentou de novo. O corredor agora dá duas voltas em torno de si mesmo. Coloquei um bilhete na cozinha para lembrar onde fica a cozinha. O bilhete desapareceu. A cozinha também. Ainda estamos aqui.' },
    ],
  },
  threshold: {
    id: 'threshold',
    label: 'Limiares',
    ambience: 'liminal-void',
    lighting: { density: 0.2, radius: [2, 4], unstable: 0.35, steady: 0.35 }, // quase escuro
    accent: '#b7b0c9',
    palette: {
      floor: 0x4d4d52,
      floorAlt: 0x525257,
      carpet: 0x3f3f44,
      wall: 0x64646b,
      wallTop: 0x75757c,
      wallShadow: 0x1d1d20,
      trim: 0x8c8ca0,
      glow: 0xe8e8ff,
      fog: 0x08080b,
      ambient: 0.22,
    },
    props: ['column', 'bench', 'signempty', 'doorframe', 'plant', 'clock', 'lamp'],
    floorPattern: 'none',
    names: [
      'Limiar', 'O Vão', 'Sala sem Nome', 'Entre-Quartos', 'Antessala',
      'Sala das Portas', 'O Intervalo', 'Salão Vazio', 'Corredor que Não Leva',
      'Sala de Espera Eterna', 'Limiar (repetido)', 'Vazio Arquitetônico',
    ],
    notes: [
      { title: 'Placa de Bronze', text: 'Este lugar não foi construído. Foi encontrado. A administração pede que os visitantes não questionem a planta. A planta não questiona os visitantes.' },
      { title: 'Caderno Rasgado', text: 'Dia 1: cheguei. Dia 2: cheguei. Dia 2: cheguei. Dia 2: cheguei. Aprendi que aqui não existe dia 3, mas existem muitas portas. Anotei cada porta. As anotações agora são portas.' },
    ],
  },
};

export const THEME_IDS = Object.keys(THEMES);

/** Materiais de mobiliário e seus ocupantes (em tiles). */
export const FURNITURE = {
  desk: { w: 2, h: 1, blocks: true },
  chair: { w: 1, h: 1, blocks: false },
  cabinet: { w: 1, h: 1, blocks: true },
  printer: { w: 1, h: 1, blocks: true },
  plant: { w: 1, h: 1, blocks: true },
  monitor: { w: 1, h: 1, blocks: false },
  watercooler: { w: 1, h: 1, blocks: true },
  whiteboard: { w: 2, h: 1, blocks: true },
  bed: { w: 2, h: 2, blocks: true },
  nightstand: { w: 1, h: 1, blocks: true },
  luggage: { w: 1, h: 1, blocks: true },
  armchair: { w: 1, h: 1, blocks: true },
  mirror: { w: 1, h: 1, blocks: true, interactive: 'mirror' },
  tvcrt: { w: 1, h: 1, blocks: true },
  lampshade: { w: 1, h: 1, blocks: true },
  dresser: { w: 2, h: 1, blocks: true },
  lounger: { w: 2, h: 1, blocks: true },
  umbrella: { w: 1, h: 1, blocks: false },
  locker: { w: 1, h: 1, blocks: true, interactive: 'locker' },
  divingboard: { w: 1, h: 3, blocks: true },
  poolfloat: { w: 1, h: 1, blocks: false },
  towel: { w: 1, h: 1, blocks: false },
  signpool: { w: 1, h: 1, blocks: true },
  car: { w: 2, h: 3, blocks: true },
  pillar: { w: 1, h: 1, blocks: true },
  cone: { w: 1, h: 1, blocks: false },
  barrel: { w: 1, h: 1, blocks: true },
  signexit: { w: 1, h: 1, blocks: false },
  cart: { w: 2, h: 1, blocks: true },
  crate: { w: 1, h: 1, blocks: true },
  puddle: { w: 2, h: 2, blocks: false },
  studentdesk: { w: 1, h: 1, blocks: true },
  blackboard: { w: 3, h: 1, blocks: true },
  teachersdesk: { w: 2, h: 1, blocks: true },
  globe: { w: 1, h: 1, blocks: true },
  stairs: { w: 2, h: 2, blocks: true },
  bell: { w: 1, h: 1, blocks: false },
  poster: { w: 1, h: 1, blocks: false },
  machine: { w: 2, h: 2, blocks: true },
  conveyor: { w: 3, h: 1, blocks: true },
  shelf: { w: 2, h: 1, blocks: true },
  panel: { w: 1, h: 1, blocks: true, interactive: 'panel' },
  pipe: { w: 1, h: 2, blocks: true },
  valve: { w: 1, h: 1, blocks: true, interactive: 'valve' },
  sofa: { w: 3, h: 1, blocks: true },
  tv: { w: 2, h: 1, blocks: true },
  clock: { w: 1, h: 1, blocks: false },
  lamp: { w: 1, h: 1, blocks: false },
  table: { w: 2, h: 2, blocks: true },
  frame: { w: 1, h: 1, blocks: false },
  bookshelf: { w: 2, h: 1, blocks: true },
  radiator: { w: 2, h: 1, blocks: true },
  column: { w: 1, h: 1, blocks: true },
  bench: { w: 3, h: 1, blocks: true },
  signempty: { w: 1, h: 1, blocks: false },
  doorframe: { w: 1, h: 1, blocks: false },
};

export const ROOM_ROLES = Object.freeze({
  ENTRY: 'entry',
  EXIT: 'exit',
  HUB: 'hub',
  NORMAL: 'normal',
  VAULT: 'vault',
  SECRET: 'secret',
  ANOMALY: 'anomaly',
});

export function themeFor(id) {
  return THEMES[id] || THEMES.threshold;
}
