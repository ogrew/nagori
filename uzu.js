// Nagori / Uzu（渦）：辞書の項目（【見出し（よみ）】語釈。）を渦巻きに沿って並べ、見出しをよみのしりとりでつなぐ。
// 渦はアルキメデスの渦巻き r = r0 + bφ。半周ごと（φ = kπ、横の中心線）に語がちょうど終わるよう、半周に入る字数に合わせて語を選ぶ。
// 字の大きさは FONT_SIZE で固定。画面（余白の内側の円）に収まる半周までが1往復の範囲。
// 中心から外周へ（時計回り）書き、外周まで来たら同じ半周を逆にたどって中心へ戻る（反時計回り）。これを往復する（Kuruwa と同じ）。
// 往復の折り返しでは端の半周をもう一度書かない（外へ：0..n-1、内へ：n-2..0、外へ：1..n-1 …）ので、しりとりは切れずにつながる。
// 画面は消さない。新しい周回の字は、前の周回の字を半周ごとに上書きする（書いている半周では、カーソルより先に前の字が残る）。
// 前の周回の字は OLD_ALPHA の濃さで描く → 書き換わる場所が内↔外を往復して見える。
// 字の間隔を半周ごとに 0.9〜1.15 字で伸び縮みさせ、どの半周も中心線の手前でぴったり止める → 中心を横切る区切りが見える。
// 字は進む方向（接線）に合わせて1字ずつ回す（外へ向かう周回は字の頭が外側、内へ向かう周回は内側）。
// 座標は「字1つ＝1」の世界座標（画面の中心が原点）で持ち、描くときに cell（px/字）をかける。
const $ = (id) => document.getElementById(id);

// ---------- 字体 ----------
// 作品の字は Web フォントの Noto Serif JP（Google Fonts、HTML の <link> で読み込む）で、どの端末でも同じ字形にする。
// Google Fonts は字の範囲ごとに小さなファイルに分かれていて、使う字のファイルだけが読み込まれる。canvas では読み込みが
// 間に合わない字は別の字体で描かれ、焼き付けた字はそのまま残るので、始める前に辞書で使う字（約3千字）をまとめて読み込んでおく。
async function loadFont(texts) {
  if (!document.fonts) return;
  const chars = [...new Set(texts.join("") + "【】《》「」『』（）、。ー〜")].join("");
  const timeout = new Promise((r) => setTimeout(r, 15000)); // 遅い回線では待ちすぎず始める
  await Promise.race([document.fonts.load(`16px "Noto Serif JP"`, chars), timeout]).catch(() => {});
}

