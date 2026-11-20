// Nagori（余波）：shapetext の辞書版。辞書の項目（【見出し（よみ）】語釈。）を1列に1つずつ縦書きで置き、項目の字数だけで波を描く。
// 文章はどこも切らない。選んで並べるだけ。並べ方はしりとり（前の見出しの読みの尻のかなで始まる見出し）。
// 波は2つ、上下に向かい合う。上の波（赤）は上寄せで下端が波打ち、下の波（青）は下寄せで上端が波打つ。
// 青の列の字数＝（最短＋最長）−赤の目標なので、2つの波の縁はいつも「波の間隔」だけ離れて平行に揺れる。
// 周期・列の長さは共通。しりとりと使った語は波ごとに別（偶然同じ語が出ることはある）。
// 列は縦書きの本と同じく右から左へ進む。最初は枠の右端から書き始め、左端に届いたら全体が右へ流れ、
// 古い列は枠の右端の手前でフェードアウトする。枠のまわりの余白は上下左右で同じ。
// 一覧は dict/build_dict.py が作る web/dict.json（見出し・頭のかな・尻のかな・表示する文）。
const $ = (id) => document.getElementById(id);

// ---------- 設定 ----------
const params = {};
for (const id of ["minLen", "maxLen", "period", "margin", "size", "leading", "gap", "speed"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
// 波形はページを開くたびにランダム（選べる波形の中から）
{
  const opts = [...$("shape").options].map((o) => o.value);
  $("shape").value = opts[Math.floor(Math.random() * opts.length)];
}
params.shape = $("shape").value;
$("shape").addEventListener("change", (e) => (params.shape = e.target.value));
params.band = false;
params.headEm = $("headEm").checked; // 既定でオン（HTML 側で checked）
$("band").addEventListener("change", (e) => (params.band = e.target.checked));
$("headEm").addEventListener("change", (e) => (params.headEm = e.target.checked));
// 設定は画面中央のオーバーレイ。H キー・設定ボタンで開閉、Esc・背景のクリックで閉じる。
// 開いているあいだは描くのを止め、閉じたら（止める前に動いていれば）また動かす
let resumeOnClose = false;
function showPanel(on) {
  if (on === panelOpen()) return;
  $("panel").classList.toggle("hidden", !on);
  $("backdrop").classList.toggle("hidden", !on);
  if (on) { resumeOnClose = running; setRunning(false); }
  else {
    if (document.activeElement && $("panel").contains(document.activeElement)) document.activeElement.blur();
    if (resumeOnClose) setRunning(true);
  }
}
const panelOpen = () => !$("panel").classList.contains("hidden");
$("toggle").addEventListener("click", () => showPanel(!panelOpen()));
$("backdrop").addEventListener("click", () => showPanel(false));
document.addEventListener("keydown", (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
  if (ev.key === "Escape" && panelOpen()) { showPanel(false); return; }
  if (ev.key.toLowerCase() !== "h") return;
  if (ev.target.tagName === "SELECT" || ev.target.tagName === "TEXTAREA") return;
  ev.preventDefault();
  showPanel(!panelOpen());
});

// 作品の文字色・背景色（設定で変えられ、ブラウザに覚えておく。既定は白地に黒）
function applyColors() {
  $("stage").style.background = params.bgColor;
}
for (const id of ["inkColor", "bgColor"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  try { const saved = localStorage.getItem(`shapetext.${id}`); if (saved) el.value = saved; } catch {}
  const sync = () => {
    params[id] = el.value; out.textContent = "";
    try { localStorage.setItem(`shapetext.${id}`, el.value); } catch {}
    applyColors();
  };
  el.addEventListener("input", sync); sync();
}
// 2色を混ぜる（「語釈を薄く」用）
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

const log = (msg) => { const el = $("log"); el.textContent = `${msg}\n` + el.textContent.slice(0, 4000); };
const setStatus = (msg) => ($("status").textContent = msg);

// ---------- 形：通算 r 行目の目標の字数 ----------
// 位相は 0〜1。位相0で「中央から上がり始める」ようにそろえてある（実際の始まりの位相は phase0 でランダム）
function wave(p) {
  if (params.shape === "triangle") return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  if (params.shape === "saw") return 2 * ((p + 0.5) % 1) - 1;
  if (params.shape === "abs") return 2 * Math.abs(Math.sin(Math.PI * p)) - 1; // |sin|：谷がとがり、山が丸い（1周期に山1つ）
  if (params.shape === "square") return p < 0.5 ? 1 : -1;                     // 矩形波：長い列の段と短い列の段が交互
  return Math.sin(2 * Math.PI * p);
}
// 画面に合わせた列の字数。字の大きさ（px）と余白を守ったまま、2つの波（最短＋最長＋間隔）が枠の高さに
// 入りきらないときは、最短・最長・間隔を同じ比率のまま縮める（窓が低いほど波は短くなる）。
// 辞書の項目は6字未満が無いので、最短は8字より短くしない。それでも入らなければ字を小さくする
const MIN_FLOOR = 8;
function fit(W, H) {
  const lo0 = Math.min(params.minLen, params.maxLen), hi0 = Math.max(params.minLen, params.maxLen), gap0 = params.gap;
  const m = Math.round(Math.min(W, H) * params.margin / 100);   // 余白のいちばん小さい幅
  let cell = params.size;
  const avail = Math.floor((H - 2 * m) / cell);                  // 縦に入る字数
  let lo = lo0, hi = hi0, gap = gap0;
  if (lo + hi + gap > avail) {
    const k = avail / (lo0 + hi0 + gap0);
    lo = Math.max(MIN_FLOOR, Math.round(lo0 * k));
    hi = Math.max(lo + 2, Math.round(hi0 * k));
    gap = Math.max(0, avail - lo - hi);
    if (lo + hi + gap > avail) cell = Math.max(2, (H - 2 * m) / (lo + hi + gap)); // どうしても入らないときだけ字を縮める
  }
  return { lo, hi, gap, cell, shrunk: lo !== lo0 || hi !== hi0 || gap !== gap0 };
}
const fitNow = () => fit(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
const range = () => { const f = fitNow(); return [f.lo, f.hi]; };
// 波の始まりの位相は、開くたび・「最初から」のたびにランダム（毎回同じ形から始まらないように）
let phase0 = Math.random();
function target(r, side) {
  const [lo, hi] = range();
  const p = ((r / params.period + phase0) % 1 + 1) % 1;
  const red = Math.max(1, Math.round((lo + hi) / 2 + ((hi - lo) / 2) * wave(p)));
  return side === "blue" ? Math.max(1, lo + hi - red) : red;
}

// ---------- 辞書 ----------
let E = [];                 // [{word, head, tail, text, len, headLen, headPos, tailPos}]
const inv = new Map();      // "頭のかな|字数" → 項目の番号の配列
const key = (h, n) => `${h}|${n}`;
const stockOf = (h, n) => (inv.get(key(h, n)) || []).length;
let byLen = null;           // 字数 → 項目の番号の配列（しりとりの始まりに使う）

// しりとりのかなが表示する文の何文字目にあるか。
// 【反戦的（はんせんてき）】→ 読みの中。【きりはなす】→ 見出しそのもの。尻は長音「ー」を飛ばす（インパクター→タ）
function kanaPositions(text) {
  const close = text.indexOf("】");
  const open = text.indexOf("（");
  const [s, e] = open > 0 && open < close ? [open + 1, text.indexOf("）")] : [1, close];
  let t = e - 1;
  while (t > s && text[t] === "ー") t--;
  return { headPos: s, tailPos: t };
}

async function loadDict() {
  setStatus("辞書を読み込み中…");
  const d = await (await fetch("dict.json")).json();
  // 句読点も飾りかっこも1字として数え、そのまま表示する（build_dict.py と同じ）
  E = d.entries.map(([word, head, tail, text]) =>
    ({ word, head, tail, text, len: text.length, headLen: text.indexOf("】") + 1, ...kanaPositions(text) }));
  byLen = new Map();
  E.forEach((e, i) => {
    const k = key(e.head, e.len);
    if (!inv.has(k)) inv.set(k, []);
    inv.get(k).push(i);
    if (!byLen.has(e.len)) byLen.set(e.len, []);
    byLen.get(e.len).push(i);
  });
  $("credit").innerHTML = `${d.source}。<a href="https://ja.wiktionary.org/" target="_blank" rel="noopener">ja.wiktionary.org</a> / <a href="https://kaikki.org/" target="_blank" rel="noopener">kaikki.org</a>`;
  setStatus(`辞書 ${E.length.toLocaleString()} 項目`);
}

// ---------- 波ごとの流れ（しりとりの列） ----------
// 行：{i, target, chained, blank, pulseAt}。blank は行き詰まったときの空行（項目なし）。
const newStream = (side, name) => ({ side, name, rows: [], used: new Set(), exact: 0, off1: 0, off2: 0, reused: 0, restarts: 0 });
let streams = [newStream("red", "赤"), newStream("blue", "青")];
// 2つの波の行はいつも同じ数。rowBase は捨てた行の数、progress は「何行目まで書いたか」（小数は行の途中）
const state = { rowBase: 0, progress: 0 };
const rowLen = (row) => (!row || row.blank ? 0 : E[row.i].len);

// 前の項目の尻のかなで始まり、目標の字数ぴったりで、まだ使っていない項目から選ぶ。
// 次の2行で詰まりにくい（尻のかなで始まる項目が多い）ものを優先する。
// 無ければ字数を ±1、±2 までゆるめ、それでも無ければ使った項目も許す（緊急時は同じ語でよい）。
function chain(s, prev, r) {
  const t = target(r, s.side);
  const tries = [[0, false], [1, false], [-1, false], [2, false], [-2, false], [0, true], [1, true], [-1, true], [2, true], [-2, true]];
  for (const [d, reuse] of tries) {
    const list = inv.get(key(prev.tail, t + d)) || [];
    const cands = reuse ? list : list.filter((i) => !s.used.has(i));
    if (!cands.length) continue;
    const scored = cands.map((i) => [i, Math.min(stockOf(E[i].tail, target(r + 1, s.side)), stockOf(E[i].tail, target(r + 2, s.side)))]);
    scored.sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, Math.max(5, Math.ceil(scored.length / 3)));
    if (d === 0) s.exact++; else if (Math.abs(d) === 1) s.off1++; else s.off2++;
    if (reuse) { s.reused++; log(`${s.name}：同じ語を使った（「${prev.word}」の次）`); }
    return top[Math.floor(Math.random() * top.length)][0];
  }
  return -1;
}

// しりとりの始まり：目標の字数の項目からランダム（＝ランダムなかなから再開）
function fresh(s, r) {
  const t = target(r, s.side);
  for (const d of [0, 1, -1, 2, -2]) {
    const unused = (byLen.get(t + d) || []).filter((i) => !s.used.has(i));
    if (unused.length) return unused[Math.floor(Math.random() * unused.length)];
  }
  return Math.floor(Math.random() * E.length);
}

function addRow(s, r) {
  const prevRow = s.rows[s.rows.length - 1];
  let i = -1, chained = false;
  if (prevRow && !prevRow.blank) {
    const prev = E[prevRow.i];
    // 「ん」で終わったら、または緊急策でも続かなければ、1行あけてランダムなかなから再開する
    if (prev.tail !== "ん") i = chain(s, prev, r);
    if (i < 0) {
      s.restarts++;
      log(`${s.name}：${prev.tail === "ん" ? `「${prev.word}」が「ん」で終わった` : `「${prev.word}」の次が見つからない`} → 1行あけて再開`);
      s.rows.push({ i: -1, target: target(r, s.side), blank: true });
      return;
    }
    chained = true;
  } else {
    i = fresh(s, r);
  }
  s.used.add(i);
  if (s.used.size > E.length * 0.8) s.used.clear(); // ほぼ使い切ったら最初から
  s.rows.push({ i, target: target(r, s.side), chained, pulseAt: null });
}

const rowCount = () => streams[0].rows.length;
function addRowPair() {
  const r = state.rowBase + rowCount();
  for (const s of streams) addRow(s, r);
}

// 2つの波は同じ行を同時に書き始め、同時に書き終える（字数に比例して進む）。表示速度は2つの合計
function advance(dt) {
  let budget = params.speed * dt;
  while (budget > 0) {
    while (rowCount() < Math.floor(state.progress) + 4) addRowPair(); // 少し先まで並べておく
    const cur = Math.floor(state.progress), frac = state.progress - cur;
    const total = Math.max(1, streams.reduce((n, s) => n + rowLen(s.rows[cur]), 0));
    const need = (1 - frac) * total;
    if (budget >= need) { state.progress = cur + 1; budget -= need; }
    else { state.progress += budget / total; budget = 0; }
  }
}
// 行 i で表示している字数
function shownIn(s, i) {
  const cur = Math.floor(state.progress);
  const len = rowLen(s.rows[i]);
  return i < cur ? len : i > cur ? 0 : Math.floor((state.progress - cur) * len);
}

// 状態は短く1〜2行。実際に使っている列の字数（画面に合わせて縮めたときは FIT）と、字数ぴったりの割合
function updateStatus() {
  const f = fitNow();
  const exact = streams.map((s) => `${s.side.toUpperCase()} ${Math.round((100 * s.exact) / (s.exact + s.off1 + s.off2 || 1))}%`).join(" ");
  setStatus(`LEN ${f.lo}–${f.hi}  GAP ${f.gap}${f.shrunk ? "  (FIT)" : ""}\nEXACT ${exact}  COLS ${state.rowBase + rowCount()}`);
}

// ---------- 開始・停止 ----------
let running = false;
function setRunning(on) {
  running = on;
}
// Space キーで開始・停止（チェックボックスや選択欄の操作中は除く）
document.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space" || ev.repeat) return;
  const t = ev.target;
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type === "checkbox")) return;
  ev.preventDefault(); // フォーカスのあるボタンが押されたり、ページがスクロールしたりしないように
  if (E.length) setRunning(!running);
});
$("reset").addEventListener("click", () => {
  streams = [newStream("red", "赤"), newStream("blue", "青")];
  Object.assign(state, { rowBase: 0, progress: 0 });
  flow = 0; flowTotal = 0;
  phase0 = Math.random();
  $("log").textContent = "";
  updateStatus();
});

