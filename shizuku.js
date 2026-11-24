// Nagori / Shizuku（雫）：辞書の項目（【見出し（よみ）】語釈。）を、しりとり線でつないで上から吊るす。
// 新しい語は画面の上で1字ずつ書かれ、上の吊り元（画面の外）に尻のかなで吊られる。前の語（すぐ下にぶら下がっている）は、
// 尻のかなと、新しい語の頭のかなを結ぶしりとり線で、新しい語にぶら下がる。こうして鎖は上へ伸びる。
// 鎖が CHAIN 語を超えたら、いちばん下の線（いちばん古い語の尻 ↔ その上の語の頭）が切れて、いちばん古い語が落ちる。
// 落ちた語は底に積もる。積もった山が鎖に近づいたら、底が抜けて山は下へ落ちていく（しりとりは続く）。
// 物理は planck.js（Box2D の移植）。語のかたまり＝1つの剛体（太さ1字の細長い箱）、しりとり線＝長さの上限がある紐（RopeJoint）。
// 吊られているあいだは回らない（横書きのまま読める）。線が切れたら回るようになり、転がりながら落ちる。
// 座標は「字1つ＝1」の世界座標（枠の左上が原点、y は下向き）で持ち、物理には S（m/字）をかけて渡す。
import { World, Vec2, Box, RopeJoint } from "https://cdn.jsdelivr.net/npm/planck@1.4.3/dist/planck.mjs";

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
for (const id of ["minLen", "maxLen", "chain", "linkLen", "gravity", "size", "margin", "speed"]) {
  const el = $(id), out = el.parentElement.querySelector(".v");
  const sync = () => { params[id] = Number(el.value); out.textContent = el.value; };
  el.addEventListener("input", sync); sync();
}
// 字の大きさ・余白を変えたら最初から（枠が変わる）
for (const id of ["size", "margin"]) $(id).addEventListener("change", () => reset());
$("gravity").addEventListener("input", () => world && world.setGravity(Vec2(0, G * params.gravity)));
// SHATTER：落ちた語が何かに当たったら、字ごとの体に砕ける
params.shatter = $("shatter").checked;
$("shatter").addEventListener("change", (e) => (params.shatter = e.target.checked));
params.headEm = $("headEm").checked;
$("headEm").addEventListener("change", (e) => (params.headEm = e.target.checked));
params.bracket = $("bracket").value;
$("bracket").addEventListener("change", (e) => (params.bracket = e.target.value));
params.guide = $("band").checked;
$("band").addEventListener("change", (e) => (params.guide = e.target.checked));
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
const byHead = new Map();         // 頭のかな → 項目の番号
const headTotal = new Map();      // 頭のかな → 項目の数（尻のかなの詰まりにくさ）
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
  // 「ん」で終わる語は使わない（Uzu・Kuruwa と同じ）
  E = d.entries.filter((x) => x[2] !== "ん").map(([word, head, tail, text]) =>
    ({ word, head, tail, text, len: text.length, headLen: text.indexOf("】") + 1, ...kanaPositions(text) }));
  E.forEach((e, i) => {
    if (!byHead.has(e.head)) byHead.set(e.head, []);
    byHead.get(e.head).push(i);
    headTotal.set(e.head, (headTotal.get(e.head) || 0) + 1);
  });
  $("credit").innerHTML = `${d.source}。<a href="https://ja.wiktionary.org/" target="_blank" rel="noopener">ja.wiktionary.org</a> / <a href="https://kaikki.org/" target="_blank" rel="noopener">kaikki.org</a>`;
  setStatus("LOADING FONT…");
  await loadFont(E.map((e) => e.text));
  setStatus("");
}

