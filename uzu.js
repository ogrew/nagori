// Nagori / Uzu：辞書の項目（【見出し（よみ）】語釈。）を渦巻きに沿って並べ、見出しをよみのしりとりでつなぐ。
// 渦はアルキメデスの渦巻き r = r0 + bφ（時計回り、中心から外へ）。半周ごと（φ = kπ、横の中心線）に語がちょうど終わるよう、
// 半周に入る字数に合わせて語を選ぶ。内側は1語、外側（70字を超える半周）は複数の語で埋める。
// 字の間隔を半周ごとにわずかに伸び縮みさせて、どの半周も中心線の手前でぴったり止める → 中心を横切る区切りが見える。
// 字は横書きの向きのまま、進む方向（接線）に合わせて1字ずつ回す（字の頭は外側）。
// 書くにつれて渦全体が縮み、字が MIN_SIZE より小さくなったらフェードして中心からやり直す。
// 座標は「字1つ＝1」の世界座標で持ち、描くときに縮尺 scale（px/字）をかける。
const $ = (id) => document.getElementById(id);

// ---------- 設定 ----------
const params = {};
for (const id of ["lineSpace", "split", "size", "minSize", "margin", "speed"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
// 渦の形（巻きの間隔・区切りの幅）を変えたら最初から（途中で変えると渦がつながらない）
for (const id of ["lineSpace", "split"]) $(id).addEventListener("change", () => reset());
params.headEm = $("headEm").checked;
$("headEm").addEventListener("change", (e) => (params.headEm = e.target.checked));
params.bracket = $("bracket").value;
$("bracket").addEventListener("change", (e) => (params.bracket = e.target.value));
params.guide = $("band").checked;
$("band").addEventListener("change", (e) => (params.guide = e.target.checked));
$("mode").addEventListener("change", (e) => (location.href = e.target.value));
for (const id of ["inkColor", "bgColor"]) {
  const el = $(id);
  try { const saved = localStorage.getItem(`shapetext.${id}`); if (saved) el.value = saved; } catch {}
  const sync = () => {
    params[id] = el.value;
    try { localStorage.setItem(`shapetext.${id}`, el.value); } catch {}
    $("stage").style.background = params.bgColor;
  };
  el.addEventListener("input", sync); sync();
}
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}
const setStatus = (msg) => ($("status").textContent = msg);

// 設定画面：H キー・ボタンで開閉、Esc・背景クリックで閉じる。開いているあいだは止める
let running = false, resumeOnClose = false;
const panelOpen = () => !$("panel").classList.contains("hidden");
function showPanel(on) {
  if (on === panelOpen()) return;
  $("panel").classList.toggle("hidden", !on);
  $("backdrop").classList.toggle("hidden", !on);
  if (on) { resumeOnClose = running; running = false; }
  else {
    if (document.activeElement && $("panel").contains(document.activeElement)) document.activeElement.blur();
    if (resumeOnClose) running = true;
  }
}
$("toggle").addEventListener("click", () => showPanel(!panelOpen()));
$("backdrop").addEventListener("click", () => showPanel(false));
$("reset").addEventListener("click", () => reset());
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
  const t = ev.target;
  if (ev.key === "Escape" && panelOpen()) { showPanel(false); return; }
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
  const k = ev.key.toLowerCase();
  if (k === "h") { ev.preventDefault(); showPanel(!panelOpen()); }
  else if (ev.code === "Space" && !(t.tagName === "INPUT" && t.type === "checkbox")) { ev.preventDefault(); if (E.length) running = !running; }
  else if (k === "s") { ev.preventDefault(); if (E.length) saveScreenshot(); }
});

// ---------- 辞書 ----------
let E = [];                       // [{word, head, tail, text, len, headLen, headPos, tailPos}]
const inv = new Map();            // "頭のかな|字数" → 項目の番号
const byLen = new Map();          // 字数 → 項目の番号
const headTotal = new Map();      // 頭のかな → 項目の数（尻のかなの詰まりにくさ）
const key = (h, n) => `${h}|${n}`;
function kanaPositions(text) {
  const close = text.indexOf("】"), open = text.indexOf("（");
  const [s, e] = open > 0 && open < close ? [open + 1, text.indexOf("）")] : [1, close];
  let t = e - 1;
  while (t > s && text[t] === "ー") t--;
  return { headPos: s, tailPos: t };
}
async function loadDict() {
  setStatus("LOADING…");
  const d = await (await fetch("dict.json?v=1cef2bca")).json();
  // 試作では「ん」で終わる語は使わない（渦の上で1語ぶん空ける処理はまだ無い）
  E = d.entries.filter((x) => x[2] !== "ん").map(([word, head, tail, text]) =>
    ({ word, head, tail, text, len: text.length, headLen: text.indexOf("】") + 1, ...kanaPositions(text) }));
  E.forEach((e, i) => {
    const k = key(e.head, e.len);
    if (!inv.has(k)) inv.set(k, []);
    inv.get(k).push(i);
    if (!byLen.has(e.len)) byLen.set(e.len, []);
    byLen.get(e.len).push(i);
    headTotal.set(e.head, (headTotal.get(e.head) || 0) + 1);
  });
  $("credit").innerHTML = `${d.source}。<a href="https://ja.wiktionary.org/" target="_blank" rel="noopener">ja.wiktionary.org</a> / <a href="https://kaikki.org/" target="_blank" rel="noopener">kaikki.org</a>`;
}