// ---------- 表示（縦書き） ----------
const canvas = $("c"), ctx = canvas.getContext("2d");
let flow = 0, last = performance.now(), statusAt = 0; // flow：全体が右へ流れた量（px）。古い列を捨てると減る
let flowTotal = 0; // 書き始めてから流れた量の合計（列を捨てても減らない）。フェードを効かせ始める判断に使う
const PULSE_MS = 600; // しりとりのかなを強調する時間
// 強調の濃さ（0〜1）：はじめの6割は白黒反転のまま、残りで元に戻る
const pulseAmount = (at, now) => {
  if (at === null || at === undefined || now - at >= PULSE_MS) return 0;
  const t = (now - at) / PULSE_MS;
  return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
};
const BAND = { red: "rgba(232, 52, 36, 0.14)", blue: "rgba(90, 135, 225, 0.16)" };

// 縦書きの字形：句読点は右上に寄せ、かっこと長音は90度回し、小さいかなは少し右上に寄せる
const ROTATE = new Set([..."【】（）ー〜－―…"]);
const SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"]);
const PUNCT = new Set([..."、。，．"]);

// 枠と大きさ。2つの波（上下で最短＋最長＋間隔の字数）を、上下左右同じ幅の余白の内側に入れる。
// 字の大きさは設定の px。列の字数は fit() で画面に合わせる。余りは余白になる（上下左右同じ幅）
function layout(W, H) {
  const f = fit(W, H);
  const rows = f.lo + f.hi + f.gap;                // 縦に並ぶ字数
  const cell = f.cell;                             // 1字の大きさ（縦）
  const m = Math.max(0, (H - rows * cell) / 2);    // 実際の余白（上下左右とも）
  const pitch = cell * 1.3 * params.leading;       // 列送り（横）
  return { m, cell, pitch, top: m, bottom: H - m, left: m, right: W - m, fadeW: (W - 2 * m) * 0.15 };
}
// 列 i（今持っている列の何番目か）の右端の x。最初の列は枠の右端、あとは左へ。flow だけ右へ流れる
const colRight = (L, i) => L.right - i * L.pitch + flow;

