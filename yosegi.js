// Nagori / Yosegi（寄木）：正方形を大小の四角（ブロック）に分け、ブロック1つを辞書の項目（【見出し（よみ）】語釈。）1つでちょうど埋める。
// ブロックの中は字のマス目（横 c × 縦 r）。項目の字数がちょうど c×r になるものを選ぶので、余りも埋め草もない。
// 字の大きさ：FIXED（既定）はどのブロックも FONT_SIZE（ブロックが大きいほど長い項目が入る）。RANGE はブロックごとに
// MIN_FONT〜MAX_FONT のどれか（項目は最長70字なので、大きいブロックはどうしても大きな字になる）。
// ブロックには地の色も枠もない。ブロックどうしは GAP のすき間と、字の向き・大きさの違いだけで分かれて見える。
// 縦長のマス目は縦書き（列は右から左）、横長は横書き、正方形に近いものはどちらか。
// 分け方：QUAD（正方形を4つに分け続ける）／SPLIT（長方形を2つに分け続ける）／MIX（両方）。
// ブロックは分けた順（深さ優先）に1つずつ書き、項目はよみのしりとりでつなぐ（1枚を書き終えても、次の1枚へ続く）。
// 名前：寄木（よせぎ）＝寄木細工。形の違う木片を寄せて、一つの模様にする。
const $ = (id) => document.getElementById(id);
const GLYPH = 0.86; // 字の大きさ／マスの大きさ（行間・字間にしりとり線が通る）
const FONT = (px) => `${px}px "Noto Serif JP", serif`;

async function loadFont(texts) {
  if (!document.fonts) return;
  const chars = [...new Set(texts.join("") + "【】《》「」『』（）、。ー〜")].join("");
  const timeout = new Promise((r) => setTimeout(r, 15000));
  await Promise.race([document.fonts.load(FONT(16), chars), timeout]).catch(() => {});
}

// ---------- 設定 ----------
const params = {};
for (const id of ["depth", "fontSize", "minFont", "maxFont", "gap", "margin", "speed", "hold"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
params.divide = $("divide").value;
$("divide").addEventListener("change", (e) => { params.divide = e.target.value; newPiece(); });
for (const id of ["depth", "fontSize", "minFont", "maxFont", "gap", "margin"]) $(id).addEventListener("change", () => newPiece());
// 字の大きさ：FIXED は FONT_SIZE だけ、RANGE は MIN_FONT・MAX_FONT だけを操作できる
const syncFontMode = () => {
  params.fontMode = $("fontMode").value;
  const fixed = params.fontMode === "fixed";
  for (const [id, on] of [["fontSize", fixed], ["minFont", !fixed], ["maxFont", !fixed]]) {
    $(id).disabled = !on;
    $(id).closest(".r").classList.toggle("off", !on);
  }
};
$("fontMode").addEventListener("change", () => { syncFontMode(); newPiece(); });
syncFontMode();
params.headEm = $("headEm").checked;
$("headEm").addEventListener("change", (e) => { params.headEm = e.target.checked; rebake(); });
params.bracket = $("bracket").value;
$("bracket").addEventListener("change", (e) => { params.bracket = e.target.value; rebake(); });
// DEBUG_LINE：ブロックの外枠を薄い点線で示す（書き始めたブロックだけ）。色（DEBUG_COLOR）はオンのときだけ変えられる
const syncDebug = () => {
  params.debug = $("debug").checked;
  $("debugColor").disabled = !params.debug;
  $("debugColor").closest(".r").classList.toggle("off", !params.debug);
};
$("debug").addEventListener("change", syncDebug);
// しりとり線（SHIRITORI_LINE、既定オン）。線の色（LINE_COLOR）はオンのときだけ変えられる
const syncLink = () => {
  params.link = $("link").checked;
  $("lineColor").disabled = !params.link;
  $("lineColor").closest(".r").classList.toggle("off", !params.link);
};
$("link").addEventListener("change", syncLink);
$("mode").addEventListener("change", (e) => (location.href = e.target.value));
for (const id of ["inkColor", "bgColor", "lineColor", "debugColor"]) {
  const el = $(id);
  try { const saved = localStorage.getItem(`shapetext.${id}`); if (saved) el.value = saved; } catch {}
  const sync = () => {
    params[id] = el.value;
    try { localStorage.setItem(`shapetext.${id}`, el.value); } catch {}
    $("stage").style.background = params.bgColor;
  };
  el.addEventListener("input", sync); el.addEventListener("change", rebake); sync();
}
syncLink();
syncDebug();
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}
const setStatus = (msg) => ($("status").textContent = msg);

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
$("reset").addEventListener("click", () => { state.prev = null; newPiece(); });
$("next").addEventListener("click", () => newPiece());
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
  const t = ev.target;
  if (ev.key === "Escape" && panelOpen()) { showPanel(false); return; }
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
  const k = ev.key.toLowerCase();
  if (k === "h") { ev.preventDefault(); showPanel(!panelOpen()); }
  else if (ev.code === "Space" && !(t.tagName === "INPUT" && t.type === "checkbox")) { ev.preventDefault(); if (E.length) running = !running; }
  else if (k === "s") { ev.preventDefault(); if (piece) saveScreenshot(); }
  else if (k === "n") { ev.preventDefault(); if (E.length) newPiece(); }
});