// ---------- 渦の形（世界座標、字1つ＝1） ----------
// r = r0 + bφ。巻きの間隔（1周で増える半径）＝ LINE_SPACE、b ＝ LINE_SPACE / 2π。
// 弧の長さ S(φ) は閉じた式で求め、弧の長さ → φ はニュートン法で逆に解く
let geo = null;
function makeGeo() {
  const b = params.lineSpace / (2 * Math.PI);
  // 最初の半周に約12字が入るように、最初の半径を決める（それより内側は項目が入らないので空ける）
  const r0 = Math.max(1.5, (12 + params.split) / Math.PI - (b * Math.PI) / 2);
  const F = (r) => (r * Math.hypot(r, b) + b * b * Math.log(r + Math.hypot(r, b))) / (2 * b);
  const S = (phi) => F(r0 + b * phi) - F(r0);
  const phiAt = (s, guess) => {
    let phi = guess;
    for (let n = 0; n < 8; n++) phi -= (S(phi) - s) / Math.hypot(r0 + b * phi, b);
    return phi;
  };
  return { b, r0, split: params.split, S, phiAt };
}
// φ での位置と進む向き（時計回り：画面の y は下向きなので、φ が増えると時計回り）
function pointAt(phi) {
  const r = geo.r0 + geo.b * phi;
  const c = Math.cos(phi), s = Math.sin(phi);
  return { x: r * c, y: r * s, r, ang: Math.atan2(geo.b * s + r * c, geo.b * c - r * s) };
}

// ---------- 半周に語を詰める（しりとり） ----------
// 半周 k（φ = kπ〜(k+1)π）の弧の長さから区切りの幅を引いたものが、字を並べられる長さ A。
// 字の間隔を 0.9〜1.15 字のあいだで伸び縮みさせてよいので、語の字数の合計 N は ceil(A/1.15)〜floor(A/0.9) ならよい（A に近いほどよい）
const SP_MIN = 0.9, SP_MAX = 1.15, MIN_PIECE = 12; // 途中の語のあとに残す字数の下限（半端な字数を残さない）
const state = { k: 0, chars: [], words: [], shown: 0, used: new Set(), prev: null, restarts: 0, reused: 0, exact: 0, halfTurns: 0 };
// chars：{x, y, ang, w（何番目の語か）, j（語の中の何字目か）}、words：{i, start（chars の何番目から）, chained, pulseAt}

const candidates = (head, len, reuse) =>
  (inv.get(key(head, len)) || []).filter((i) => reuse || !state.used.has(i));
