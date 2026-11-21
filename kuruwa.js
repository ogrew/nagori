// Nagori / Kuruwa（郭）：辞書の項目（【見出し（よみ）】語釈。）を、四角の渦に沿った棒に並べ、見出しをよみのしりとりでつなぐ。
// 棒は外周から 右→下→左→上→（内側の）右… と時計回りに巻き込む。同じ向きの棒は LINE_SPACE（棒の太さ＋すき間）ずつ短くなり、
// MIN_LEN（字）より短くなるところが最深部。そこまで来たら、今度は同じ棒を逆の順にたどって外周へ戻る（反時計回り）。これを往復する。
// 往復の折り返しでは端の棒をもう一度書かない（内へ：0..n-1、外へ：n-2..0、内へ：1..n-1 …）ので、しりとりは切れずにつながる。
// 画面は消さない。新しい周回の字は、前の周回の字を棒ごとに上書きする（書いている棒では、カーソルより先に前の字が残る）。
// 前の周回の字は OLD_ALPHA の濃さで描く → 書き換わる場所が内↔外を往復して見える。
// 1本の棒は1語を優先し、無ければ複数の語で埋める。字の間隔を 0.9〜1.15 字で伸び縮みさせ、棒の端でぴったり止める。
// 字は進む方向に合わせて回す（横書きの向きのまま。内へ向かう周回は字の頭が外側、外へ向かう周回は内側）。
// 座標は「字1つ＝1」の世界座標（枠の左上が原点）で持ち、描くときに cell（px/字）をかける。
const $ = (id) => document.getElementById(id);