// ---------- 辞書 ----------
let E = [];
const inv = new Map(), byLen = new Map(), headTotal = new Map();
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

// ---------- マス目の候補 ----------
// ブロックの内側 w×h（px）に置けるマス目 c×r（字数 c×r の項目があるもの）。fs は字のマスの大きさ
// FIXED：マスの縦・横が FONT_SIZE の 0.95〜1.12 倍。RANGE：マスの縦横比が 0.8〜1.25、短い辺が MIN_FONT〜MAX_FONT
const ASPECT = 1.25, MIN_N = 6, MAX_N = 70, FIX_LO = 0.95, FIX_HI = 1.12;
const lenOK = (n) => n >= MIN_N && n <= MAX_N && byLen.has(n);
function grids(w, h) {
  const out = [];
  if (w <= 0 || h <= 0) return out;
  if (params.fontMode === "fixed") {
    const f = params.fontSize;
    for (let c = Math.max(1, Math.ceil(w / (f * FIX_HI))); c <= Math.floor(w / (f * FIX_LO)); c++)
      for (let r = Math.max(1, Math.ceil(h / (f * FIX_HI))); r <= Math.floor(h / (f * FIX_LO)); r++)
        if (lenOK(c * r)) out.push({ c, r, n: c * r, fs: f });
    return out;
  }
  for (let c = 1; c <= MAX_N; c++) {
    for (let r = 1; c * r <= MAX_N; r++) {
      const n = c * r;
      if (!lenOK(n)) continue;
      const cw = w / c, ch = h / r, a = cw / ch;
      if (a > ASPECT || a < 1 / ASPECT) continue;
      const fs = Math.min(cw, ch);
      if (fs < params.minFont || fs > params.maxFont) continue;
      out.push({ c, r, n, fs });
    }
  }
  return out;
}

