const CELL_SIZE = 24;
const DIFFICULTY = {
  easy: {
    label: 'Easy', boardSize: 6, tickMs: 250, tickStepMs: 5, minTickMs: 110, foodScore: 10, foodCount: 3,
    timeFoodIntervalMs: Infinity // 시간 먹이 없음
  },
  normal: {
    label: 'Normal', boardSize: 10, tickMs: 150, tickStepMs: 10, minTickMs: 60, foodScore: 15, foodCount: 3,
    timeFoodIntervalMs: 20000, timeFoodBatch: 1, timeFoodMax: 2, timeFoodMargin: 5, timeFoodSlowMs: 0
  },
  hard: {
    label: 'Hard', boardSize: 16, tickMs: 120, tickStepMs: 10, minTickMs: 50, foodScore: 20, foodCount: 1,
    timeFoodIntervalMs: 10000, timeFoodBatch: 1, timeFoodMax: Infinity, timeFoodMargin: 8, timeFoodSlowMs: 10
  }
};
const DIFFICULTY_ORDER = ['easy', 'normal', 'hard']; // 선택 화면 버튼 순서
const DEFAULT_LEVEL = 'normal'; // 시작 화면 배경 보드 기준
const FOODS_PER_SPEED_STEP = 5; // 속도가 한 단계 빨라지는 먹이 개수
const INPUT_QUEUE_MAX = 1; // 틱 사이에 저장할 수 있는 방향 입력 개수
const EARLY_TURN_RATIO = 0.5; // 조기 이동으로 정해진 틱 시각보다 앞당길 수 있는 최대 폭 (틱 간격 비율)
const SNAKE_START_LENGTH = 3;
const INITIAL_DIR = { x: 1, y: 0 };
const KEY_DIRS = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }
};
const COLOR_HEAD = '#7f7';
const COLOR_BODY = '#3a3';
const COLOR_FOOD = '#f55';
const COLOR_TIME_FOOD = '#fc3';
const BEST_SCORE_KEY_PREFIX = 'snakeBestScore_'; // 난이도별 키: 접두사 + 난이도

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let level = DEFAULT_LEVEL; // 현재 난이도 키
let config = DIFFICULTY[level]; // 현재 난이도 설정
let boardSize = config.boardSize;
let snake = [];
let appliedDir = INITIAL_DIR; // 직전 틱에 실제 적용된 방향
let dirQueue = []; // 다음 틱들에 차례로 적용할 방향 입력

// 보드 중앙에서 오른쪽을 향하는 길이 3 뱀을 새로 만든다
const createSnake = () => {
  const center = Math.floor(boardSize / 2);
  return Array.from({ length: SNAKE_START_LENGTH }, (_, i) => ({ x: center - i, y: center }));
};