// ---------- 設定 ----------
const params = {};
for (const id of ["lineSpace", "split", "size", "margin", "speed", "oldAlpha"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
// 形（巻きの間隔・区切り・字の大きさ・余白）を変えたら最初から
for (const id of ["lineSpace", "split", "size", "margin"]) $(id).addEventListener("change", () => reset());
params.headEm = $("headEm").checked;
$("headEm").addEventListener("change", (e) => (params.headEm = e.target.checked));
params.bracket = $("bracket").value;
$("bracket").addEventListener("change", (e) => (params.bracket = e.target.value));
params.guide = $("band").checked;
$("band").addEventListener("change", (e) => (params.guide = e.target.checked));
// しりとり線（SHIRITORI_LINE、既定オン）。線の色（LINE_COLOR）はオンのときだけ変えられる
params.link = $("link").checked;
const syncLink = () => {
  params.link = $("link").checked;
  $("lineColor").disabled = !params.link;
  $("lineColor").closest(".r").classList.toggle("off", !params.link);
};
$("link").addEventListener("change", syncLink);
$("mode").addEventListener("change", (e) => (location.href = e.target.value));
for (const id of ["inkColor", "bgColor", "lineColor"]) {
  const el = $(id);
  try { const saved = localStorage.getItem(`shapetext.${id}`); if (saved) el.value = saved; } catch {}
  const sync = () => {
    params[id] = el.value;
    try { localStorage.setItem(`shapetext.${id}`, el.value); } catch {}
    $("stage").style.background = params.bgColor;
  };
  el.addEventListener("input", sync); sync();
}
syncLink();
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
  // 「ん」で終わる語は使わない（Uzu と同じ）
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
  setStatus("LOADING FONT…");
  await loadFont(E.map((e) => e.text));
  setStatus("");
}

// ---------- 渦の形 ----------
// r = r0 + bφ（画面の y は下向きなので、φ が増えると時計回り）。巻きの間隔（1周で増える半径）＝ LINE_SPACE、b ＝ LINE_SPACE / 2π。
// 弧の長さ S(φ) は閉じた式で求め、弧の長さ → φ はニュートン法で逆に解く。
// 半周 k は φ = kπ〜(k+1)π。字（外側の縁）が余白の内側の円に収まる半周まで使う
let geo = null;
function makeGeo(W, H) {
  const m = Math.round(Math.min(W, H) * params.margin / 100);
  const cell = params.size;
  const Rmax = (Math.min(W, H) / 2 - m) / cell;
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
  const halves = [];
  for (let k = 0; k < 2000 && r0 + b * (k + 1) * Math.PI + 0.5 <= Rmax; k++) halves.push({ k, s0: S(k * Math.PI), s1: S((k + 1) * Math.PI) });
  return { W, H, cell, ox: W / 2, oy: H / 2, Rmax, b, r0, pitch: params.lineSpace, split: params.split, S, phiAt, halves };
}
// φ での位置と、φ が増える向きの接線の角度
function pointAt(phi) {
  const r = geo.r0 + geo.b * phi;
  const c = Math.cos(phi), s = Math.sin(phi);
  return { x: r * c, y: r * s, r, ang: Math.atan2(geo.b * s + r * c, geo.b * c - r * s) };
}
// 周回 r で書く半周の順番：外へ 0..n-1、内へ n-2..0、外へ 1..n-1、内へ n-2..0 …（折り返しの半周は続けて2回書かない）
function roundSeq(r, n) {
  if (n === 1) return [0];
  const out = [];
  if (r % 2 === 1) for (let i = n - 2; i >= 0; i--) out.push(i);
  else for (let i = r === 0 ? 0 : 1; i < n; i++) out.push(i);
  return out;
}

// ---------- 半周に語を詰める（しりとり） ----------
// 半周の弧の長さから区切りの幅を引いたものが、字を並べられる長さ A。字の間隔を SP_MIN〜SP_MAX で伸び縮みさせてよいので、
// 語の字数の合計 N は ceil(A/SP_MAX)〜floor(A/SP_MIN) ならよい（A に近いほどよい）
const SP_MIN = 0.9, SP_MAX = 1.15, MIN_PIECE = 12; // 途中の語のあとに残す字数の下限
// visit：半周を1回書くこと {bar（半周の番号）, round, rev, start, end（chars の通し番号）, words, chars, layer, entered, superseded, old}
// word：{i, e, visit, start, prev（前の語）, chained, pulseAt, path, linked（焼いた）}
// char：{x, y, r, phi, s（弧の長さ）, ang, wd, j}
const state = {};
function clearState() {
  Object.assign(state, {
    round: 0, seqPos: 0, curRound: 0,
    chars: [], cBase: 0,      // chars[q - cBase]。焼き付けが済んだ古い字は捨てる（半周ごとの visit.chars には残る）
    words: [], wBase: 0,
    visits: [], shown: 0, used: new Set(), prev: null,
    bars: 0, exact: 0, multi: 0, reused: 0, restarts: 0,
  });
}
const chAt = (q) => state.chars[q - state.cBase];
const total = () => state.cBase + state.chars.length;

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
function lensNear(target, lo, hi) {
  const out = [];
  for (let d = 0; d <= hi - lo + Math.abs(target); d++) {
    for (const l of d ? [target + d, target - d] : [target]) if (l >= lo && l <= hi && l >= 6 && !out.includes(l)) out.push(l);
    if (out.length >= hi - lo + 1) break;
  }
  return out;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function planVisit() {
  const n = geo.halves.length;
  let seq = roundSeq(state.round, n);
  if (state.seqPos >= seq.length) { state.round++; state.seqPos = 0; seq = roundSeq(state.round, n); }
  const bi = seq[state.seqPos++], hf = geo.halves[bi];
  const rev = state.round % 2 === 1 && n > 1;
  const A = hf.s1 - hf.s0 - geo.split;
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
    // 4) しりとりを切って、ランダムな語から
    state.prev = null; state.restarts++;
  }
  function push(i, chained) {
    picked.push({ i, chained });
    state.used.add(i);
    if (state.used.size > E.length * 0.8) state.used.clear();
    state.prev = E[i];
    sum += E[i].len;
  }
  if (picked.length > 1) state.multi++;
  state.bars++;
  // 字の位置：半周の始めから区切りの半分あけ、間隔 sp で並べる。内へ向かう周回は半周の終わりから逆向きに
  const visit = { bar: bi, round: state.round, rev, s0: hf.s0, s1: hf.s1, start: total(), end: 0, words: [], chars: [],
    layer: state.round % 2, entered: false, superseded: false, old: null };
  const sp = sum ? A / sum : 1, dir = rev ? -1 : 1;
  let s = rev ? hf.s1 - geo.split / 2 - sp / 2 : hf.s0 + geo.split / 2 + sp / 2;
  let phi = (bi + (rev ? 1 : 0)) * Math.PI;
  for (const p of picked) {
    const prevWord = state.words.length ? state.words[state.words.length - 1] : null;
    const wd = { i: p.i, e: E[p.i], visit, start: total(), prev: prevWord, chained: p.chained && !!prevWord, pulseAt: null, path: undefined, linked: false };
    if (prevWord) prevWord.next = wd;
    state.words.push(wd);
    visit.words.push(wd);
    for (let j = 0; j < wd.e.len; j++, s += dir * sp) {
      phi = geo.phiAt(s, phi);
      const pt = pointAt(phi);
      const ch = { x: pt.x, y: pt.y, r: pt.r, phi, s, ang: pt.ang + (rev ? Math.PI : 0), wd, j };
      state.chars.push(ch);
      visit.chars.push(ch);
    }
  }
  visit.end = total();
  state.visits.push(visit);
}

// ---------- 開始・リセット ----------
const barCur = [];  // 半周ごとに、いま見えている visit
let layers = null;   // 周回の偶奇ごとの透明なキャンバス（焼き付け）。いまの周回は濃く、前の周回は OLD_ALPHA で貼る
let bakeUpto = 0, linkUpto = 0, styleKey = "";
function newLayer() {
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.width = Math.round(geo.W * dpr); cv.height = Math.round(geo.H * dpr);
  return { canvas: cv, ctx: cv.getContext("2d"), dpr };
}
function reset() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  geo = makeGeo(W, H);
  clearState();
  barCur.length = 0;
  layers = [newLayer(), newLayer()];
  bakeUpto = 0; linkUpto = 0; styleKey = styleOf();
  fadeAt = null;
}
let fadeAt = null;