// ---------- しりとり ----------
const used = new Set();
const stats = { words: 0, reused: 0, restarts: 0, fallen: 0, drains: 0, shattered: 0 };
// 詰まりにくい尻のかな（そのかなで始まる語が多い）を優先し、上位からランダム
function choose(list) {
  const scored = list.map((i) => [i, headTotal.get(E[i].tail) || 0]).sort((a, b) => b[1] - a[1]);
  const top = scored.slice(0, Math.max(5, Math.ceil(scored.length / 3)));
  return top[Math.floor(Math.random() * top.length)][0];
}
const lenRange = () => {
  const hi = Math.max(8, Math.min(params.maxLen, Math.floor(geo.Fw - 2)));
  return [Math.min(params.minLen, hi), hi];
};
function pickNext(prev) {
  const [lo, hi] = lenRange();
  const ok = (i) => E[i].len >= lo && E[i].len <= hi;
  if (prev) {
    const all = (byHead.get(prev.tail) || []).filter(ok);
    const fresh = all.filter((i) => !used.has(i));
    if (fresh.length) return { i: choose(fresh), chained: true };
    if (all.length) { stats.reused++; return { i: choose(all), chained: true }; }
    stats.restarts++;
  }
  for (let k = 0; k < 5000; k++) {
    const i = Math.floor(Math.random() * E.length);
    if (ok(i) && !used.has(i)) return { i, chained: false };
  }
  return { i: Math.floor(Math.random() * E.length), chained: false };
}

// ---------- 世界 ----------
const S = 0.25;      // 1字＝0.25m（Box2D は 0.1〜10m の物に合わせてある。語は 3〜15m の棒になる）
const G = 10;        // 重力（m/s²）＝ 40字/s²
const HY = 0.46;     // 箱の半分の厚み（字）。わずかに薄くして、積もったときに字の間が詰まって見えるように
const STEP = 1 / 60;
const PULSE_MS = 600, LINK_MS = 450, CUT_MS = 450, CUT_DELAY = 500, WAIT_MS = 300, DRAIN_MS = 1400;
const LOWER_RATE = 8; // 吊り元の紐を伸ばす速さ（字/s）

let geo = null, world = null, anchor = null, ground = null;
let chain = [];       // 吊られている語（古い→新しい）。node：{e, i, chained, body, up:{joint, upper}, x0, y0, n, at}
let cur = null;       // いま書いている語（まだ体がない）
let hook = null;      // 吊り元の紐 {joint, node, target}
let fallen = [];      // 落ちている語（動いている）
let pile = [];        // 積もって止まった語（静的な体、焼き付け済み）
let pulses = [];      // しりとりの強調 {node, j, at}
let cuts = [];        // 切れた線の縮む動き {lower, upper, at}
let pending = null;   // 書いている語へ伸びる線 {lower, upper(cur), at}
let waitUntil = 0, cutAt = null, drain = null;
let acc = 0, simTime = 0;

function makeGeo(W, H) {
  const m = Math.round(Math.min(W, H) * params.margin / 100);
  const cell = params.size;
  const Fw = (W - 2 * m) / cell, Fh = (H - 2 * m) / cell;
  const ox = (W - Fw * cell) / 2, oy = (H - Fh * cell) / 2;
  // 吊り元は画面の上端（枠の外）。鎖は下へ行くほど左へずれる（頭のかなは尻のかなより左にある）ので、少し右に置く
  const ax = Fw / 2 + Math.min(10, Fw * 0.12), ay = -oy / cell - 0.5;
  return { W, H, cell, ox, oy, Fw, Fh, ax, ay, hook0: 0.8 - ay };
}
const V = (x, y) => Vec2(x * S, y * S);
// 語の体の中での点（字の座標。体の中心が原点）
const localX = (e, j) => j + 0.5 - e.len / 2;
const tailTop = (e) => V(localX(e, e.tailPos), -0.5);
const headBottom = (e) => V(localX(e, e.headPos), 0.5);