// 詰まりにくい尻のかな（そのかなで始まる語が多い）を優先し、上位からランダム
function choose(list) {
  if (!list.length) return -1;
  const scored = list.map((i) => [i, headTotal.get(E[i].tail) || 0]).sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, Math.max(5, Math.ceil(scored.length / 3)));
  return top[Math.floor(Math.random() * top.length)][0];
}
function pickChained(head, lens, reuse) {
  for (const l of lens) { const i = choose(candidates(head, l, reuse)); if (i >= 0) return i; }
  return -1;
}
function pickFresh(lens) {
  for (const l of lens) {
    const pool = (byLen.get(l) || []).filter((i) => !state.used.has(i));
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return -1;
}
// target に近い順に、[lo, hi] の字数を並べる
function lensNear(target, lo, hi) {
  const out = [];
  for (let d = 0; d <= hi - lo + Math.abs(target); d++) {
    for (const l of d ? [target + d, target - d] : [target]) if (l >= lo && l <= hi && l >= 6 && !out.includes(l)) out.push(l);
    if (out.length >= hi - lo + 1) break;
  }
  return out;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function planHalfTurn() {
  const k = state.k++;
  const s0 = geo.S(k * Math.PI), s1 = geo.S((k + 1) * Math.PI);
  const A = s1 - s0 - geo.split;
  const nMin = Math.ceil(A / SP_MAX), nMax = Math.floor(A / SP_MIN), n0 = Math.round(A);
  const picked = []; // {i, chained}
  let sum = 0;
  for (let guard = 0; guard < 40; guard++) {
    const rem0 = n0 - sum, remLo = nMin - sum, remHi = nMax - sum;
    const fin = lensNear(rem0, Math.max(6, remLo), remHi);
    const prev = state.prev;
    // 1) この語で半周を終えられるか
    let i = prev ? pickChained(prev.tail, fin, false) : pickFresh(fin);
    if (i >= 0) { push(i, !!prev); state.exact += sum === n0 ? 1 : 0; break; }
    // 2) 途中の語（あとに MIN_PIECE 字以上を残す）
    if (rem0 - MIN_PIECE >= 8) {
      const mid = shuffle(Array.from({ length: Math.min(50, rem0 - MIN_PIECE) - 7 }, (_, j) => j + 8));
      i = prev ? pickChained(prev.tail, mid, false) : pickFresh(mid);
      if (i >= 0) { push(i, !!prev); continue; }
    }
    // 3) 使った語も許して終える
    if (prev) {
      i = pickChained(prev.tail, fin, true);
      if (i >= 0) { push(i, true); state.reused++; break; }
    }
    // 4) しりとりを切って、ランダムな語から（次の周回で）やり直す
    state.prev = null; state.restarts++;
  }
  function push(i, chained) {
    picked.push({ i, chained });
    state.used.add(i);
    if (state.used.size > E.length * 0.8) state.used.clear();
    state.prev = E[i];
    sum += E[i].len;
  }
  if (!sum) return; // ありえないが念のため（何も置けない半周は空ける）
  // 字の位置：半周の始めから区切りの半分あけ、間隔 sp で並べる
  const sp = A / sum;
  let s = s0 + geo.split / 2 + sp / 2, phi = k * Math.PI;
  for (const p of picked) {
    const w = state.words.length;
    state.words.push({ i: p.i, start: state.chars.length, chained: p.chained, pulseAt: null });
    for (let j = 0; j < E[p.i].len; j++, s += sp) {
      phi = geo.phiAt(s, phi);
      const pt = pointAt(phi);
      state.chars.push({ x: pt.x, y: pt.y, r: pt.r, ang: pt.ang, w, j });
    }
  }
  state.halfTurns++;
}

// ---------- 開始・リセット ----------
let scale = 18, fadeAt = null, flowAt = 0;
function reset() {
  geo = makeGeo();
  Object.assign(state, { k: 0, chars: [], words: [], shown: 0, used: new Set(), prev: null, restarts: 0, reused: 0, exact: 0, halfTurns: 0 });
  scale = params.size;
  fadeAt = null;
  bake = null; nextBake = null;
}

// ---------- 表示 ----------
// 速さのため、古い字（最新の LIVE 字より前）は「焼き付け」用の別キャンバスに一度だけ描き、毎フレームはその画像を
// いまの縮尺で貼るだけにする。最新の LIVE 字だけを1字ずつ描く。字が増えても1フレームの手間はほぼ一定。
// 渦が縮んで画像が焼いたときの75%より小さくなったら、いまの縮尺で焼き直す（数フレームに分けて描き、終わったら差し替える）。
const canvas = $("c"), ctx = canvas.getContext("2d");
let last = performance.now(), statusAt = 0, drawMs = 0;
const drawHist = []; // 直近60フレームの描く時間（ms）
const PULSE_MS = 600, FADE_MS = 1800;
const LIVE = 400;          // 1字ずつ描く最新の字の数（強調・カーソルはこの範囲で起きる）
const REBAKE_AT = 0.75;    // 焼いたときの縮尺のこの割合まで縮んだら焼き直す
const BAKE_PER_FRAME = 250; // 焼き付けに1フレームで描く字の数（1字あたり数十µs。多いと焼き直しのあいだ引っかかる）
const pulseAmount = (at, now) => {
  if (at === null || now - at >= PULSE_MS) return 0;
  const t = (now - at) / PULSE_MS;
  return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
};

function update(now, dt, W, H) {
  if (!running) return;
  while (state.chars.length - state.shown < 400) planHalfTurn();
  state.shown = Math.min(state.chars.length, state.shown + params.speed * dt);
  // 書いている字が、余白の内側の円にちょうど収まるように縮める（最初は FONT_SIZE のまま）
  const R = Math.min(W, H) / 2 - Math.round(Math.min(W, H) * params.margin / 100);
  const head = state.chars[Math.min(state.chars.length - 1, Math.floor(state.shown))];
  const want = Math.min(params.size, R / (head.r + 1));
  scale += (want - scale) * Math.min(1, dt * 2);
  if (fadeAt === null && scale < params.minSize) fadeAt = now;
  if (fadeAt !== null && now - fadeAt > FADE_MS) reset();
  if (now - statusAt > 500) {
    statusAt = now;
    setStatus(`TURNS ${(state.halfTurns / 2).toFixed(1)}  WORDS ${state.words.length}  CHARS ${Math.floor(state.shown)}\nSIZE ${scale.toFixed(1)}px  DRAW ${drawMs.toFixed(1)}ms (MAX ${Math.max(0, ...drawHist).toFixed(0)})\nEXACT ${Math.round((100 * state.exact) / (state.halfTurns || 1))}%  REUSE ${state.reused}  RESTART ${state.restarts}`);
  }
}

// 字の見た目（色・かっこ）
const glyphOf = (ch, e) => (ch.j === 0 ? params.bracket[0] : ch.j === e.headLen - 1 ? params.bracket[1] : e.text[ch.j]);
// chars[from, to) を c に描く。世界座標の原点を (ox, oy)（css px）に、字1つを cell px にして。強調はここでは描かない
function drawChars(c, from, to, ox, oy, cell, dpr, alpha) {
  const ink = params.inkColor, muted = mix(ink, params.bgColor, 0.55);
  c.font = `${cell * 0.9}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.globalAlpha = alpha;
  const small = cell < 3; // 小さすぎる字は点で描く（速さのため）
  for (let q = from; q < to; q++) {
    const ch = state.chars[q], e = E[state.words[ch.w].i];
    const X = ox + ch.x * cell, Y = oy + ch.y * cell;
    c.fillStyle = params.headEm && ch.j >= e.headLen ? muted : ink;
    if (small) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalAlpha = alpha * 0.5;
      c.fillRect(X - cell * 0.3, Y - cell * 0.3, cell * 0.6, cell * 0.6);
      c.globalAlpha = alpha;
      continue;
    }
    const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
    c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * X, dpr * Y);
    c.fillText(glyphOf(ch, e), 0, 0);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
}

// 焼き付け：{canvas, ctx, scale（焼いたときの px/字）, half（キャンバスの半径 css px）, R（作ったときの画面の半径）, upto（焼いた字の数）, dpr}
let bake = null, nextBake = null, bakeKey = "";
function newBake(cellScale, R, dpr) {
  const half = Math.ceil((R / REBAKE_AT) * 1.1 + cellScale * 2); // この先 REBAKE_AT まで縮むあいだに増える外周も入る大きさ
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(2 * half * dpr);
  return { canvas: cv, ctx: cv.getContext("2d"), scale: cellScale, half, R, upto: 0, dpr };
}
// 焼き付けを進める。どの描き足しも1フレームに BAKE_PER_FRAME 字まで（一度に全部描くと止まって見える）
function bakeStep(b, target) {
  if (b.upto >= target) return;
  const to = Math.min(target, b.upto + BAKE_PER_FRAME);
  drawChars(b.ctx, b.upto, to, b.half, b.half, b.scale, b.dpr, 1);
  b.upto = to;
}
function updateBake(W, H, dpr) {
  // 色・かっこ・見出しの濃さ・渦の形が変わったら作り直す（窓の大きさは含めない：大きさが変わるたびに作り直すと重い）
  const key = [params.inkColor, params.bgColor, params.bracket, params.headEm, dpr, geo && geo.b].join("|");
  const R = Math.min(W, H) / 2;
  const target = Math.max(0, Math.floor(state.shown) - LIVE);
  if (!bake || key !== bakeKey || target < bake.upto) { bakeKey = key; bake = newBake(scale, R, dpr); nextBake = null; }
  bakeStep(bake, target);
  // 縮んで画像が粗くなる手前、または窓が焼いたときより大きくなったら、いまの縮尺で焼き直す（できるまでは今の画像を使う）
  if (!nextBake && (scale < bake.scale * REBAKE_AT || R > bake.R * 1.05)) nextBake = newBake(scale, R, dpr);
  if (nextBake) {
    bakeStep(nextBake, target);
    if (nextBake.upto >= target) { bake = nextBake; nextBake = null; }
  }
}

// しりとりの強調を上から重ねる（白黒反転）。焼き付けた字にも効く
function drawPulses(c, cx, cy, cell, dpr, alpha, now) {
  const ink = params.inkColor, bg = params.bgColor;
  const box = (q, amt) => {
    const ch = state.chars[q], e = E[state.words[ch.w].i];
    const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
    c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (cx + ch.x * cell), dpr * (cy + ch.y * cell));
    c.globalAlpha = alpha * amt;
    c.fillStyle = ink; c.fillRect(-cell * 0.55, -cell * 0.5, cell * 1.1, cell);
    c.fillStyle = bg; c.fillText(glyphOf(ch, e), 0, 0);
  };
  c.font = `${cell * 0.9}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`;
  c.textAlign = "center"; c.textBaseline = "middle";
  for (let w = state.words.length - 1; w >= 1; w--) {
    const wd = state.words[w];
    if (wd.start > state.shown) continue;
    if (wd.pulseAt !== null && now - wd.pulseAt > PULSE_MS * 2) break; // 古い語はもう強調していない
    const amt = pulseAmount(wd.pulseAt, now);
    if (!amt || !wd.chained) continue;
    const e = E[wd.i], pw = state.words[w - 1], pe = E[pw.i];
    box(wd.start + e.headPos, amt);
    box(pw.start + pe.tailPos, amt);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
}

// 描く。live=false（スクリーンショット）はフェード・カーソル・強調なしで、全部の字をその場で描く（焼き付けを使わない）
function draw(c, W, H, now, live, dpr) {
  const ink = params.inkColor, bg = params.bgColor;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const alpha = live && fadeAt !== null ? Math.max(0, 1 - (now - fadeAt) / FADE_MS) : 1;
  const cell = scale;

  if (params.guide && state.k > 0) {
    c.globalAlpha = 0.25 * alpha; c.strokeStyle = ink; c.lineWidth = 1;
    c.beginPath();
    for (let phi = 0; phi <= state.k * Math.PI; phi += 0.05) {
      const p = pointAt(phi);
      phi ? c.lineTo(cx + p.x * cell, cy + p.y * cell) : c.moveTo(cx + p.x * cell, cy + p.y * cell);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  const n = Math.floor(state.shown);
  if (!live) { drawChars(c, 0, n, cx, cy, cell, dpr, 1); return; }

  // 頭のかなが書かれた語に、強調の始まりの時刻を付ける
  for (let w = state.words.length - 1; w >= 0; w--) {
    const wd = state.words[w];
    if (wd.start + E[wd.i].len < n - LIVE) break;
    if (wd.chained && wd.pulseAt === null && n > wd.start + E[wd.i].headPos) wd.pulseAt = now;
  }
  // 焼き付けた画像をいまの縮尺で貼り、最新の字だけ1字ずつ描く
  updateBake(W, H, dpr);
  const k = cell / bake.scale;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = alpha;
  c.drawImage(bake.canvas, (cx - bake.half * k) * dpr, (cy - bake.half * k) * dpr, 2 * bake.half * k * dpr, 2 * bake.half * k * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 最新の LIVE 字だけ1字ずつ描く。色を変えた直後などで焼き付けが追いついていない古い字は、焼けるまで一時的に出ない（重くしないため）
  drawChars(c, Math.max(bake.upto, n - LIVE), n, cx, cy, cell, dpr, alpha);
  if (cell >= 3) drawPulses(c, cx, cy, cell, dpr, alpha, now);

  // カーソル（点滅）
  if (running && n < state.chars.length && Math.floor(now / 500) % 2 === 0) {
    const ch = state.chars[n];
    const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
    c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (cx + ch.x * cell), dpr * (cy + ch.y * cell));
    c.globalAlpha = 0.35 * alpha; c.fillStyle = ink;
    c.fillRect(-cell * 0.45, -cell * 0.45, cell * 0.9, cell * 0.9);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  update(now, dt, W, H);
  const t0 = performance.now();
  draw(ctx, W, H, now, true, dpr);
  drawHist.push(performance.now() - t0);
  if (drawHist.length > 60) drawHist.shift();
  drawMs = drawHist.reduce((a, b) => a + b, 0) / drawHist.length; // 描くのにかかった時間（直近60フレームの平均）
  requestAnimationFrame(frame);
}

// ---------- スクリーンショット（S キー） ----------
function saveScreenshot() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const off = document.createElement("canvas");
  off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
  draw(off.getContext("2d"), W, H, performance.now(), false, dpr);
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  const name = `nagori-uzu-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
  off.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

loadDict().then(() => {
  reset();
  running = true;
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}`));