// ---------- 半周に入る（上書きの始まり）・周回の始まり ----------
// 半周 k の字の帯（中心線から ±0.56 字。すき間のしりとり線には届かない）
function bandPath(c, k, ox, oy, cell, h = 0.56) {
  const N = 64;
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const phi = (k + i / N) * Math.PI, r = geo.r0 + geo.b * phi + h;
    c.lineTo(ox + r * Math.cos(phi) * cell, oy + r * Math.sin(phi) * cell);
  }
  for (let i = N; i >= 0; i--) {
    const phi = (k + i / N) * Math.PI, r = Math.max(0, geo.r0 + geo.b * phi - h);
    c.lineTo(ox + r * Math.cos(phi) * cell, oy + r * Math.sin(phi) * cell);
  }
  c.closePath();
}
function eraseBand(L, k) {
  const c = L.ctx;
  c.save();
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000";
  bandPath(c, k, geo.ox, geo.oy, geo.cell);
  c.fill();
  c.restore();
}
// しりとり線を消す（同じ道を太めの線で抜く）
function eraseLink(wd) {
  if (!wd || !wd.linked || !wd.path) return;
  const L = layers[wd.visit.layer];
  L.ctx.save();
  L.ctx.globalCompositeOperation = "destination-out";
  strokePath(L.ctx, wd.path, geo.ox, geo.oy, geo.cell, L.dpr, 1, 1, "#000", 2);
  L.ctx.restore();
  wd.linked = false;
}
// visit の字と線を、いまの層から消す
function eraseVisit(v) {
  eraseBand(layers[v.layer], v.bar);
  for (const wd of v.words) eraseLink(wd);
  // この半周の最後の語から次の半周へ伸びる線（頭のある次の語の持ち物）も消す
  const lastW = v.words[v.words.length - 1];
  eraseLink(lastW && lastW.next);
}
// visit の焼き付け済みの字と線を、その層に描く
function drawVisitBaked(v) {
  const L = layers[v.layer];
  for (const ch of v.chars) if (ch.wd.start + ch.j < bakeUpto) drawChar(L.ctx, ch, geo.ox, geo.oy, geo.cell, L.dpr);
  if (params.link) for (const wd of v.words) if (wd.linkedOnce && linkOK(wd)) { strokePath(L.ctx, pathOf(wd), geo.ox, geo.oy, geo.cell, L.dpr, 1, 1); wd.linked = true; }
}
function enterVisit(v) {
  v.entered = true;
  if (v.round > state.curRound) startRound(v.round);
  const old = barCur[v.bar];
  if (old) { old.superseded = true; eraseVisit(old); v.old = old; }
  barCur[v.bar] = v;
}
function startRound(r) {
  state.curRound = r;
  // 2つ前の周回の字がまだ残っている半周（前の周回が書かなかった折り返しの半周）は、前の周回の層へ移す（薄く見せる）
  for (const v of barCur) {
    if (v && v.round <= r - 2 && v.layer === r % 2) {
      eraseVisit(v);
      v.layer = (r + 1) % 2;
      drawVisitBaked(v);
    }
  }
}