// ---------- 設定 ----------
const params = {};
for (const id of ["minLen", "lineSpace", "split", "size", "margin", "speed", "oldAlpha"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
// 形（最深部・棒の間隔・区切り・字の大きさ・余白）を変えたら最初から
for (const id of ["minLen", "lineSpace", "split", "size", "margin"]) $(id).addEventListener("change", () => reset());
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
}

// ---------- 四角の渦（棒の並び） ----------
// 残りの長方形 [x0,x1]×[y0,y1] の 右・下・左・上 の辺に、太さ1字の棒を順に置き、置いた辺を LINE_SPACE だけ内へ寄せる。
// 棒：{x, y（中心線の始点。時計回りのとき）, dx, dy（時計回りの進む向き）, L（長さ）}
let geo = null;
function makeGeo(W, H) {
  const m = Math.round(Math.min(W, H) * params.margin / 100);
  const cell = params.size;
  const Fw = (W - 2 * m) / cell, Fh = (H - 2 * m) / cell, t = params.lineSpace;
  const bars = [];
  let x0 = 0, x1 = Fw, y0 = 0, y1 = Fh;
  for (let n = 0; n < 4000; n++) {
    let b;
    switch (n % 4) {
      case 0: b = { x: x1 - 0.5, y: y0, dx: 0, dy: 1, L: y1 - y0 }; break;   // 右：上から下へ
      case 1: b = { x: x1, y: y1 - 0.5, dx: -1, dy: 0, L: x1 - x0 }; break;  // 下：右から左へ（x1 は右の棒のぶん寄せた後）
      case 2: b = { x: x0 + 0.5, y: y1, dx: 0, dy: -1, L: y1 - y0 }; break;  // 左：下から上へ
      case 3: b = { x: x0, y: y0 + 0.5, dx: 1, dy: 0, L: x1 - x0 }; break;   // 上：左から右へ
    }
    if (b.L < params.minLen) break;
    bars.push(b);
    if (n % 4 === 0) x1 -= t; else if (n % 4 === 1) y1 -= t; else if (n % 4 === 2) x0 += t; else y0 += t;
  }
  return { W, H, cell, ox: (W - Fw * cell) / 2, oy: (H - Fh * cell) / 2, Fw, Fh, t, split: params.split, bars };
}
// 周回 r で書く棒の順番：内へ 0..n-1、外へ n-2..0、内へ 1..n-1、外へ n-2..0 …（折り返しの棒は続けて2回書かない）
function roundSeq(r, n) {
  if (n === 1) return [0];
  const out = [];
  if (r % 2 === 1) for (let i = n - 2; i >= 0; i--) out.push(i);
  else for (let i = r === 0 ? 0 : 1; i < n; i++) out.push(i);
  return out;
}

// ---------- 棒に語を詰める（しりとり） ----------
// 棒の長さから区切りの幅を引いたものが、字を並べられる長さ A。字の間隔を SP_MIN〜SP_MAX で伸び縮みさせてよいので、
// 語の字数の合計 N は ceil(A/SP_MAX)〜floor(A/SP_MIN) ならよい（A に近いほどよい）
const SP_MIN = 0.9, SP_MAX = 1.15, MIN_PIECE = 12; // 途中の語のあとに残す字数の下限
// visit：棒を1回書くこと {bar, round, rev, start, end（chars の通し番号）, words, chars, layer, entered, superseded, old}
// word：{i, e, visit, start, prev（前の語）, chained, pulseAt, path, linked（焼いた）}
// char：{x, y, ang, wd, j}
const state = {};
function clearState() {
  Object.assign(state, {
    round: 0, seqPos: 0, curRound: 0,
    chars: [], cBase: 0,      // chars[q - cBase]。焼き付けが済んだ古い字は捨てる（棒ごとの visit.chars には残る）
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
  const n = geo.bars.length;
  let seq = roundSeq(state.round, n);
  if (state.seqPos >= seq.length) { state.round++; state.seqPos = 0; seq = roundSeq(state.round, n); }
  const bi = seq[state.seqPos++], bar = geo.bars[bi];
  const rev = state.round % 2 === 1 && n > 1;
  const A = bar.L - geo.split;
  const nMin = Math.ceil(A / SP_MAX), nMax = Math.floor(A / SP_MIN), n0 = Math.round(A);
  const picked = []; // {i, chained}
  let sum = 0;
  for (let guard = 0; guard < 40; guard++) {
    const rem0 = n0 - sum, remLo = nMin - sum, remHi = nMax - sum;
    const fin = lensNear(rem0, Math.max(6, remLo), remHi);
    const prev = state.prev;
    // 1) この語で棒を終えられるか
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
  // 字の位置：棒の始めから区切りの半分あけ、間隔 sp で並べる。外へ向かう周回は棒の終わりから逆向きに
  const D = rev ? { x: -bar.dx, y: -bar.dy } : { x: bar.dx, y: bar.dy };
  const S = rev ? { x: bar.x + bar.dx * bar.L, y: bar.y + bar.dy * bar.L } : { x: bar.x, y: bar.y };
  const visit = { bar: bi, round: state.round, rev, D, nb: { x: -D.y, y: D.x }, start: total(), end: 0, words: [], chars: [],
    layer: state.round % 2, entered: false, superseded: false, old: null };
  const sp = sum ? A / sum : 1, ang = Math.atan2(D.y, D.x);
  let u = geo.split / 2 + sp / 2;
  for (const p of picked) {
    const prevWord = state.words.length ? state.words[state.words.length - 1] : null;
    const wd = { i: p.i, e: E[p.i], visit, start: total(), prev: prevWord, chained: p.chained && !!prevWord, pulseAt: null, path: undefined, linked: false };
    if (prevWord) prevWord.next = wd;
    state.words.push(wd);
    visit.words.push(wd);
    for (let j = 0; j < wd.e.len; j++, u += sp) {
      const ch = { x: S.x + D.x * u, y: S.y + D.y * u, u, ang, wd, j };
      state.chars.push(ch);
      visit.chars.push(ch);
    }
  }
  visit.end = total();
  state.visits.push(visit);
}

// ---------- 開始・リセット ----------
const barCur = [];  // 棒ごとに、いま見えている visit
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

// ---------- 棒に入る（上書きの始まり）・周回の始まり ----------
function boxOf(bi) {
  // 棒の外形（世界座標）。太さは字1つ＋わずか（すき間のしりとり線には届かない）
  const b = geo.bars[bi], h = 0.56;
  const xa = b.x, xb = b.x + b.dx * b.L, ya = b.y, yb = b.y + b.dy * b.L;
  return b.dx ? [Math.min(xa, xb), ya - h, Math.abs(b.L), 2 * h] : [xa - h, Math.min(ya, yb), 2 * h, Math.abs(b.L)];
}
function eraseBox(L, bi) {
  const [x, y, w, h] = boxOf(bi), c = L.ctx, cell = geo.cell, dpr = L.dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(geo.ox + x * cell, geo.oy + y * cell, w * cell, h * cell);
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
  eraseBox(layers[v.layer], v.bar);
  for (const wd of v.words) eraseLink(wd);
  // この棒の最後の語から次の棒へ伸びる線（頭のある次の語の持ち物）も消す
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
  // 2つ前の周回の字がまだ残っている棒（前の周回が書かなかった折り返しの棒）は、前の周回の層へ移す（薄く見せる）
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
  if (!geo.bars.length) {
    if (now - statusAt > 500) { statusAt = now; setStatus(`枠が小さすぎる（MIN_LEN ${params.minLen} 字の棒が入らない）`); }
    return;
  }
  if (running) {
    while (total() - state.shown < 400) planVisit();
    state.shown = Math.min(total(), state.shown + params.speed * dt);
  }
  const n = Math.floor(state.shown);
  // 書き始めた棒に入る（前の周回の字を層から消し、残りはカーソルの先だけ1字ずつ描く）
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
    const nb = geo.bars.length, v = currentVisit(n);
    const dir = state.curRound % 2 ? "OUT" : "IN";
    setStatus(`ROUND ${state.curRound} ${dir}  BAR ${v ? v.bar + 1 : 0}/${nb}  CHARS ${n}\nFRAME ${geo.Fw.toFixed(0)}×${geo.Fh.toFixed(0)}  LEN ${geo.bars[0].L.toFixed(0)}→${geo.bars[nb - 1].L.toFixed(0)}  DRAW ${drawMs.toFixed(1)}ms (MAX ${Math.max(0, ...drawHist).toFixed(0)})\nEXACT ${Math.round((100 * state.exact) / (state.bars || 1))}%  MULTI ${state.multi}  REUSE ${state.reused}  RESTART ${state.restarts}`);
  }
}
function currentVisit(n) {
  for (let k = state.visits.length - 1; k >= 0; k--) if (state.visits[k].entered) return state.visits[k];
  return null;
}
// 焼き付け：最新の LIVE 字より古い字を、その周回の層に一度だけ描く。上書きされた（superseded）棒の字は焼かない
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
// 焼き終えた古い字・語を捨てる（棒ごとの visit には残る）
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
const FONT = (cell) => `${cell * 0.9}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`;
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

// しりとり線：前の語の尻のかなの下（字の下の側）から、その棒のすき間（棒の中心から LINE_SPACE/2）に入り、すき間に沿って進み、
// 次の語の頭のかなの下へ上がる。次の語が次の棒にあるときは、2つのすき間の交わる角で曲がる（鍵の手）。
// 往復の折り返し（進む向きが逆になる）では線を引かない（しりとりはつながっている。強調は出る）
const BOTTOM = 0.45;
const linkOK = (wd) => wd.chained && wd.prev && wd.prev.visit.rev === wd.visit.rev;
function pathOf(wd) {
  if (wd.path !== undefined) return wd.path;
  const pv = wd.prev.visit, v = wd.visit, g = geo.t / 2;
  const T = pv.chars[wd.prev.start + wd.prev.e.tailPos - pv.start], Hd = v.chars[wd.start + wd.e.headPos - v.start];
  const off = (p, nb, d) => [p.x + nb.x * d, p.y + nb.y * d];
  const pts = [off(T, pv.nb, BOTTOM), off(T, pv.nb, g)];
  const B0 = off(Hd, v.nb, g);
  if (pv !== v) {
    const A0 = pts[1];
    pts.push(pv.D.x === 0 ? [A0[0], B0[1]] : [B0[0], A0[1]]);
  }
  pts.push(B0, off(Hd, v.nb, BOTTOM));
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

// 書いている棒の、前の周回の字（カーソルより先のものだけ）
function drawSweep(c, v, n, alpha, dpr) {
  if (!v || !v.old || n >= v.end) return;
  const S = v.chars[0], next = n >= v.start ? v.chars[n - v.start] : S;
  const cu = (p) => (p.x - S.x) * v.D.x + (p.y - S.y) * v.D.y;
  const lim = cu(next) - 0.5;
  c.globalAlpha = alpha;
  for (const ch of v.old.chars) if (cu(ch) > lim) drawChar(c, ch, geo.ox, geo.oy, geo.cell, dpr);
  c.globalAlpha = 1;
}

function drawGuide(c, alpha) {
  c.globalAlpha = 0.25 * alpha; c.strokeStyle = params.inkColor; c.lineWidth = 1;
  for (let bi = 0; bi < geo.bars.length; bi++) {
    const [x, y, w, h] = boxOf(bi);
    c.strokeRect(geo.ox + x * geo.cell, geo.oy + y * geo.cell, w * geo.cell, h * geo.cell);
  }
  c.globalAlpha = 1;
}

// 描く（画面）
function draw(c, W, H, now, dpr) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = params.bgColor;
  c.fillRect(0, 0, W, H);
  if (!geo.bars.length) return;
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
  // 書いている棒の、前の周回の字
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
  // 窓の大きさが変わったら、落ち着いてから（0.4秒）最初から（枠と棒が変わるので、書いたものはつながらない）
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
  const name = `nagori-kuruwa-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
  off.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

if (window.__kuruwaDebug) window.__kuruwa = { state, barCur, pulseAmount, get geo() { return geo; } };
loadDict().then(() => {
  reset();
  running = true;
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}`));
