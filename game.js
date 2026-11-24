const BOARD_SIZE = 20;
const CELL_SIZE = 24;
const TICK_MS = 150; // 시작 틱 간격 (최대 느린 속도)
const MIN_TICK_MS = 60; // 틱 간격 하한
const TICK_STEP_MS = 10; // 속도 단계마다 줄어드는 간격
const SCORE_PER_SPEED_STEP = 50; // 속도가 한 단계 빨라지는 점수 간격
const INITIAL_SNAKE = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
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
const SCORE_PER_FOOD = 10;
const BEST_SCORE_KEY = 'snakeBestScore';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let snake = INITIAL_SNAKE.map(c => ({ ...c }));
let appliedDir = INITIAL_DIR; // 직전 틱에 실제 적용된 방향
let pendingDir = INITIAL_DIR; // 다음 틱에 적용할 방향

// 캔버스 크기를 devicePixelRatio에 맞게 설정
const setupCanvas = () => {
  const size = BOARD_SIZE * CELL_SIZE;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

// 먹이와 뱀을 화면에 그린다
const draw = () => {
  ctx.clearRect(0, 0, BOARD_SIZE * CELL_SIZE, BOARD_SIZE * CELL_SIZE);
  if (food) {
    ctx.fillStyle = COLOR_FOOD;
    ctx.fillRect(food.x * CELL_SIZE + 3, food.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
  }
  snake.forEach((c, i) => {
    ctx.fillStyle = i === 0 ? COLOR_HEAD : COLOR_BODY;
    ctx.fillRect(c.x * CELL_SIZE + 1, c.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
  });
};

// 방향 입력을 받아 유효하면 pendingDir에 저장 (반대 방향은 무시)
const handleKey = (e) => {
  const dir = KEY_DIRS[e.code];
  if (!dir) return;
  e.preventDefault();
  if (state !== 'playing') return;
  const isOpposite = dir.x === -appliedDir.x && dir.y === -appliedDir.y;
  if (!isOpposite) pendingDir = dir;
};

// 뱀이 차지하지 않은 빈 칸 중 무작위 위치를 반환 (빈 칸이 없으면 null)
const spawnFood = () => {
  const empty = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (!snake.some(c => c.x === x && c.y === y)) empty.push({ x, y });
    }
  }
  return empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
};

// 새 머리 위치가 벽이거나 몸통이면 true (먹지 않는 틱엔 비워지는 꼬리 칸은 제외)
const isCollision = (newHead, eating) => {
  if (newHead.x < 0 || newHead.x >= BOARD_SIZE || newHead.y < 0 || newHead.y >= BOARD_SIZE) return true;
  const body = eating ? snake : snake.slice(0, -1);
  return body.some(c => c.x === newHead.x && c.y === newHead.y);
};

// 한 틱: 방향 확정 후 충돌이면 false, 아니면 이동(먹으면 꼬리 유지·점수 +10·새 먹이)하고 true
const step = () => {
  appliedDir = pendingDir;
  const head = snake[0];
  const newHead = { x: head.x + appliedDir.x, y: head.y + appliedDir.y };
  const eating = !!food && newHead.x === food.x && newHead.y === food.y;
  if (isCollision(newHead, eating)) return false;
  snake.unshift(newHead);
  if (eating) {
    score += SCORE_PER_FOOD;
    food = spawnFood();
  } else {
    snake.pop();
  }
  return true;
};

// localStorage에서 최고 점수를 읽는다 (접근 실패나 잘못된 값이면 0)
const loadBestScore = () => {
  try {
    const value = Number(localStorage.getItem(BEST_SCORE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (e) {
    return 0;
  }
};

// 최고 점수를 localStorage에 저장 (접근 실패는 무시)
const saveBestScore = (value) => {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch (e) {
    // 저장소 접근이 막혀도 게임은 계속 동작
  }
};

// 점수·최고 점수·경과시간(mm:ss)을 화면에 갱신
const updateHud = () => {
  const sec = Math.floor(((endTime ?? Date.now()) - startTime) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  scoreEl.textContent = score;
  bestEl.textContent = bestScore;
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
    [['Retry', startGame], ['Exit', showStart]]);
};

// 현재 점수에 맞는 틱 간격(ms)을 계산 (50점마다 10ms 감소, 60ms 하한)
const getTickMs = () =>
  Math.max(MIN_TICK_MS, TICK_MS - TICK_STEP_MS * Math.floor(score / SCORE_PER_SPEED_STEP));

// 틱 루프: setTimeout 재귀로 반복 (충돌하거나 칸이 가득 차면 종료)
const tick = () => {
  const alive = step();
  draw();
  updateHud();
  if (alive && food) tickTimer = setTimeout(tick, getTickMs());
  else endGame(alive);
};

// 모든 상태를 초기화하고 즉시 새 게임을 시작 (Play / Retry 공통)
const startGame = () => {
  clearTimeout(tickTimer);
  snake = INITIAL_SNAKE.map(c => ({ ...c }));
  appliedDir = INITIAL_DIR;
  pendingDir = INITIAL_DIR;
  score = 0;
  food = spawnFood();
  startTime = Date.now();
  endTime = null;
  state = 'playing';
  overlayEl.style.display = 'none';
  draw();
  updateHud();
  tickTimer = setTimeout(tick, TICK_MS);
};

// 시작 화면으로 복귀 (최고 점수는 유지)
const showStart = () => {
  clearTimeout(tickTimer);
  state = 'ready';
  snake = INITIAL_SNAKE.map(c => ({ ...c }));
  food = null;
  score = 0;
  startTime = Date.now();
  endTime = startTime;
  draw();
  updateHud();
  showOverlay('SNAKE', '', [['Play', startGame]]);
};

let state = 'ready'; // ready | playing | over
let tickTimer = null;
let score = 0;
let bestScore = loadBestScore(); // localStorage에서 복원
let startTime = Date.now();
let endTime = Date.now();
let food = null;
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const timeEl = document.getElementById('time');
const overlayEl = document.getElementById('overlay');
document.addEventListener('keydown', handleKey);
setupCanvas();
setInterval(updateHud, 250); // 틱 사이에도 시간 표시 갱신
showStart();