// ---------- 進める ----------
const LIVE = 400;            // 1字ずつ描く最新の字の数
const BAKE_PER_FRAME = 300;  // 焼き付けに1フレームで描く字の数
const PULSE_MS = 600, LINK_MS = 450;
const pulseAmount = (at, now) => {
  if (at === null || now - at >= PULSE_MS) return 0;
  const t = (now - at) / PULSE_MS;
  return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
};
let statusAt = 0, drawMs = 0, resizeAt = 0;
const drawHist = [];
function update(now, dt) {
  if (!geo.halves.length) {
    if (now - statusAt > 500) { statusAt = now; setStatus("画面が小さすぎる（最初の半周が入らない）"); }
    return;
  }
  if (running) {
    while (total() - state.shown < 400) planVisit();
    state.shown = Math.min(total(), state.shown + params.speed * dt);
  }
  const n = Math.floor(state.shown);
  // 書き始めた半周に入る（前の周回の字を層から消し、残りはカーソルの先だけ1字ずつ描く）
  for (const v of state.visits) {
    if (v.entered) continue;
    if (v.start >= n) break;
    enterVisit(v);
  }
  // 頭のかなが書かれた語に、強調の始まりの時刻を付ける
  for (let w = state.words.length - 1; w >= 0; w--) {
    const wd = state.words[w];
    if (wd.start + wd.e.len < n - LIVE) break;
    if (wd.chained && wd.pulseAt === null && n > wd.start + wd.e.headPos) wd.pulseAt = now;
  }
  bake(n, now);
  trim(n);
  if (now - statusAt > 500) {
    statusAt = now;
    const nh = geo.halves.length, v = currentVisit(n);
    const dir = state.curRound % 2 ? "IN" : "OUT";
    const lenOf = (h) => (h.s1 - h.s0 - geo.split).toFixed(0);
    setStatus(`ROUND ${state.curRound} ${dir}  HALF ${v ? v.bar + 1 : 0}/${nh}  CHARS ${n}\nTURNS ${(nh / 2).toFixed(1)}  LEN ${lenOf(geo.halves[0])}→${lenOf(geo.halves[nh - 1])}  DRAW ${drawMs.toFixed(1)}ms (MAX ${Math.max(0, ...drawHist).toFixed(0)})\nEXACT ${Math.round((100 * state.exact) / (state.bars || 1))}%  MULTI ${state.multi}  REUSE ${state.reused}  RESTART ${state.restarts}`);
  }
}
function currentVisit(n) {
  for (let k = state.visits.length - 1; k >= 0; k--) if (state.visits[k].entered) return state.visits[k];
  return null;
}
// 焼き付け：最新の LIVE 字より古い字を、その周回の層に一度だけ描く。上書きされた（superseded）半周の字は焼かない
function bake(n, now) {
  const key = styleOf();
  if (key !== styleKey) { styleKey = key; rebuild(); }
  const target = Math.max(0, n - LIVE);
  const to = Math.min(target, bakeUpto + BAKE_PER_FRAME);
  for (; bakeUpto < to; bakeUpto++) {
    const ch = chAt(bakeUpto), v = ch.wd.visit;
    if (v.superseded) continue;
    const L = layers[v.layer];
    drawChar(L.ctx, ch, geo.ox, geo.oy, geo.cell, L.dpr);
  }
  // しりとり線は、頭のかなが焼かれ、伸びきったものから焼く（語の順に）
  while (linkUpto < state.wBase + state.words.length) {
    const wd = state.words[linkUpto - state.wBase];
    if (wd.start + wd.e.headPos >= bakeUpto) break;
    if (wd.pulseAt !== null && now - wd.pulseAt < LINK_MS) break;
    wd.linkedOnce = true;
    if (params.link && linkOK(wd) && !wd.visit.superseded) {
      const L = layers[wd.visit.layer];
      strokePath(L.ctx, pathOf(wd), geo.ox, geo.oy, geo.cell, L.dpr, 1, 1);
      wd.linked = true;
    }
    linkUpto++;
  }
}
// 色・かっこ・見出しの濃さ・線が変わったら、層を描き直す
const styleOf = () => [params.inkColor, params.bgColor, params.bracket, params.headEm, params.link, params.lineColor, window.devicePixelRatio || 1].join("|");
function rebuild() {
  if ((window.devicePixelRatio || 1) !== layers[0].dpr) layers = [newLayer(), newLayer()];
  for (const L of layers) { L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); }
  for (const v of barCur) if (v) drawVisitBaked(v);
}
// 焼き終えた古い字・語を捨てる（半周ごとの visit には残る）
function trim(n) {
  const cut = Math.min(bakeUpto, n - LIVE) - 200;
  if (cut - state.cBase > 3000) { state.chars.splice(0, cut - state.cBase); state.cBase = cut; }
  let k = 0;
  while (k < state.words.length - 50 && state.words[k].start + state.words[k].e.len < cut && state.wBase + k < linkUpto) k++;
  if (k > 500) { state.words.splice(0, k); state.wBase += k; }
  let m = 0;
  while (m < state.visits.length - 1 && state.visits[m].entered && state.visits[m].end < cut) m++;
  if (m > 50) state.visits.splice(0, m);
}