// 캔버스 크기를 현재 보드 크기와 devicePixelRatio에 맞게 설정
const setupCanvas = () => {
  const size = boardSize * CELL_SIZE;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

// 먹이와 뱀을 화면에 그린다
const draw = () => {
  ctx.clearRect(0, 0, boardSize * CELL_SIZE, boardSize * CELL_SIZE);
  const drawFoods = (list, color) => {
    ctx.fillStyle = color;
    list.forEach(f => {
      ctx.fillRect(f.x * CELL_SIZE + 3, f.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
    });
  };
  drawFoods(foods, COLOR_FOOD);
  drawFoods(timeFoods, COLOR_TIME_FOOD);
  snake.forEach((c, i) => {
    ctx.fillStyle = i === 0 ? COLOR_HEAD : COLOR_BODY;
    ctx.fillRect(c.x * CELL_SIZE + 1, c.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  });
};

// 대기 중 첫 방향 입력으로 출발: 시계를 시작하고 즉시 첫 틱 실행 (몸통이 있는 왼쪽 입력은 무시)
const beginMoving = (dir) => {
  if (dir.x === -INITIAL_DIR.x && dir.y === -INITIAL_DIR.y) return;
  dirQueue = [dir];
  state = 'playing';
  startTime = Date.now();
  endTime = null;
  nextDueAt = startTime;
  scheduleTick(0);
};

// 방향 입력을 받아 큐의 마지막 방향 기준으로 유효하면 큐에 추가 (같은·반대 방향은 무시, 큐가 가득 차면 마지막 입력을 교체)
const handleKey = (e) => {
  const dir = KEY_DIRS[e.code];
  if (!dir) return;
  e.preventDefault();
  if (state === 'waiting') {
    beginMoving(dir);
    return;
  }
  if (state !== 'playing') return;
  const full = dirQueue.length >= INPUT_QUEUE_MAX;
  // 큐가 가득 차면 마지막 입력을 교체 대상으로 보고, 그 직전 방향 기준으로 유효성을 판단한다
  const baseIdx = dirQueue.length - (full ? 2 : 1);
  const last = baseIdx >= 0 ? dirQueue[baseIdx] : appliedDir;
  const isSame = dir.x === last.x && dir.y === last.y;
  const isOpposite = dir.x === -last.x && dir.y === -last.y;
  if (isSame || isOpposite) return;
  if (full) {
    dirQueue[dirQueue.length - 1] = dir;
  } else {
    dirQueue.push(dir);
  }
  advanceTick();
};

// 뱀과 기존 먹이가 차지하지 않은 빈 칸 중 무작위 위치를 반환 (빈 칸이 없으면 null)
const spawnFood = () => {
  const occupied = snake.concat(foods, timeFoods);
  const empty = [];
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if (!occupied.some(c => c.x === x && c.y === y)) empty.push({ x, y });
    }
  }
  return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
};

// 난이도별 기본 먹이 개수가 될 때까지 채운다 (빈 칸이 모자라면 있는 만큼만)
const fillFoods = () => {
  while (foods.length < config.foodCount) {
    const cell = spawnFood();
    if (!cell) break;
    foods.push(cell);
  }
};

// 생성 주기가 지났으면 상한과 여유 칸이 허용하는 만큼 시간 먹이를 놓는다 (건너뛴 주기는 다시 시도하지 않음)
const spawnTimeFoods = () => {
  const elapsed = Date.now() - startTime;
  if (elapsed < nextTimeFoodAt) return;
  while (nextTimeFoodAt <= elapsed) nextTimeFoodAt += config.timeFoodIntervalMs;
  const emptyCount = boardSize * boardSize - snake.length - foods.length - timeFoods.length;
  const count = Math.min(
    config.timeFoodBatch,
    config.timeFoodMax - timeFoods.length,
    emptyCount - config.timeFoodMargin
  );
  for (let i = 0; i < count; i++) timeFoods.push(spawnFood());
};

// 먹은 개수를 세고, FOODS_PER_SPEED_STEP개마다 틱 간격을 한 단계 줄인다 (하한 적용)
const speedUp = () => {
  foodsEaten++;
  if (foodsEaten % FOODS_PER_SPEED_STEP === 0) {
    currentTickMs = Math.max(config.minTickMs, currentTickMs - config.tickStepMs);
  }
};

// 시간 먹이의 속도 효과: 감속 난이도는 틱 간격을 늘리고(시작 틱까지만), 나머지는 일반 먹이처럼 개수에 포함
const applyTimeFoodSpeed = () => {
  if (config.timeFoodSlowMs > 0) {
    currentTickMs = Math.min(config.tickMs, currentTickMs + config.timeFoodSlowMs);
  } else {
    speedUp();
  }
};

// 새 머리 위치가 벽이거나 몸통이면 true (먹지 않는 틱엔 비워지는 꼬리 칸은 제외)
const isCollision = (newHead, eating) => {
  if (newHead.x < 0 || newHead.x >= boardSize || newHead.y < 0 || newHead.y >= boardSize) return true;
  const body = eating ? snake : snake.slice(0, -1);
  return body.some(c => c.x === newHead.x && c.y === newHead.y);
};

// 한 틱: 큐에서 방향 하나를 꺼내 확정 후 충돌이면 false, 아니면 이동(일반·시간 먹이를 먹으면 꼬리 유지·점수·속도 반영)하고 true
const step = () => {
  if (dirQueue.length) appliedDir = dirQueue.shift();
  const head = snake[0];
  const newHead = { x: head.x + appliedDir.x, y: head.y + appliedDir.y };
  const isAtHead = (f) => f.x === newHead.x && f.y === newHead.y;
  const foodIndex = foods.findIndex(isAtHead);
  const timeFoodIndex = timeFoods.findIndex(isAtHead);
  const eating = foodIndex !== -1 || timeFoodIndex !== -1;
  if (isCollision(newHead, eating)) return false;
  snake.unshift(newHead);
  if (eating) {
    score += config.foodScore;
    if (foodIndex !== -1) {
      foods.splice(foodIndex, 1);
      speedUp();
    } else {
      timeFoods.splice(timeFoodIndex, 1); // 1회용이라 다시 만들지 않음
      applyTimeFoodSpeed();
    }
    fillFoods();
  } else {
    snake.pop();
  }
  return true;
};

// localStorage에서 해당 난이도의 최고 점수를 읽는다 (접근 실패나 잘못된 값이면 0)
const loadBestScore = (key) => {
  try {
    const value = Number(localStorage.getItem(BEST_SCORE_KEY_PREFIX + key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (e) {
    return 0;
  }
};

// 현재 난이도의 최고 점수를 localStorage에 저장 (접근 실패는 무시)
const saveBestScore = (value) => {
  try {
    localStorage.setItem(BEST_SCORE_KEY_PREFIX + level, String(value));
  } catch (e) {
    // 저장소 접근이 막혀도 게임은 계속 동작
  }
};

// 점수·최고 점수·경과시간(mm:ss)을 화면에 갱신
const updateHud = () => {
  const sec = Math.floor(((endTime ?? Date.now()) - startTime) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  scoreEl.textContent = score;
  bestEl.textContent = bestScore ?? '-'; // 난이도 선택 전에는 '-'
  timeEl.textContent = pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
};

// 오버레이에 제목·점수·버튼을 채워 보여준다 (buttons: [레이블, 핸들러] 배열)
const showOverlay = (title, info, buttons) => {
  overlayEl.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'title';
  h.textContent = title;
  overlayEl.appendChild(h);
  if (info) {
    const p = document.createElement('div');
    p.textContent = info;
    overlayEl.appendChild(p);
  }
  buttons.forEach(([label, handler]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', handler);
    overlayEl.appendChild(b);
  });
  overlayEl.style.display = 'flex';
};

// 게임 종료: 시간 정지, 최고 점수 갱신 후 결과 오버레이 표시 (cleared면 CLEAR)
const endGame = (cleared) => {
  state = 'over';
  endTime = Date.now();
  if (score > bestScore) {
    bestScore = score;
    saveBestScore(bestScore);
  }
  updateHud();
  showOverlay(cleared ? 'CLEAR' : 'GAME OVER', 'SCORE ' + score,
    [['Retry', () => startGame(level)], ['Exit', showStart]]);
};

// 다음 틱을 delay(ms) 뒤로 예약 (기존 예약은 취소해 타이머가 항상 하나만 남게 함)
const scheduleTick = (delay) => {
  clearTimeout(tickTimer);
  nextTickAt = Date.now() + delay;
  tickTimer = setTimeout(tick, delay);
};

// 조기 이동: 정해진 틱 시각(nextDueAt)보다 최대 틱 간격의 EARLY_TURN_RATIO만큼 앞당김 (더 늦어지는 경우는 유지)
const advanceTick = () => {
  const now = Date.now();
  const earliest = nextDueAt - currentTickMs * EARLY_TURN_RATIO;
  const target = Math.max(now, earliest);
  if (target < nextTickAt) scheduleTick(target - now);
};

// 틱 루프: 정해진 박자(nextDueAt)에 한 틱씩 소비하며 setTimeout 재귀로 반복 (앞당겨 실행해도 박자는 유지돼 평균 속도 불변)
const tick = () => {
  const alive = step();
  const cleared = snake.length === boardSize * boardSize;
  if (alive && !cleared) spawnTimeFoods();
  draw();
  updateHud();
  if (!alive || cleared) {
    endGame(cleared);
    return;
  }
  const now = Date.now();
  nextDueAt += currentTickMs;
  if (nextDueAt <= now) nextDueAt = now + currentTickMs; // 탭 지연 등으로 박자를 놓쳤으면 현재 기준으로 재정렬
  scheduleTick(nextDueAt - now);
};

// 난이도를 적용한다 (보드 크기, 캔버스, 해당 난이도 최고 점수)
const applyLevel = (key) => {
  level = key;
  config = DIFFICULTY[key];
  boardSize = config.boardSize;
  setupCanvas();
  bestScore = loadBestScore(key);
};

// 선택한 난이도로 모든 상태를 초기화하고 즉시 새 게임을 시작 (난이도 선택 / Retry 공통)
const startGame = (key) => {
  clearTimeout(tickTimer);
  applyLevel(key);
  snake = createSnake();
  appliedDir = INITIAL_DIR;
  dirQueue = [];
  score = 0;
  foodsEaten = 0;
  currentTickMs = config.tickMs;
  foods = [];
  timeFoods = [];
  nextTimeFoodAt = config.timeFoodIntervalMs;
  fillFoods();
  startTime = Date.now();
  endTime = startTime; // 첫 방향 입력 전까지 시간 정지
  state = 'waiting';
  overlayEl.style.display = 'none';
  draw();
  updateHud();
};

// 난이도 선택 화면을 보여준다 (고르면 해당 난이도로 게임 시작)
const showSelect = () => {
  state = 'select';
  showOverlay('SELECT', '', DIFFICULTY_ORDER.map(key => [DIFFICULTY[key].label, () => startGame(key)]));
};

// 시작 화면으로 복귀 (기본 보드를 배경으로 두고 난이도는 다시 선택)
const showStart = () => {
  clearTimeout(tickTimer);
  state = 'ready';
  applyLevel(DEFAULT_LEVEL);
  bestScore = null; // 난이도 선택 전이라 표시하지 않음
  snake = createSnake();
  foods = [];
  timeFoods = [];
  score = 0;
  startTime = Date.now();
  endTime = startTime;
  draw();
  updateHud();
  showOverlay('SNAKE', '', [['Play', showSelect]]);
};

let state = 'ready'; // ready | select | waiting | playing | over
let tickTimer = null;
let nextDueAt = 0; // 다음 이동이 원래 일어나야 할 박자 시각(ms)
let nextTickAt = 0; // 다음 틱이 예약된 시각(ms)
let score = 0;
let bestScore = null; // 현재 난이도의 최고 점수 (선택 전엔 null)
let foodsEaten = 0; // 먹은 먹이 개수 (속도 단계 계산용)
let currentTickMs = DIFFICULTY[DEFAULT_LEVEL].tickMs; // 현재 틱 간격(ms)
let timeFoods = []; // 보드에 놓인 시간 먹이 위치 목록
let nextTimeFoodAt = 0; // 다음 시간 먹이를 만들 경과시간(ms)
let startTime = Date.now();
let endTime = Date.now();
let foods = []; // 보드에 놓인 먹이 위치 목록
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const timeEl = document.getElementById('time');
const overlayEl = document.getElementById('overlay');
document.addEventListener('keydown', handleKey);
setInterval(updateHud, 250); // 틱 사이에도 시간 표시 갱신
showStart();