function makeBounds() {
  const { Fw, Fh } = geo;
  ground = world.createBody({ type: "static" });
  ground.createFixture(Box((Fw / 2 + 4) * S, 0.5 * S, V(Fw / 2, Fh + 0.5), 0), { friction: 0.8 });
  ground.createFixture(Box(0.5 * S, Fh * 2 * S, V(-0.5, Fh), 0), { friction: 0.3 });
  ground.createFixture(Box(0.5 * S, Fh * 2 * S, V(Fw + 0.5, Fh), 0), { friction: 0.3 });
}
function makeBody(nd, x, y, angle) {
  const b = world.createBody({ type: "dynamic", position: V(x, y), angle, fixedRotation: true, linearDamping: 0.6, angularDamping: 0.05 });
  b.createFixture(Box(nd.e.len / 2 * S, HY * S), { density: 1, friction: 0.7, restitution: 0.05 });
  b.nd = nd;
  nd.body = b;
  return b;
}
// 落ちた語が、鎖の語以外の何か（底・壁・山・ほかの落ちている語や字）に触れたら、砕く印を付ける（体を消すのは step の後）
const toShatter = new Set();
function onContact(c) {
  const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
  const mark = (x, other) => {
    const nd = x.nd;
    if (!nd || nd.shard || !nd.falling || !params.shatter) return;
    if (other.nd && other.nd.inChain) return;
    toShatter.add(nd);
  };
  mark(a, b); mark(b, a);
}
// 語の体を消して、字ごとの体（太さ・幅とも 0.92字の箱）に置き換える。速さは語の体の各点の速さを受け継ぐ
const SHARD_HALF = 0.46;
function shatter(nd) {
  const b = nd.body;
  if (!b || nd.dead) return;
  const p = b.getPosition(), a = b.getAngle(), v = b.getLinearVelocity(), w = b.getAngularVelocity();
  const co = Math.cos(a), si = Math.sin(a);
  nd.shards = [];
  for (let j = 0; j < nd.e.len; j++) {
    const lx = localX(nd.e, j) * S, rx = co * lx, ry = si * lx;
    const sb = world.createBody({ type: "dynamic", position: Vec2(p.x + rx, p.y + ry), angle: a, linearDamping: 0.05, angularDamping: 0.1 });
    sb.createFixture(Box(SHARD_HALF * S, SHARD_HALF * S), { density: 1, friction: 0.6, restitution: 0.1 });
    // 少しだけ散らす
    sb.setLinearVelocity(Vec2(v.x - w * ry + (Math.random() - 0.5) * 0.6, v.y + w * rx + (Math.random() - 0.5) * 0.6));
    sb.setAngularVelocity(w + (Math.random() - 0.5) * 4);
    const sh = { shard: true, e: nd.e, j, body: sb, falling: true, fellAt: simTime, parent: nd };
    sb.nd = sh;
    nd.shards.push(sh);
    fallen.push(sh);
  }
  world.destroyBody(b);
  nd.body = null;
  nd.shattered = true;
  const k = fallen.indexOf(nd);
  if (k >= 0) fallen.splice(k, 1);
  stats.shattered++;
}
const rope = (a, b, la, lb, maxLength) =>
  world.createJoint(new RopeJoint({ bodyA: a, bodyB: b, localAnchorA: la, localAnchorB: lb, maxLength: maxLength * S, collideConnected: false }));

// ---------- 開始・リセット ----------
let pileLayer = null, styleKey = "";
function newLayer() {
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.width = Math.round(geo.W * dpr); cv.height = Math.round(geo.H * dpr);
  return { canvas: cv, ctx: cv.getContext("2d"), dpr };
}
function reset() {
  geo = makeGeo(canvas.clientWidth, canvas.clientHeight);
  world = new World({ gravity: Vec2(0, G * params.gravity) });
  world.on("begin-contact", onContact);
  toShatter.clear();
  anchor = world.createBody({ type: "static", position: V(geo.ax, geo.ay) });
  makeBounds();
  chain = []; cur = null; hook = null; fallen = []; pile = []; pulses = []; cuts = []; pending = null;
  waitUntil = 0; cutAt = null; drain = null; acc = 0;
  used.clear();
  Object.assign(stats, { words: 0, reused: 0, restarts: 0, fallen: 0, drains: 0, shattered: 0 });
  pileLayer = newLayer(); styleKey = styleOf();
  startWord(simTime);
}