// ---------- 描く ----------
const FONT = (cell) => `${cell * 0.9}px "Noto Serif JP", serif`;
const glyphOf = (ch) => (ch.j === 0 ? params.bracket[0] : ch.j === ch.wd.e.headLen - 1 ? params.bracket[1] : ch.wd.e.text[ch.j]);
function drawChar(c, ch, ox, oy, cell, dpr, color) {
  c.font = FONT(cell);
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = color || (params.headEm && ch.j >= ch.wd.e.headLen ? mix(params.inkColor, params.bgColor, 0.55) : params.inkColor);
  const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
  c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (ox + ch.x * cell), dpr * (oy + ch.y * cell));
  c.fillText(glyphOf(ch), 0, 0);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// しりとり線（どの語どうしも同じ決まり）：前の語の尻のかなの下（字の下の側）から、隣の巻きとのすき間（字の中心線から LINE_SPACE/2）に入り、
// すき間に沿って進み、次の語の頭のかなの下へ上がる。外へ向かう周回は内側のすき間、内へ向かう周回は外側のすき間を通る。
// すき間は字の並ぶ巻きと巻きのあいだなので、ほかの字にぶつからない。中心を横切る区切り（φ＝kπ）は、線はそのまま通る。
// 往復の折り返し（進む向きが逆になる）では線を引かない（しりとりはつながっている。強調は出る）
const BOTTOM = 0.45;
const LINK_STEP = 0.3; // すき間に沿って点を置く間隔（字）
const linkOK = (wd) => wd.chained && wd.prev && wd.prev.visit.rev === wd.visit.rev;
function pathOf(wd) {
  if (wd.path !== undefined) return wd.path;
  const pv = wd.prev.visit, v = wd.visit;
  const T = pv.chars[wd.prev.start + wd.prev.e.tailPos - pv.start], Hd = v.chars[wd.start + wd.e.headPos - v.start];
  const side = v.rev ? 1 : -1, dir = v.rev ? -1 : 1;              // 字の下の側（外へ：内側、内へ：外側）と、φ の進む向き
  const rc = (phi) => geo.r0 + geo.b * phi + side * geo.pitch / 2; // すき間の中心の半径
  const at = (phi, r) => [r * Math.cos(phi), r * Math.sin(phi)];
  const pts = [at(T.phi, T.r + side * BOTTOM)];
  for (let phi = T.phi; ; ) {
    pts.push(at(phi, rc(phi)));
    if ((Hd.phi - phi) * dir <= 0) break;
    phi += dir * Math.min(Math.abs(Hd.phi - phi), LINK_STEP / Math.max(0.5, rc(phi)));
  }
  pts.push(at(Hd.phi, Hd.r + side * BOTTOM));
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return (wd.path = { pts, len });
}
function strokePath(c, path, ox, oy, cell, dpr, alpha, grow, color, extra = 0) {
  const { pts, len } = path;
  let rest = len * grow;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = alpha;
  c.strokeStyle = color || params.lineColor;
  c.lineWidth = Math.max(1, cell * 0.06) + extra;
  c.lineJoin = "round"; c.lineCap = extra ? "round" : "butt";
  c.beginPath();
  c.moveTo(ox + pts[0][0] * cell, oy + pts[0][1] * cell);
  for (let i = 1; i < pts.length && rest > 0; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const t = Math.min(1, rest / (seg || 1));
    c.lineTo(ox + (pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t) * cell, oy + (pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t) * cell);
    rest -= seg;
  }
  c.stroke();
  c.globalAlpha = 1;
}