// ---------- 分割 ----------
// 正方形を再帰的に分ける。深いほど分けにくく（DEPTH が大きいほど細かい）。マス目の候補が無い葉はさらに分ける。
// SPLIT の分け目は 1/8 刻みにそろえる（ばらばらの比だと落ち着かない）
const RATIOS = [0.25, 0.375, 0.5, 0.625, 0.75];
function divide(S) {
  const gap = params.gap;
  const ok = (w, h) => grids(w - gap, h - gap).length > 0;   // すき間を引いた内側でマス目が取れるか
  // 分け方の候補（子の長方形の並び）。どの子にもマス目が取れる分け方だけを使うので、穴は空かない
  // FIXED のときは、分け目を「前の子がちょうど字のマス k 個＋すき間」になる位置に寄せる（後ろの子はマスを少し伸び縮み）
  const snap = (len, t) => {
    if (params.fontMode !== "fixed") return t;
    const f = params.fontSize, k = Math.max(1, Math.round((len * t - gap) / f));
    return (k * f + gap) / len;
  };
  const options = (x, y, w, h) => {
    const out = [];
    const square = Math.abs(w - h) < 0.5;
    const quadFirst = params.divide === "quad" || (params.divide === "mix" && square && Math.random() < 0.55);
    const quad = () => { const hw = w * snap(w, 0.5), hh = h * snap(h, 0.5); return [[x, y, hw, hh], [x + hw, y, w - hw, hh], [x, y + hh, hw, h - hh], [x + hw, y + hh, w - hw, h - hh]]; };
    if (quadFirst) out.push(quad());
    if (params.divide !== "quad" || !square) {
      for (const t0 of RATIOS.slice().sort(() => Math.random() - 0.5)) {
        // 長い辺を分けやすく（正方形に近ければどちらでも）
        const vert = w > h * 1.15 ? Math.random() < 0.85 : h > w * 1.15 ? Math.random() < 0.15 : Math.random() < 0.5;
        const V = () => { const t = snap(w, t0); return [[x, y, w * t, h], [x + w * t, y, w * (1 - t), h]]; };
        const H = () => { const t = snap(h, t0); return [[x, y, w, h * t], [x, y + h * t, w, h * (1 - t)]]; };
        out.push(vert ? V() : H(), vert ? H() : V());
      }
    }
    return out;
  };
  // 見込みのない子を先に除く：内側の幅・高さのどちらかにマスがちょうど並ばない、または6字が入らない
  const lo = params.fontMode === "fixed" ? params.fontSize * FIX_LO : params.minFont;
  const line = (L) => {
    if (params.fontMode !== "fixed") return L >= params.minFont;
    const f = params.fontSize;
    for (let c = Math.max(1, Math.ceil(L / (f * FIX_HI))); c <= Math.floor(L / (f * FIX_LO)); c++) return true;
    return false;
  };
  const viable = (w, h) => line(w - gap) && line(h - gap) && Math.floor((w - gap) / lo) * Math.floor((h - gap) / lo) >= MIN_N;
  // 分けた子がさらに分けられるかは先まで見ないとわからないので、やってみて駄目なら別の分け方に戻る（手数の上限つき）
  let budget = 20000;
  const rec = (x, y, w, h, d) => {
    if (--budget < 0) return null;
    const fits = ok(w, h);
    const big = Math.min(w, h) > S * 0.3;                // 最初の数段は必ず分ける
    const want = big || !fits || Math.random() < Math.pow(params.depth, d * 0.55);
    if (want) {
      let tries = 0;
      for (const kids of options(x, y, w, h)) {
        if (!kids.every(([, , cw, ch]) => viable(cw, ch))) continue;
        if (++tries > 6) break;
        const got = [];
        if (kids.every((k) => { const r = rec(...k, d + 1); if (r) got.push(...r); return !!r; })) return got;
      }
    }
    return fits ? [{ x, y, w, h }] : null;
  };
  for (let t = 0; t < 5; t++) {
    budget = 20000;
    const got = rec(0, 0, S, S, 0);
    if (got) return got;
  }
  return [];
}

// ---------- しりとりで項目を選ぶ ----------
const state = { prev: null, used: new Set(), breaks: 0, reused: 0, pieces: 0 };
const candidates = (head, n, reuse) => (inv.get(key(head, n)) || []).filter((i) => reuse || !state.used.has(i));
function choose(list) {
  if (!list.length) return -1;
  const scored = list.map((i) => [i, headTotal.get(E[i].tail) || 0]).sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, Math.max(5, Math.ceil(scored.length / 3)));
  return top[Math.floor(Math.random() * top.length)][0];
}
function pickFor(g) {
  const order = g.slice().sort(() => Math.random() - 0.5);
  const prev = state.prev;
  const tryAll = (reuse) => {
    for (const m of order) {
      const i = prev ? choose(candidates(prev.tail, m.n, reuse)) : -1;
      if (i >= 0) return { i, m, chained: true };
    }
    return null;
  };
  let got = prev && (tryAll(false) || tryAll(true));
  if (got && state.used.has(got.i)) state.reused++;
  if (!got) {
    if (prev) state.breaks++;
    const m = order[0], pool = byLen.get(m.n);
    got = { i: pool[Math.floor(Math.random() * pool.length)], m, chained: false };
  }
  state.used.add(got.i);
  if (state.used.size > E.length * 0.8) state.used.clear();
  state.prev = E[got.i];
  return got;
}