// ---------- 書く・吊るす・切る ----------
function startWord(now) {
  const top = chain[chain.length - 1] || null;
  const { i, chained } = pickNext(top && top.e);
  used.add(i);
  if (used.size > E.length * 0.8) used.clear();
  stats.words++;
  const e = E[i];
  // 尻のかなが吊り元の真下に来るように置く。枠からはみ出すなら内へ寄せる
  let x0 = geo.ax - (e.tailPos + 0.5);
  x0 = Math.max(0.5, Math.min(geo.Fw - e.len - 0.5, x0));
  cur = { e, i, chained: chained && !!top, x0, y0: geo.hook0 + geo.ay, n: 0, at: now };
  // しりとりが切れた（つながる語がない）ときは、吊られている鎖を丸ごと落とす
  if (top && !cur.chained) dropAll(now);
  // 前の語を、新しい語が入るぶん下げる（吊り元の紐を伸ばす）
  if (hook) hook.target = geo.hook0 + 1 + params.linkLen;
}
function attach(now) {
  const nd = cur;
  cur = null;
  const b = makeBody(nd, nd.x0 + nd.e.len / 2, nd.y0 + 0.5, 0);
  const lower = chain[chain.length - 1] || null;
  if (lower && nd.chained) {
    const pa = b.getWorldPoint(headBottom(nd.e)), pb = lower.body.getWorldPoint(tailTop(lower.e));
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) / S;
    lower.up = { joint: rope(b, lower.body, headBottom(nd.e), tailTop(lower.e), Math.max(params.linkLen, d)), upper: nd };
  }
  pending = null;
  if (hook) world.destroyJoint(hook.joint);
  const ta = b.getWorldPoint(tailTop(nd.e));
  const d0 = Math.hypot(ta.x - geo.ax * S, ta.y - geo.ay * S) / S;
  hook = { joint: rope(anchor, b, Vec2(0, 0), tailTop(nd.e), d0), node: nd, target: d0, len: d0 };
  chain.push(nd);
  nd.inChain = true;
  if (chain.length > params.chain && cutAt === null) cutAt = now + CUT_DELAY;
  waitUntil = now + WAIT_MS;
}
// いちばん下の線を切る
function cutBottom(now) {
  const nd = chain.shift();
  if (!nd) return;
  if (nd.up) {
    world.destroyJoint(nd.up.joint);
    cuts.push({ lower: nd, upper: nd.up.upper, at: now });
    pulses.push({ node: nd, j: nd.e.tailPos, at: now }, { node: nd.up.upper, j: nd.up.upper.e.headPos, at: now });
    nd.up = null;
  }
  release(nd);
}
function release(nd) {
  const b = nd.body;
  b.setFixedRotation(false);
  b.setLinearDamping(0.02);
  b.setAngularVelocity((Math.random() - 0.5) * 1.2);
  b.setAwake(true);
  nd.inChain = false;
  nd.falling = true;
  nd.fellAt = simTime;
  fallen.push(nd);
  stats.fallen++;
}
function dropAll(now) {
  if (hook) { world.destroyJoint(hook.joint); hook = null; }
  for (const nd of chain) {
    if (nd.up) { world.destroyJoint(nd.up.joint); cuts.push({ lower: nd, upper: nd.up.upper, at: now }); nd.up = null; }
    release(nd);
  }
  chain = []; cutAt = null; pending = null;
}