// 状態を進める（時間・流れ・捨てる列）。描くのとは分ける（スクリーンショットで同じ絵を描き直すため）
function update(now, dt, W, H) {
  if (running) {
    advance(dt);
    if (now - statusAt > 500) { updateStatus(); statusAt = now; }
  }
  const L = layout(W, H);
  // いま書いている列の左端が枠の左端より外に出ないところまで、全体を右へ流す
  const want = Math.max(0, (state.progress + 1) * L.pitch - (L.right - L.left));
  const step = (want - flow) * Math.min(1, dt * 3);
  flow += step;
  flowTotal += Math.max(0, step);
  // 枠の右端より外に出た列は捨てる（40列たまるごと）
  const gone = Math.floor((flow - L.pitch) / L.pitch);
  if (gone >= 40) {
    const n = Math.min(gone, Math.floor(state.progress) - 1);
    if (n > 0) {
      for (const s of streams) s.rows.splice(0, n);
      state.rowBase += n;
      state.progress -= n;
      flow -= n * L.pitch;
    }
  }
}

// 描く。live=false のとき（スクリーンショット）は、フェード・カーソル・強調なしで、枠の中の文字をはっきり描く
function draw(c, W, H, now, live) {
  const L = layout(W, H);
  const ink = params.inkColor, bg = params.bgColor, muted = mix(ink, bg, 0.55);
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  c.save();
  c.beginPath(); c.rect(L.left, L.top, L.right - L.left, L.bottom - L.top); c.clip(); // 余白には何もはみ出さない
  c.font = `${L.cell * 0.9}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";

  // 1字を描く（縦書きの字形にして）。pulse（0〜1）があれば、そのマスを一瞬だけ白黒反転する
  function glyph(ch, x, y, color, pulse, alpha) {
    c.globalAlpha = alpha;
    const put = (fill) => {
      c.fillStyle = fill;
      if (ROTATE.has(ch)) { c.save(); c.translate(x, y); c.rotate(Math.PI / 2); c.fillText(ch, 0, 0); c.restore(); }
      else if (PUNCT.has(ch)) c.fillText(ch, x + L.cell * 0.55, y - L.cell * 0.55);
      else if (SMALL_KANA.has(ch)) c.fillText(ch, x + L.cell * 0.1, y - L.cell * 0.1);
      else c.fillText(ch, x, y);
    };
    put(color);
    if (pulse) {
      c.globalAlpha = alpha * pulse;
      c.fillStyle = ink; c.fillRect(x - L.cell * 0.55, y - L.cell / 2, L.cell * 1.1, L.cell);
      put(bg);
    }
    c.globalAlpha = 1;
  }
  // 枠の右端に近づいた列は薄くし、枠の端でちょうど消える。書き始め（まだ流れていない）ときは薄くしない
  // flow は古い列を捨てるたびに減るので、flow で判断すると捨てた直後にフェードが切れ、端でぱつっと消えていた
  const fadeOn = Math.min(1, flowTotal / L.fadeW);
  const colAlpha = (xr) => {
    if (!live) return 1;
    const raw = Math.max(0, Math.min(1, (L.right - xr) / L.fadeW));
    return 1 - (1 - raw) * fadeOn;
  };

  const n = rowCount();
  for (const s of streams) {
    for (let i = 0; i < n; i++) {
      const xr = colRight(L, i);
      if (xr - L.pitch > L.right) continue;  // 枠の右の外
      if (xr < L.left) break;                // 枠の左の外（まだ書いていない列）
      const row = s.rows[i];
      const cx = xr - L.pitch / 2;
      const a = colAlpha(xr);
      const len = rowLen(row);
      // 字の並び始めの y：赤は枠の上端から、青は枠の下端から字数ぶん上
      const y0 = s.side === "red" ? L.top : L.bottom - len * L.cell;
      if (params.band) {
        c.globalAlpha = a; c.fillStyle = BAND[s.side];
        c.fillRect(cx - L.cell / 2, s.side === "red" ? L.top : L.bottom - row.target * L.cell, L.cell, row.target * L.cell);
        c.globalAlpha = 1;
      }
      if (row.blank) continue;
      const e = E[row.i];
      const shown = shownIn(s, i);
      // この列の頭のかなが書かれた瞬間に、前の列の尻のかなと一緒に強調を始める
      if (live && row.chained && row.pulseAt === null && shown > e.headPos) row.pulseAt = now;
      const p = live ? pulseAmount(row.pulseAt, now) : 0;
      const next = s.rows[i + 1];
      const q = live && next && next.chained ? pulseAmount(next.pulseAt, now) : 0;
      for (let k = 0; k < shown; k++) {
        const color = params.headEm && k >= e.headLen ? muted : ink;
        const pulse = (k === e.headPos ? p : 0) || (k === e.tailPos ? q : 0);
        glyph(e.text[k], cx, y0 + (k + 0.5) * L.cell, color, pulse, a);
      }
      // カーソル（点滅）
      if (live && running && i === Math.floor(state.progress) && Math.floor(now / 500) % 2 === 0 && shown < len) {
        c.fillStyle = ink; c.globalAlpha = 0.35;
        c.fillRect(cx - L.cell / 2 + 1, y0 + shown * L.cell + 1, L.cell - 2, L.cell - 2);
        c.globalAlpha = 1;
      }
    }
  }
  c.restore();
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
  update(now, dt, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx, W, H, now, true);
  requestAnimationFrame(frame);
}

// ---------- スクリーンショット（S キー） ----------
// 画面と同じ大きさ・解像度で、フェード・カーソル・強調を外して描き直し、PNG で保存する
function saveScreenshot() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const off = document.createElement("canvas");
  off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
  const c = off.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(c, W, H, performance.now(), false);
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  const name = `nagori-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
  off.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`保存した：${name}`);
  }, "image/png");
}
document.addEventListener("keydown", (ev) => {
  if (ev.key.toLowerCase() !== "s" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(ev.target.tagName) && ev.target.type !== "range" && ev.target.type !== "checkbox") return;
  ev.preventDefault();
  if (E.length) saveScreenshot();
});

loadDict().then(() => {
  updateStatus();
  setRunning(true); // 開いたらすぐ始める
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}（先に dict/build_dict.py を実行）`));