// ---------- 1枚を組む ----------
// block：{x,y,w,h（px、枠の内側）, c, r, fs, vert, e, start, chars:[{x,y,ch,j}], chained, prev}
let geo = null, piece = null, bake = null;
function makeGeo(W, H) {
  const m = Math.round(Math.min(W, H) * params.margin / 100);
  const S = Math.floor(Math.min(W, H) - 2 * m);
  return { W, H, S, ox: Math.round((W - S) / 2), oy: Math.round((H - S) / 2) };
}
function compose() {
  const leaves = divide(geo.S);
  const blocks = [];
  let total = 0;
  const gap = params.gap / 2;
  for (const lf of leaves) {
    // 字のマス目は、すき間を引いた内側で決め直す
    const iw = lf.w - 2 * gap, ih = lf.h - 2 * gap;
    const g = grids(iw, ih);
    if (!g.length) continue;
    const got = pickFor(g), m = got.m, e = E[got.i];
    const vert = m.r > m.c ? true : m.c > m.r ? false : Math.random() < 0.5;
    const b = { x: geo.ox + lf.x + gap, y: geo.oy + lf.y + gap, w: iw, h: ih, c: m.c, r: m.r, fs: m.fs, vert,
      outer: { x: geo.ox + lf.x, y: geo.oy + lf.y, w: lf.w, h: lf.h }, px: iw / m.c, py: ih / m.r,
      e, start: total, chained: got.chained, prev: blocks[blocks.length - 1] || null, chars: [] };
    const cw = iw / m.c, chh = ih / m.r;
    for (let j = 0; j < e.len; j++) {
      let col, row;
      if (vert) { col = m.c - 1 - Math.floor(j / m.r); row = j % m.r; }
      else { row = Math.floor(j / m.c); col = j % m.c; }
      b.chars.push({ x: b.x + (col + 0.5) * cw, y: b.y + (row + 0.5) * chh, ch: e.text[j], j, col, row });
    }
    total += e.len;
    blocks.push(b);
  }
  routeAll(blocks);
  return { blocks, total, shown: 0, cur: 0, phase: "write", phaseAt: 0 };
}