// ---------- 積もる・底が抜ける ----------
function aabbOf(b) {
  const f = b.getFixtureList();
  const a = f.getAABB(0);
  return { x0: a.lowerBound.x / S, y0: a.lowerBound.y / S, x1: a.upperBound.x / S, y1: a.upperBound.y / S };
}
function settle() {
  for (let k = fallen.length - 1; k >= 0; k--) {
    const nd = fallen[k], b = nd.body;
    const bb = aabbOf(b);
    if (bb.y0 > geo.Fh + 3) { world.destroyBody(b); nd.body = null; nd.dead = true; fallen.splice(k, 1); continue; } // 画面の外へ落ちた
    if (drain) continue;
    // 止まったら静的にして焼き付ける（長く揺れ続けるものも、遅ければ止める）
    const v = b.getLinearVelocity();
    const slow = Math.hypot(v.x, v.y) < 0.05 && Math.abs(b.getAngularVelocity()) < 0.05;
    if (!b.isAwake() || (simTime - nd.fellAt > 12 && slow)) {
      b.setStatic();
      nd.falling = false;
      nd.pose = poseOf(nd);
      nd.top = bb.y0;
      fallen.splice(k, 1);
      pile.push(nd);
      bakeNode(nd);
    }
  }
}
function pileTop() { let t = Infinity; for (const nd of pile) t = Math.min(t, nd.top); return t; }
function chainBottom() {
  let y = geo.hook0 + geo.ay + 1;
  for (const nd of chain) y = Math.max(y, aabbOf(nd.body).y1);
  return y;
}
function maybeDrain(now) {
  if (drain) {
    const t = (now - drain.at) / DRAIN_MS;
    // 山の画像が落ちきり、底の近くに落ちている語がなければ、底を戻す
    const near = fallen.some((nd) => aabbOf(nd.body).y1 > geo.Fh - 1);
    if (t >= 1 && !near) {
      drain = null;
      makeBounds();
      const c = pileLayer.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pileLayer.canvas.width, pileLayer.canvas.height);
    }
    return;
  }
  if (!pile.length) return;
  const top = pileTop();
  if (top < chainBottom() + 3 || top < geo.Fh * 0.3) {
    // 底を抜く：山の静的な体は消し、焼いた画像だけを落とす。動いている語は物理のまま落ちる
    drain = { at: now };
    stats.drains++;
    world.destroyBody(ground); ground = null;
    for (const nd of pile) { world.destroyBody(nd.body); nd.body = null; nd.dead = true; }
    pile = [];
    for (const nd of fallen) nd.body.setAwake(true);
  }
}
const drainOffset = (now) => {
  if (!drain) return 0;
  const t = Math.min(1, (now - drain.at) / DRAIN_MS);
  return t * t * (geo.H + 40); // 等加速度で下へ
};

// ---------- 進める ----------
let statusAt = 0;
const drawHist = [], physHist = [];
let drawMs = 0;
function update(now, dt) {
  if (!running) return;
  simTime = now;
  // 書く
  if (cur) {
    const before = cur.n;
    cur.n = Math.min(cur.e.len, cur.n + params.speed * dt);
    // 頭のかなが書かれた瞬間：強調、下の語の尻から線が伸びる
    if (cur.chained && before <= cur.e.headPos && cur.n > cur.e.headPos) {
      const lower = chain[chain.length - 1];
      pulses.push({ node: cur, j: cur.e.headPos, at: now }, { node: lower, j: lower.e.tailPos, at: now });
      pending = { lower, upper: cur, at: now };
    }
  }
  // 吊り元の紐を伸ばして、前の語を下げる
  if (hook && hook.len < hook.target) {
    hook.len = Math.min(hook.target, hook.len + LOWER_RATE * dt);
    hook.joint.setMaxLength(hook.len * S);
    hook.node.body.setAwake(true);
  }
  // しりとり線の長さを LINK_LEN に寄せる（つないだときは斜めで長いので、たぐり寄せる。設定を変えたときも）
  for (const nd of chain) {
    if (!nd.up) continue;
    const L = nd.up.joint.getMaxLength() / S, d = params.linkLen - L;
    if (Math.abs(d) < 1e-3) continue;
    nd.up.joint.setMaxLength((L + Math.sign(d) * Math.min(Math.abs(d), LOWER_RATE * 0.5 * dt)) * S);
    nd.body.setAwake(true);
  }
  if (cur && cur.n >= cur.e.len && (!hook || hook.len >= hook.target) && (!pending || now - pending.at >= LINK_MS)) attach(now);
  if (cutAt !== null && now >= cutAt) {
    cutAt = null;
    while (chain.length > params.chain) cutBottom(now);
  }
  if (!cur && now >= waitUntil) startWord(now);
  // 物理
  acc += dt;
  let k = 0;
  const p0 = performance.now();
  while (acc >= STEP && k < 5) {
    world.step(STEP, 10, 8); acc -= STEP; k++;
    for (const nd of toShatter) shatter(nd);
    toShatter.clear();
  }
  if (k === 5) acc = 0;
  physHist.push(performance.now() - p0);
  if (physHist.length > 60) physHist.shift();
  settle();
  maybeDrain(now);
  pulses = pulses.filter((p) => now - p.at < PULSE_MS);
  cuts = cuts.filter((c) => now - c.at < CUT_MS);
  if (now - statusAt > 500) {
    statusAt = now;
    const [lo, hi] = lenRange();
    const avg = (h) => h.reduce((a, b) => a + b, 0) / (h.length || 1);
    setStatus(`CHAIN ${chain.length}/${params.chain}  WORDS ${stats.words}  FALLEN ${stats.fallen}  SHATTERED ${stats.shattered}\nFALLING ${fallen.length}  PILE ${pile.length}  BODIES ${world.getBodyCount()}  DRAINS ${stats.drains}  LEN ${lo}–${hi}\nPHYS ${avg(physHist).toFixed(1)}ms (MAX ${Math.max(0, ...physHist).toFixed(0)})  DRAW ${drawMs.toFixed(1)}ms (MAX ${Math.max(0, ...drawHist).toFixed(0)})\nREUSE ${stats.reused}  RESTART ${stats.restarts}`);
  }
}