// しりとりの強調（白黒反転）を上から重ねる
function drawPulses(c, ox, oy, cell, dpr, now) {
  const box = (ch, amt) => {
    const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
    c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (ox + ch.x * cell), dpr * (oy + ch.y * cell));
    c.globalAlpha = amt;
    c.fillStyle = params.inkColor; c.fillRect(-cell * 0.55, -cell * 0.5, cell * 1.1, cell);
    c.fillStyle = params.bgColor; c.fillText(glyphOf(ch), 0, 0);
  };
  c.font = FONT(cell);
  c.textAlign = "center"; c.textBaseline = "middle";
  for (let w = state.words.length - 1; w >= 0; w--) {
    const wd = state.words[w];
    if (wd.start > state.shown) continue;
    if (wd.pulseAt !== null && now - wd.pulseAt > PULSE_MS * 2) break;
    const amt = pulseAmount(wd.pulseAt, now);
    if (!amt || !wd.chained || wd.visit.superseded) continue;
    const pv = wd.prev.visit;
    box(wd.visit.chars[wd.start + wd.e.headPos - wd.visit.start], amt);
    if (!pv.superseded) box(pv.chars[wd.prev.start + wd.prev.e.tailPos - pv.start], amt);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
}

// 書いている半周の、前の周回の字（カーソルより先のものだけ）
function drawSweep(c, v, n, alpha, dpr) {
  if (!v || !v.old || n >= v.end) return;
  const next = n >= v.start ? v.chars[n - v.start] : v.chars[0];
  const u = (ch) => (v.rev ? v.s1 - ch.s : ch.s - v.s0); // 書いている半周の進む向きに測った位置
  const lim = u(next) - 0.5;
  c.globalAlpha = alpha;
  for (const ch of v.old.chars) if (u(ch) > lim) drawChar(c, ch, geo.ox, geo.oy, geo.cell, dpr);
  c.globalAlpha = 1;
}

function drawGuide(c, alpha) {
  c.globalAlpha = 0.25 * alpha; c.strokeStyle = params.inkColor; c.lineWidth = 1;
  c.beginPath();
  for (let phi = 0; phi <= geo.halves.length * Math.PI + 1e-9; phi += 0.05) {
    const p = pointAt(phi);
    phi ? c.lineTo(geo.ox + p.x * geo.cell, geo.oy + p.y * geo.cell) : c.moveTo(geo.ox + p.x * geo.cell, geo.oy + p.y * geo.cell);
  }
  c.stroke();
  c.globalAlpha = 1;
}