// ---------- しりとり線の道 ----------
// 線は字に重ならない所だけを通る：
//  ・すき間の道：ブロックの外形（すき間の中心線）の辺。隣のブロックの外形と重なって、すき間の網になる（正方形の外周も含む）
//  ・ブロックの中の道：字のマスの境目（行間・字間）。通ってよいのは、線の出どころ（尻のかなのブロック）と行き先（頭のかなのブロック）だけ
//  ・マスの境目の端から、外形の辺へまっすぐ出る短い道
// 尻のかなのマスの4辺の中点のどれかから、頭のかなのマスの4辺の中点のどれかまで、曲がる回数も数えた最短の道を探す（ダイクストラ法）。
// ブロックの中の道は少し割高にして、すぐすき間へ出るようにする。
function routeAll(blocks) {
  const nodes = [], idx = new Map();
  const node = (x, y) => {
    const k = `${Math.round(x * 4)}/${Math.round(y * 4)}`;
    let i = idx.get(k);
    if (i === undefined) { i = nodes.length; idx.set(k, i); nodes.push({ x, y, adj: [] }); }
    return i;
  };
  const edge = (a, b, owner) => {
    if (a === b) return;
    const A = nodes[a], B = nodes[b];
    const d = Math.abs(A.x - B.x) + Math.abs(A.y - B.y);
    A.adj.push({ to: b, d, owner }); B.adj.push({ to: a, d, owner });
  };
  const pts = [];   // すき間の道の上に乗る点（辺を区切る）
  for (const b of blocks) {
    const o = b.outer, L = (i, j) => node(b.x + i * b.px, b.y + j * b.py);
    pts.push([o.x, o.y], [o.x + o.w, o.y], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h]);
    for (let i = 0; i <= b.c; i++) for (let j = 0; j <= b.r; j++) {
      if (i < b.c) edge(L(i, j), L(i + 1, j), b);
      if (j < b.r) edge(L(i, j), L(i, j + 1), b);
    }
    for (let i = 0; i <= b.c; i++) {
      const x = b.x + i * b.px;
      pts.push([x, o.y], [x, o.y + o.h]);
      edge(L(i, 0), node(x, o.y), b); edge(L(i, b.r), node(x, o.y + o.h), b);
    }
    for (let j = 0; j <= b.r; j++) {
      const y = b.y + j * b.py;
      pts.push([o.x, y], [o.x + o.w, y]);
      edge(L(0, j), node(o.x, y), b); edge(L(b.c, j), node(o.x + o.w, y), b);
    }
    // 尻・頭のかなのマスの4辺の中点（線の端）
    b.ends = (ch) => {
      const x0 = b.x + ch.col * b.px, y0 = b.y + ch.row * b.py, x1 = x0 + b.px, y1 = y0 + b.py, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      return [[xm, y0, x0, y0, x1, y0], [xm, y1, x0, y1, x1, y1], [x0, ym, x0, y0, x0, y1], [x1, ym, x1, y0, x1, y1]].map(([mx, my, ax, ay, bx2, by2]) => {
        const m = node(mx, my);
        edge(m, node(ax, ay), b); edge(m, node(bx2, by2), b);
        return m;
      });
    };
  }
  // すき間の道：各ブロックの外形の辺を、その上に乗る点で区切ってつなぐ
  const E = 0.3;
  for (const b of blocks) {
    const o = b.outer;
    const sides = [[o.x, o.y, o.x + o.w, o.y], [o.x, o.y + o.h, o.x + o.w, o.y + o.h], [o.x, o.y, o.x, o.y + o.h], [o.x + o.w, o.y, o.x + o.w, o.y + o.h]];
    for (const [x0, y0, x1, y1] of sides) {
      const horiz = y0 === y1;
      const on = pts.filter(([x, y]) => horiz ? Math.abs(y - y0) < E && x > x0 - E && x < x1 + E : Math.abs(x - x0) < E && y > y0 - E && y < y1 + E)
        .map(([x, y]) => (horiz ? [x, y0] : [x0, y])).sort((a, c) => (horiz ? a[0] - c[0] : a[1] - c[1]));
      for (let k = 1; k < on.length; k++) edge(node(...on[k - 1]), node(...on[k]), null);
    }
  }
  for (let k = 1; k < blocks.length; k++) {
    const b = blocks[k], a = b.prev;
    b.path = b.chained && a ? route(nodes, a, b) : null;
  }
  const paths = blocks.map((b) => b.path).filter(Boolean);
  assignLanes(paths, params.gap);
  paths.forEach(finishPath);
}
const INNER_COST = 3;
function route(nodes, a, b) {
  const src = a.ends(a.chars[a.e.tailPos]), dst = new Set(b.ends(b.chars[b.e.headPos]));
  const turn = Math.min(a.fs, b.fs) * 0.8;
  const dirOf = (A, B) => (B.x > A.x + 1e-6 ? 0 : B.x < A.x - 1e-6 ? 1 : B.y > A.y ? 2 : 3);
  // 状態＝（点, 入ってきた向き）。向き 4 は始点
  const dist = new Map(), from = new Map(), ring = new Map(), heap = [];
  const push = (d, s) => { heap.push([d, s]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const sN of src) { const st = sN * 5 + 4; dist.set(st, 0); push(0, st); }
  let goal = -1;
  while (heap.length) {
    const [d, st] = pop();
    if (d > dist.get(st)) continue;
    const n = Math.floor(st / 5), dir = st % 5;
    if (dst.has(n)) { goal = st; break; }
    for (const ed of nodes[n].adj) {
      if (ed.owner && ed.owner !== a && ed.owner !== b) continue;
      const nd = dirOf(nodes[n], nodes[ed.to]);
      if (dir !== 4 && (nd ^ 1) === dir) continue;   // 引き返さない
      const cost = d + ed.d * (ed.owner ? INNER_COST : 1) + (dir !== 4 && nd !== dir ? turn : 0);
      const s2 = ed.to * 5 + nd;
      if (cost < (dist.get(s2) ?? Infinity)) { dist.set(s2, cost); from.set(s2, st); ring.set(s2, !ed.owner); push(cost, s2); }
    }
  }
  if (goal < 0) return null;
  // 点の並び（点の番号）と、各区間がすき間の網の上か
  const ids = [], onRing = [];
  for (let st = goal; st !== undefined; st = from.get(st)) { ids.push(Math.floor(st / 5)); if (from.has(st)) onRing.push(ring.get(st)); }
  ids.reverse(); onRing.reverse();
  return { ids, onRing, nodes, lw: Math.max(1, Math.min(a.fs, b.fs) * 0.06) };
}

// ---------- すき間の中で線をずらす（車線） ----------
// 同じすき間の区間を通る線は重なって1本に見えるので、線ごとに車線（すき間の中心からのずれ）を決める。
// 車線は線全体で1つ（すき間の網の上の区間だけをずらし、ブロックの中の区間はずらさない）。
// 車線の幅は線の太さの2倍（最低2.5px）、ずらせるのはすき間の半分から線の太さの半分を引いたところまで。
// 線を順に、すでにその車線を使っている線と共有する区間の数がいちばん少ない車線に入れる（0, +1, −1, +2, −2 … の順で同点なら近いほう）。
function assignLanes(paths, gap) {
  if (!paths.length) return;
  const lw = Math.max(...paths.map((p) => p.lw));
  const step = Math.max(2.5, lw * 2), maxOff = Math.max(0, gap / 2 - lw / 2);
  const lanes = [0];
  for (let k = 1; k * step <= maxOff + 1e-6; k++) lanes.push(k * step, -k * step);
  const keysOf = (p) => {
    const out = [];
    for (let k = 1; k < p.ids.length; k++) if (p.onRing[k - 1]) { const a = p.ids[k - 1], b = p.ids[k]; out.push(a < b ? `${a}-${b}` : `${b}-${a}`); }
    return out;
  };
  const use = lanes.map(() => new Set());
  for (const p of paths) {
    const keys = keysOf(p);
    let best = 0, bestN = Infinity;
    lanes.forEach((_, li) => { const n = keys.filter((k) => use[li].has(k)).length; if (n < bestN) { bestN = n; best = li; } });
    for (const k of keys) use[best].add(k);
    p.off = lanes[best];
  }
}
// 区間ごとのずれから折れ線を作る。直角に曲がる所は2本の線の交点、まっすぐ続くのにずれが変わる所は小さな段をつける
function finishPath(p) {
  const P = p.ids.map((i) => p.nodes[i]);
  const segs = [];
  for (let k = 1; k < P.length; k++) {
    const A = P[k - 1], B = P[k], horiz = Math.abs(A.y - B.y) < 1e-6, o = p.onRing[k - 1] ? p.off : 0;
    segs.push({ A, B, horiz, c: horiz ? A.y + o : A.x + o });
  }
  const pt = (s, Q) => (s.horiz ? [Q.x, s.c] : [s.c, Q.y]);
  const out = [pt(segs[0], segs[0].A)];
  for (let k = 1; k < segs.length; k++) {
    const s0 = segs[k - 1], s1 = segs[k];
    if (s0.horiz !== s1.horiz) out.push(s0.horiz ? [s1.c, s0.c] : [s0.c, s1.c]);
    else if (Math.abs(s0.c - s1.c) > 1e-6) out.push(pt(s0, s1.A), pt(s1, s1.A));
  }
  const last = segs[segs.length - 1];
  out.push(pt(last, last.B));
  let len = 0;
  for (let k = 1; k < out.length; k++) len += Math.abs(out[k][0] - out[k - 1][0]) + Math.abs(out[k][1] - out[k - 1][1]);
  p.pts = out; p.len = len;
  delete p.nodes;
}
function newPiece() {
  const canvas = $("c");
  geo = makeGeo(canvas.clientWidth, canvas.clientHeight);
  piece = compose();
  state.pieces++;
  const dpr = window.devicePixelRatio || 1;
  bake = document.createElement("canvas");
  bake.width = Math.round(geo.W * dpr); bake.height = Math.round(geo.H * dpr);
  bake.dpr = dpr; bake.upto = 0;
}
function rebake() {
  if (!piece || !bake) return;
  const c = bake.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, bake.width, bake.height);
  for (let k = 0; k < bake.upto; k++) drawBlock(c, piece.blocks[k], Infinity, bake.dpr);
}