// ---------- 描く ----------
const FONT = (cell) => `${cell * 0.9}px "Noto Serif JP", serif`;
const glyphOf = (e, j) => (j === 0 ? params.bracket[0] : j === e.headLen - 1 ? params.bracket[1] : e.text[j]);
// 語の中心と角度（字の座標）
function poseOf(nd) {
  if (nd.pose && !nd.body) return nd.pose;
  if (nd.body) { const p = nd.body.getPosition(); return { x: p.x / S, y: p.y / S, ang: nd.body.getAngle() }; }
  return { x: nd.x0 + nd.e.len / 2, y: nd.y0 + 0.5, ang: 0 };
}
// 語の j 番目の字の中心と角度。砕けた語はその字の破片の体から。消えていれば null
function charPose(nd, j) {
  if (nd.shards) { const sh = nd.shards[j]; return sh && !sh.dead ? poseOf(sh) : null; }
  if (nd.dead) return null;
  const p = poseOf(nd), lx = localX(nd.e, j), co = Math.cos(p.ang), si = Math.sin(p.ang);
  return { x: p.x + co * lx, y: p.y + si * lx, ang: p.ang };
}
// 字の上の縁（ly＝−0.5）・下の縁（＋0.5）の点
function kanaPt(nd, j, ly) {
  const p = charPose(nd, j);
  return p && [p.x - Math.sin(p.ang) * ly, p.y + Math.cos(p.ang) * ly];
}
const tailPt = (nd) => kanaPt(nd, nd.e.tailPos, -0.5);
const headPt = (nd) => kanaPt(nd, nd.e.headPos, 0.5);
function setPose(c, p, ox, oy, cell, dpr) {
  const co = Math.cos(p.ang), si = Math.sin(p.ang);
  c.setTransform(dpr * co, dpr * si, -dpr * si, dpr * co, dpr * (ox + p.x * cell), dpr * (oy + p.y * cell));
}
function drawNode(c, nd, ox, oy, cell, dpr, n = nd.e.len) {
  const e = nd.e;
  setPose(c, poseOf(nd), ox, oy, cell, dpr);
  c.font = FONT(cell);
  c.textAlign = "center"; c.textBaseline = "middle";
  const ink = params.inkColor, faint = params.headEm ? mix(params.inkColor, params.bgColor, 0.55) : ink;
  if (nd.shard) { // 砕けた字1つ
    c.fillStyle = nd.j < e.headLen ? ink : faint;
    c.fillText(glyphOf(e, nd.j), 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }
  c.fillStyle = ink;
  const m = Math.min(e.len, Math.floor(n));
  for (let j = 0; j < m; j++) {
    if (j === e.headLen) c.fillStyle = faint;
    c.fillText(glyphOf(e, j), localX(e, j) * cell, 0);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function bakeNode(nd) {
  const L = pileLayer;
  drawNode(L.ctx, nd, geo.ox, geo.oy, geo.cell, L.dpr);
}
const styleOf = () => [params.inkColor, params.bgColor, params.bracket, params.headEm, window.devicePixelRatio || 1].join("|");
function rebuild() {
  if ((window.devicePixelRatio || 1) !== pileLayer.dpr) pileLayer = newLayer();
  const c = pileLayer.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pileLayer.canvas.width, pileLayer.canvas.height);
  if (!drain) for (const nd of pile) bakeNode(nd);
}
function line(c, a, b, ox, oy, cell, dpr, width) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.lineWidth = width; c.lineCap = "round";
  c.beginPath();
  c.moveTo(ox + a[0] * cell, oy + a[1] * cell);
  c.lineTo(ox + b[0] * cell, oy + b[1] * cell);
  c.stroke();
}
function drawLinks(c, ox, oy, cell, dpr, now, live) {
  const w = Math.max(1, cell * 0.06);
  c.strokeStyle = params.lineColor;
  // 吊り元の紐（しりとり線ではないので細く薄く）
  // 書いている語の帯（字の高さ）を横切るところは描かない
  if (hook && hook.node.body) {
    c.globalAlpha = 0.35;
    const a = [geo.ax, geo.ay], b = tailPt(hook.node), hw = Math.max(0.75, w * 0.6);
    const at = (y) => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
    if (cur && b[1] > cur.y0 + 1.1) { line(c, a, at(cur.y0 - 0.1), ox, oy, cell, dpr, hw); line(c, at(cur.y0 + 1.1), b, ox, oy, cell, dpr, hw); }
    else line(c, a, b, ox, oy, cell, dpr, hw);
  }
  c.globalAlpha = 1;
  if (!params.link) return;
  for (const nd of chain) if (nd.up) line(c, tailPt(nd), headPt(nd.up.upper), ox, oy, cell, dpr, w);
  // 書いている語へ伸びる線（尻から頭へ）
  if (pending && pending.upper === cur) {
    const a = tailPt(pending.lower), b = headPt(cur), g = live ? Math.min(1, (now - pending.at) / LINK_MS) : 1;
    line(c, a, [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g], ox, oy, cell, dpr, w);
  }
  // 切れた線：両端へ縮む
  if (live) for (const k of cuts) {
    const t = (now - k.at) / CUT_MS, f = 0.5 * (1 - t) * (1 - t);
    const a = tailPt(k.lower), b = headPt(k.upper);
    if (!a || !b) continue;
    c.globalAlpha = 1 - t * 0.5;
    line(c, a, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], ox, oy, cell, dpr, w);
    line(c, b, [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f], ox, oy, cell, dpr, w);
    c.globalAlpha = 1;
  }
}
// しりとりの強調（白黒反転）
function drawPulses(c, ox, oy, cell, dpr, now) {
  c.font = FONT(cell);
  c.textAlign = "center"; c.textBaseline = "middle";
  for (const p of pulses) {
    const nd = p.node, pose = charPose(nd, p.j);
    if (!pose) continue;
    const t = (now - p.at) / PULSE_MS, amt = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    setPose(c, pose, ox, oy, cell, dpr);
    c.globalAlpha = amt;
    c.fillStyle = params.inkColor; c.fillRect(-cell * 0.55, -cell * 0.5, cell * 1.1, cell);
    c.fillStyle = params.bgColor; c.fillText(glyphOf(nd.e, p.j), 0, 0);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
}
function drawGuide(c, ox, oy, cell, dpr) {
  c.globalAlpha = 0.25; c.strokeStyle = params.inkColor; c.lineWidth = 1;
  for (let b = world.getBodyList(); b; b = b.getNext()) {
    for (let f = b.getFixtureList(); f; f = f.getNext()) {
      const s = f.getShape(), vs = s.m_vertices;
      if (!vs) continue;
      c.beginPath();
      vs.forEach((v, i) => {
        const p = b.getWorldPoint(v);
        const x = ox + (p.x / S) * cell, y = oy + (p.y / S) * cell;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.closePath(); c.stroke();
    }
  }
  c.globalAlpha = 1;
}
function draw(c, W, H, now, dpr, live = true) {
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = params.bgColor;
  c.fillRect(0, 0, W, H);
  const { ox, oy, cell } = geo;
  if (params.guide) drawGuide(c, ox, oy, cell, dpr);
  // 積もった山（焼いた画像）
  if (live) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(pileLayer.canvas, 0, drainOffset(now) * dpr, W * dpr, H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else for (const nd of pile) drawNode(c, nd, ox, oy, cell, dpr);
  drawLinks(c, ox, oy, cell, dpr, now, live);
  for (const nd of fallen) drawNode(c, nd, ox, oy, cell, dpr);
  for (const nd of chain) drawNode(c, nd, ox, oy, cell, dpr);
  if (cur) drawNode(c, cur, ox, oy, cell, dpr, cur.n);
  if (!live) return;
  drawPulses(c, ox, oy, cell, dpr, now);
  // カーソル（点滅）
  if (running && cur && cur.n < cur.e.len && Math.floor(now / 500) % 2 === 0) {
    setPose(c, { x: cur.x0 + Math.floor(cur.n) + 0.5, y: cur.y0 + 0.5, ang: 0 }, ox, oy, cell, dpr);
    c.globalAlpha = 0.35; c.fillStyle = params.inkColor;
    c.fillRect(-cell * 0.45, -cell * 0.45, cell * 0.9, cell * 0.9);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalAlpha = 1;
  }
}

const canvas = $("c"), ctx = canvas.getContext("2d");
let last = performance.now(), sizeKey = "", resizeAt = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  // 窓の大きさが変わったら、落ち着いてから（0.4秒）最初から
  const sk = `${W}x${H}`;
  if (sk !== sizeKey) { sizeKey = sk; resizeAt = now; }
  if (geo && (W !== geo.W || H !== geo.H) && now - resizeAt > 400) reset();
  const key = styleOf();
  if (key !== styleKey) { styleKey = key; rebuild(); }
  if (fakeClock !== null) now = fakeClock; // 確認用の仮の時計（__shizuku.advance）で動かしているあいだは、ここでは進めない
  else update(now, dt);
  const t0 = performance.now();
  draw(ctx, W, H, now, dpr);
  drawHist.push(performance.now() - t0);
  if (drawHist.length > 60) drawHist.shift();
  drawMs = drawHist.reduce((a, b) => a + b, 0) / drawHist.length;
  requestAnimationFrame(frame);
}

// ---------- スクリーンショット（S キー） ----------
// 強調・カーソル・縮む線なし。積もった山も1語ずつ描き直す
function saveScreenshot() {
  const dpr = window.devicePixelRatio || 1;
  const W = geo.W, H = geo.H;
  const off = document.createElement("canvas");
  off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
  draw(off.getContext("2d"), W, H, performance.now(), dpr, false);
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  const name = `nagori-shizuku-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
  off.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

let fakeClock = null;
if (window.__shizukuDebug || new URLSearchParams(location.search).has("debug")) window.__shizuku = {
  // 仮の時計で sec 秒ぶん進めて描く（確認用ブラウザが裏で動いていて requestAnimationFrame が遅いとき）
  advance(sec) {
    if (fakeClock === null) fakeClock = performance.now();
    const t0 = performance.now();
    for (let k = 0; k < Math.round(sec * 60); k++) { fakeClock += 1000 / 60; update(fakeClock, 1 / 60); }
    const dpr = window.devicePixelRatio || 1;
    draw(ctx, canvas.clientWidth, canvas.clientHeight, fakeClock, dpr);
    return { ms: performance.now() - t0, status: $("status").textContent };
  },
  get chain() { return chain; }, get fallen() { return fallen; }, get pile() { return pile; }, get cur() { return cur; }, stats, get geo() { return geo; }, get world() { return world; } };
loadDict().then(() => {
  reset();
  running = true;
  requestAnimationFrame(frame);
}).catch((e) => setStatus(`辞書の読み込みに失敗：${e.message}`));