// 描く（画面）
function draw(c, W, H, now, dpr) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = params.bgColor;
  c.fillRect(0, 0, W, H);
  if (!geo.halves.length) return;
  if (params.guide) drawGuide(c, 1);
  const n = Math.floor(state.shown), cur = state.curRound, cell = geo.cell;
  const oldA = cur > 0 ? params.oldAlpha : 1;
  // 層を貼る：前の周回（薄く）→ いまの周回
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = oldA;
  c.drawImage(layers[(cur + 1) % 2].canvas, 0, 0, W * dpr, H * dpr);
  c.globalAlpha = 1;
  c.drawImage(layers[cur % 2].canvas, 0, 0, W * dpr, H * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 書いている半周の、前の周回の字
  const v = currentVisit(n);
  drawSweep(c, v, n, oldA, dpr);
  // 焼いていない最新の字
  c.font = FONT(cell);
  for (let q = Math.max(bakeUpto, state.cBase); q < n; q++) {
    const ch = chAt(q), vv = ch.wd.visit;
    if (vv.superseded) continue;
    c.globalAlpha = vv.round === cur ? 1 : oldA;
    drawChar(c, ch, geo.ox, geo.oy, cell, dpr);
  }
  c.globalAlpha = 1;
  // まだ焼いていない線（伸びている途中のものも）
  if (params.link) {
    for (let w = Math.max(0, linkUpto - state.wBase); w < state.words.length; w++) {
      const wd = state.words[w];
      if (wd.start + wd.e.headPos >= n) break;
      if (!linkOK(wd) || wd.visit.superseded) continue;
      const grow = wd.pulseAt === null ? 1 : Math.min(1, (now - wd.pulseAt) / LINK_MS);
      strokePath(c, pathOf(wd), geo.ox, geo.oy, cell, dpr, wd.visit.round === cur ? 1 : oldA, grow);
    }
  }
  drawPulses(c, geo.ox, geo.oy, cell, dpr, now);
  // カーソル（点滅）
  if (running && n < total() && Math.floor(now / 500) % 2 === 0) {
    const ch = chAt(n);
    const co = Math.cos(ch.ang), si = Math.sin(ch.ang);
    c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (geo.ox + ch.x * cell), dpr * (geo.oy + ch.y * cell));
    c.globalAlpha = 0.35; c.fillStyle = params.inkColor;
    c.fillRect(-cell * 0.45, -cell * 0.45, cell * 0.9, cell * 0.9);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
  }
}

const canvas = $("c"), ctx = canvas.getContext("2d");
let last = performance.now(), sizeKey = "";
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  // 窓の大きさが変わったら、落ち着いてから（0.4秒）最初から（渦の大きさが変わるので、書いたものはつながらない）
  const sk = `${W}x${H}`;
  if (sk !== sizeKey) { sizeKey = sk; resizeAt = now; }
  if (geo && (W !== geo.W || H !== geo.H) && now - resizeAt > 400) reset();
  update(now, dt);
  const t0 = performance.now();
  draw(ctx, W, H, now, dpr);
  drawHist.push(performance.now() - t0);
  if (drawHist.length > 60) drawHist.shift();
  drawMs = drawHist.reduce((a, b) => a + b, 0) / drawHist.length;
  requestAnimationFrame(frame);
}

// ---------- スクリーンショット（S キー） ----------
// 強調・カーソルなし。前の周回の字も濃く描く（はっきり読める形）
function saveScreenshot() {
  const dpr = window.devicePixelRatio || 1;
  const W = geo.W, H = geo.H, n = Math.floor(state.shown);
  const off = document.createElement("canvas");
  off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
  const c = off.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = params.bgColor; c.fillRect(0, 0, W, H);
  if (params.guide) drawGuide(c, 1);
  const v = currentVisit(n);
  drawSweep(c, v, n, 1, dpr);
  for (const bv of barCur) {
    if (!bv) continue;
    for (const ch of bv.chars) if (ch.wd.start + ch.j < n) drawChar(c, ch, geo.ox, geo.oy, geo.cell, dpr);
    if (params.link) for (const wd of bv.words) if (linkOK(wd) && wd.start + wd.e.headPos < n) strokePath(c, pathOf(wd), geo.ox, geo.oy, geo.cell, dpr, 1, 1);
  }
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

if (window.__uzuDebug) window.__uzu = { state, barCur, pulseAmount, get geo() { return geo; } };
loadDict().then(() => {
  reset();
  running = true;
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}`));