// ---------- 描く ----------
const ROTATE = new Set([..."【】《》「」『』（）ー〜－―…"]);
const SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"]);
const PUNCT = new Set([..."、。，．"]);
const glyphOf = (c) => (c === "【" ? params.bracket[0] : c === "】" ? params.bracket[1] : c);
function putChar(c, ch, x, y, fs, vert) {
  const g = glyphOf(ch);
  if (!vert) return c.fillText(g, x, y);
  if (ROTATE.has(ch)) { c.save(); c.translate(x, y); c.rotate(Math.PI / 2); c.fillText(g, 0, 0); c.restore(); }
  else if (PUNCT.has(ch)) c.fillText(g, x + fs * 0.55, y - fs * 0.5);
  else if (SMALL_KANA.has(ch)) c.fillText(g, x + fs * 0.1, y - fs * 0.1);
  else c.fillText(g, x, y);
}
function colors() {
  const fg = params.inkColor, bg = params.bgColor;
  return { fg, bg, light: params.headEm ? mix(fg, bg, 0.45) : fg };
}
// ブロック b の先頭 n 字を描く
function drawBlock(c, b, n, dpr) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const col = colors();
  const fs = b.fs * GLYPH;
  c.font = FONT(fs); c.textAlign = "center"; c.textBaseline = "middle";
  const m = Math.min(n, b.chars.length);
  for (let q = 0; q < m; q++) {
    const ch = b.chars[q];
    c.fillStyle = ch.j < b.e.headLen ? col.fg : col.light;
    putChar(c, ch.ch, ch.x, ch.y, fs, b.vert);
  }
}
const PULSE_MS = 700, FADE_MS = 1000, LINK_MS = 450;
// しりとり線（尻のかなの側から伸びる。frac＝伸びた割合）
function drawLink(c, b, frac, dpr) {
  const P = b.path;
  if (!P || frac <= 0) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = params.lineColor; c.lineWidth = P.lw; c.lineJoin = "miter"; c.lineCap = "butt";
  c.beginPath(); c.moveTo(...P.pts[0]);
  let left = P.len * Math.min(1, frac);
  for (let k = 1; k < P.pts.length && left > 0; k++) {
    const [x0, y0] = P.pts[k - 1], [x1, y1] = P.pts[k], d = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (d <= left) { c.lineTo(x1, y1); left -= d; }
    else { const t = left / d; c.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); left = 0; }
  }
  c.stroke();
}
const pulseAmount = (at, now) => {
  if (at == null || now < at || now - at >= PULSE_MS) return 0;
  const t = (now - at) / PULSE_MS;
  return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
};
function drawPulse(c, b, j, amt, dpr) {
  if (!amt || !b) return;
  const ch = b.chars[j], col = colors(), cw = b.w / b.c, chh = b.h / b.r, fs = b.fs * GLYPH;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = amt;
  c.fillStyle = col.fg; c.fillRect(ch.x - cw / 2, ch.y - chh / 2, cw, chh);
  c.fillStyle = col.bg; c.font = FONT(fs); putChar(c, ch.ch, ch.x, ch.y, fs, b.vert);
  c.globalAlpha = 1;
}
function draw(c, W, H, now, live, dpr) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = params.bgColor; c.fillRect(0, 0, W, H);
  if (!piece) return;
  let alpha = 1;
  if (live && piece.phase === "fade") alpha = 1 - Math.min(1, (now - piece.phaseAt) / FADE_MS);
  c.globalAlpha = alpha;
  if (params.debug) {
    // 字の外側に1px広げた外枠。すき間の中心の車線（しりとり線）とは重ならない
    c.save();
    c.strokeStyle = params.debugColor; c.lineWidth = 1; c.setLineDash([2, 3]);
    const n = live ? Math.min(piece.cur + 1, piece.blocks.length) : piece.blocks.length;
    for (let k = 0; k < n; k++) { const b = piece.blocks[k]; c.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2); }
    c.restore();
  }
  if (!live) {
    for (const b of piece.blocks) drawBlock(c, b, Infinity, dpr);
    if (params.link) for (const b of piece.blocks) drawLink(c, b, 1, dpr);
    return;
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(bake, 0, 0);
  const b = piece.blocks[piece.cur];
  if (b && piece.cur >= bake.upto) drawBlock(c, b, Math.floor(piece.shown - b.start), dpr);
  if (params.link) for (let k = 0; k <= piece.cur && k < piece.blocks.length; k++) {
    const bb = piece.blocks[k];
    if (bb.pulseAt != null) drawLink(c, bb, now < bb.pulseAt ? 1 : (now - bb.pulseAt) / LINK_MS, dpr);
  }
  c.globalAlpha = alpha;
  // しりとりの強調：この項目の頭のかなと、前の項目の尻のかな
  for (let k = Math.max(0, piece.cur - 1); k <= piece.cur && k < piece.blocks.length; k++) {
    const bb = piece.blocks[k];
    const amt = pulseAmount(bb.pulseAt, now) * alpha;
    if (!amt || !bb.chained) continue;
    drawPulse(c, bb, bb.e.headPos, amt, dpr);
    if (bb.prev) drawPulse(c, bb.prev, bb.prev.e.tailPos, amt, dpr);
  }
  c.globalAlpha = 1;
}

// ---------- 進める ----------
function update(now, dt) {
  if (!piece) return;
  if (piece.phase === "write") {
    piece.shown = Math.min(piece.total, piece.shown + params.speed * dt);
    while (piece.cur < piece.blocks.length) {
      const b = piece.blocks[piece.cur];
      if (b.pulseAt == null && piece.shown > b.start + b.e.headPos) b.pulseAt = now;
      if (piece.shown < b.start + b.e.len) break;
      drawBlock(bake.getContext("2d"), b, Infinity, bake.dpr);   // 書き終えたブロックは焼き付ける
      bake.upto = ++piece.cur;
    }
    if (piece.cur >= piece.blocks.length) { piece.phase = "hold"; piece.phaseAt = now; }
  } else if (piece.phase === "hold") {
    if (now - piece.phaseAt > params.hold * 1000) { piece.phase = "fade"; piece.phaseAt = now; }
  } else if (piece.phase === "fade") {
    if (now - piece.phaseAt > FADE_MS) newPiece();
  }
}

const canvas = $("c"), ctx = canvas.getContext("2d");
let lastT = null, statusAt = 0, resizeAt = 0, sizeKey = "";
function frame(now) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const sk = `${W}x${H}x${dpr}`;
  if (sk !== sizeKey) { sizeKey = sk; resizeAt = now; }
  if (geo && (W !== geo.W || H !== geo.H) && now - resizeAt > 400) newPiece();
  const dt = lastT === null ? 0 : Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (running) update(now, dt);
  draw(ctx, W, H, now, true, dpr);
  if (now - statusAt > 300 && piece) {
    statusAt = now;
    const bl = piece.blocks, v = bl.filter((b) => b.vert).length;
    const fsz = bl.map((b) => b.fs);
    setStatus(`BLOCKS ${bl.length}  (縦 ${v} / 横 ${bl.length - v})  CHARS ${piece.total}  FONT ${Math.round(Math.min(...fsz))}–${Math.round(Math.max(...fsz))}px  #${state.pieces}\n` +
      `CHAINED ${bl.filter((b) => b.chained).length}/${bl.length}  REUSED ${state.reused}  BREAK ${state.breaks}`);
  }
  requestAnimationFrame(frame);
}

function saveScreenshot() {
  const dpr = Math.max(2, window.devicePixelRatio || 1), W = geo.W, H = geo.H;
  const off = document.createElement("canvas");
  off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
  draw(off.getContext("2d"), W, H, performance.now(), false, dpr);
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  const name = `nagori-yosegi-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
  off.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

// 確認用：?debug で window.__yosegi.advance(秒)（仮の時計）・finish()（今の1枚を書き終える）
if (new URLSearchParams(location.search).has("debug")) {
  window.__yosegi = {
    state, get piece() { return piece; }, newPiece, t: 0,
    advance(sec, step = 1 / 30) {
      this.t = Math.max(this.t, performance.now());
      for (let s = 0; s < sec; s += step) { this.t += step * 1000; update(this.t, step); }
    },
    finish() { piece.shown = piece.total; update(performance.now(), 0.01); },
  };
}
loadDict().then(async () => {
  const canvas = $("c");
  while (canvas.clientWidth < 50 || canvas.clientHeight < 50) await new Promise((r) => setTimeout(r, 200));
  newPiece();
  running = true;
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}`));
