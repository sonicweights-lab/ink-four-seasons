// Procedural ink-wash scene.
//
// Every mark is baked once into two maps: how much ink a pixel ends up with
// (dens) and the frame at which the ink front reaches it (time). A frame is
// then a pure function of the frame number: pixel shows ink iff frame >= time.
// Ink only ever arrives — nothing is cross-faded in.

import { clamp, fbm, mulberry32, smoothstep, vnoise } from './noise';

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DURATION = 150; // 5 s

const PAPER = [0xee, 0xea, 0xe0];
const INK = [0x1b, 0x1a, 0x18];
const RED = [0xb8, 0x35, 0x2a];

export const FONT_REGULAR = 'InkCrimson';
export const FONT_ITALIC = 'InkCrimsonItalic';

// ---------------------------------------------------------------- timeline (frames)
export const T = {
  far: { t0: 0, dur: 32 },
  sun: { t0: 20, dur: 26 },
  mid: { t0: 14, dur: 32 },
  near: { t0: 28, dur: 32 },
  cliffWash: { t0: 44, dur: 22 },
  cliff: 50,
  pine: 70,
  river: 62,
  boat: 94,
  title: { t0: 86, dur: 22 },
  subtitle: { t0: 100, dur: 13 },
  seal: 116, // fully pressed by 118; frames 120-149 are the 1 s hold
};

// ---------------------------------------------------------------- layers
type Wash = {
  x0: number; y0: number; w: number; h: number;
  dens: Float32Array; time: Float32Array;
  band: number; gain: number; // wet band: frames it lasts, extra darkness at the front
};

type StrokeLayer = {
  dens: Float32Array; time: Float32Array;
  minX: number; minY: number; maxX: number; maxY: number;
};

type Sun = { cx: number; cy: number; R: number; rag: Float32Array; x0: number; y0: number; size: number };
type Seal = { x0: number; y0: number; size: number; dens: Float32Array; order: Float32Array };

export type SceneGeo = { ridges: Float32Array[]; fans: [number, number, number, number][]; contour: [number, number][]; boat: [number, number] };
export type Scene = { washes: Wash[]; strokes: StrokeLayer; paper: Float32Array; sun: Sun; seal: Seal; geo: SceneGeo };

type Pt = [number, number];

// ---------------------------------------------------------------- mountains
type Peak = { x: number; h: number; w: number; k?: number };

const ridgeLine = (baseY: number, peaks: Peak[], seed: number, rough: number) => {
  const r = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (const p of peaks) {
      const d = Math.abs(x - p.x) / p.w;
      // rounded crown with steep shoulders, not a triangle
      const v = d < 1.6 ? p.h * (0.62 * Math.exp(-((d * 1.9) * (d * 1.9))) + 0.38 * Math.pow(Math.max(0, 1 - d / 1.6), p.k ?? 1.6)) : 0;
      s += Math.exp(v / 10);
    }
    // valleys sag below the baseline so the ranges sink into mist instead of sitting on a shelf
    const h = 10 * Math.log(s / peaks.length) - 34;
    const detail = (fbm(x / 55, 0.5, seed) - 0.5) * rough * 1.6 + (fbm(x / 12, 3.5, seed + 9) - 0.5) * rough * 0.5;
    r[x] = baseY - h + detail;
  }
  return r;
};

const mountainWash = (opts: {
  baseY: number; peaks: Peak[]; seed: number; base: number; mist: number;
  t0: number; dur: number; dir: 1 | -1; rough: number;
}): { wash: Wash; ridge: Float32Array } => {
  const { base, mist, seed, t0, dur, dir } = opts;
  const ridge = ridgeLine(opts.baseY, opts.peaks, seed, opts.rough);
  let top = H;
  for (let x = 0; x < W; x++) top = Math.min(top, ridge[x]);
  const y0 = Math.max(0, Math.floor(top) - 3);
  const y1 = Math.min(H, Math.ceil(opts.baseY + mist * 1.6));
  const h = y1 - y0;
  const dens = new Float32Array(W * h);
  const time = new Float32Array(W * h).fill(Infinity);

  for (let x = 0; x < W; x++) {
    const rx = ridge[x];
    const tideW = 1.6 + 3.2 * fbm(x / 40, 7.1, seed + 21);
    const dirx = dir > 0 ? x / W : 1 - x / W;
    for (let j = 0; j < h; j++) {
      const y = y0 + j;
      const dy = y - rx;
      if (dy < -1.2) continue;
      const cov = clamp((dy + 1.2) / 2.4);
      const mistN = fbm(x / 240, y / 60, seed + 3);
      const fall = 1 - smoothstep(0, mist, dy + (mistN - 0.5) * mist * 1.1);
      if (fall <= 0.01) continue;
      const gran = 0.8 + 0.4 * fbm(x / 20, y / 20, seed + 5, 3);
      const wr = fbm(x / 9 + y / 60, y / 55, seed + 7, 3); // cun wrinkles, slanted and broken
      const cun = smoothstep(0.6, 0.78, wr) * fbm(x / 80, y / 80, seed + 17, 2) * Math.exp(-Math.max(dy, 0) / (mist * 0.28));
      const tide = Math.exp(-Math.max(dy, 0) / tideW);
      const d = base * cov * (fall * gran * (1 + 0.9 * cun) + 1.3 * tide);
      const i = j * W + x;
      dens[i] = d;
      // front: sweeps across the range and soaks down into the mist, with a ragged edge
      const p = 0.64 * dirx + 0.36 * clamp(dy / mist, 0, 1.5);
      const jit = (fbm(x / 64, y / 64, seed + 11) - 0.5) * 0.24 + (fbm(x / 11, y / 11, seed + 13, 2) - 0.5) * 0.08;
      time[i] = t0 + dur * clamp(p + jit, 0, 1.3);
    }
  }
  return { wash: { x0: 0, y0, w: W, h, dens, time, band: 8, gain: 0.95 }, ridge };
};

// ---------------------------------------------------------------- polygon wash (cliff body)
const polygonWash = (poly: Pt[], seed: number, t0: number, dur: number): Wash => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 4);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 4);
  const w = Math.min(W, Math.ceil(Math.max(...xs)) + 4) - x0;
  const h = Math.min(H, Math.ceil(Math.max(...ys)) + 4) - y0;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(1.5px)';
  ctx.beginPath();
  poly.forEach(([x, y], k) => (k ? ctx.lineTo(x - x0, y - y0) : ctx.moveTo(x - x0, y - y0)));
  ctx.closePath();
  ctx.fill();
  const a = ctx.getImageData(0, 0, w, h).data;
  const dens = new Float32Array(w * h);
  const time = new Float32Array(w * h).fill(Infinity);
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const al = a[(j * w + i) * 4 + 3] / 255;
      if (al < 0.01) continue;
      const x = x0 + i;
      const y = y0 + j;
      const fade = 1 - smoothstep(bot - 120, bot, y + (fbm(x / 50, y / 30, seed) - 0.5) * 60);
      if (fade <= 0.01) continue;
      const gran = 0.75 + 0.5 * fbm(x / 16, y / 16, seed + 2, 3);
      const streak = 0.85 + 0.3 * fbm(x / 10 + y / 22, y / 30, seed + 4, 3); // dry grain
      dens[j * w + i] = 0.34 * al * fade * gran * streak * (1 + 0.5 * Math.exp(-(y - top) / 70));
      const p = (y - top) / (bot - top);
      const jit = (fbm(x / 40, y / 40, seed + 6) - 0.5) * 0.22 + (fbm(x / 9, y / 9, seed + 8, 2) - 0.5) * 0.07;
      time[j * w + i] = t0 + dur * clamp(p + jit, 0, 1.25);
    }
  }
  return { x0, y0, w, h, dens, time, band: 7, gain: 0.9 };
};

// ---------------------------------------------------------------- brush strokes
const newStrokeLayer = (): StrokeLayer => ({
  dens: new Float32Array(W * H),
  time: new Float32Array(W * H).fill(Infinity),
  minX: W, minY: H, maxX: 0, maxY: 0,
});

const put = (S: StrokeLayer, x: number, y: number, d: number, t: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
  const i = yi * W + xi;
  if (t < S.time[i]) S.time[i] = t;
  if (d > S.dens[i]) S.dens[i] = d;
  if (xi < S.minX) S.minX = xi;
  if (yi < S.minY) S.minY = yi;
  if (xi > S.maxX) S.maxX = xi;
  if (yi > S.maxY) S.maxY = yi;
};

const catmull = (pts: Pt[], seg = 20): Pt[] => {
  if (pts.length < 3) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

type BrushOpts = {
  w0: number; w1: number; ink: number; dry: number; t0: number; dur: number; seed: number;
  tin?: number; tout?: number; bleed?: boolean;
};

// A bristle brush: a row of bristles dragged along the path. Each bristle carries
// its own ink load, so dry strokes break into streaks that thin out as ink runs out.
// Pixels are timed by arc length, so the stroke grows along its path.
const brush = (S: StrokeLayer, raw: Pt[], o: BrushOpts) => {
  const path = catmull(raw);
  const cum = [0];
  for (let i = 1; i < path.length; i++)
    cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = cum[cum.length - 1];
  if (L < 0.5) return;
  const rng = mulberry32(o.seed);
  const nB = Math.max(6, Math.round(Math.max(o.w0, o.w1) * 1.6));
  const load = Array.from({ length: nB }, () => 0.5 + 0.5 * rng());
  const tin = o.tin ?? 0.12;
  const tout = o.tout ?? 0.25;
  let seg = 0;
  for (let s = 0; s <= L; s += 0.5) {
    while (seg < path.length - 2 && cum[seg + 1] < s) seg++;
    const sl = cum[seg + 1] - cum[seg] || 1;
    const k = (s - cum[seg]) / sl;
    const x = path[seg][0] + (path[seg + 1][0] - path[seg][0]) * k;
    const y = path[seg][1] + (path[seg + 1][1] - path[seg][1]) * k;
    const tx = (path[seg + 1][0] - path[seg][0]) / sl;
    const ty = (path[seg + 1][1] - path[seg][1]) / sl;
    const nx = -ty;
    const ny = tx;
    const u = s / L;
    const taper = (0.5 + 0.5 * smoothstep(0, tin, u)) * (1 - 0.88 * smoothstep(1 - tout, 1, u));
    const r = Math.max(0.45, ((o.w0 + (o.w1 - o.w0) * u) * taper) / 2);
    // eased brush speed: slow press, fast middle, slow lift
    const t = o.t0 + (o.dur * Math.acos(1 - 2 * u)) / Math.PI;
    const inkLeft = 1 - 0.85 * o.dry * Math.pow(u, 1.2);
    for (let off = -r; off <= r; off += 0.5) {
      const q = (off / r + 1) / 2;
      const b = Math.min(nB - 1, Math.floor(q * nB));
      const edge = 1 - 0.5 * Math.pow(Math.abs(off) / r, 6);
      const n = vnoise(s * 0.09, b * 3.7, o.seed);
      const thr = 1 - o.dry + o.dry * inkLeft * load[b] * edge * 1.2;
      if (n > thr) continue;
      const d = o.ink * (0.8 + 0.2 * load[b]) * (o.dry > 0 ? 0.8 + 0.2 * n : 1);
      put(S, x + nx * off, y + ny * off, d, t);
    }
    if (o.bleed) {
      // ink soaking a little way into the paper just after the brush passes
      for (let e = 0.5; e <= 2.5; e += 0.5) {
        const d = o.ink * 0.2 * (1 - e / 3);
        put(S, x + nx * (r + e), y + ny * (r + e), d, t + 0.6 + e * 0.8);
        put(S, x - nx * (r + e), y - ny * (r + e), d, t + 0.6 + e * 0.8);
      }
    }
  }
};

const fan = (S: StrokeLayer, cx: number, cy: number, a0: number, a1: number, n: number, len: number, t0: number, seed: number) => {
  const rng = mulberry32(seed);
  for (let k = 0; k < n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / (n - 1)) * Math.PI) / 180 + (rng() - 0.5) * 0.08;
    const l = len * (0.8 + 0.35 * rng());
    const sx = cx + Math.cos(a) * 2.5;
    const sy = cy + Math.sin(a) * 2.5;
    brush(S, [[sx, sy], [cx + Math.cos(a) * l, cy + Math.sin(a) * l]], {
      w0: 2.6, w1: 1.2, ink: 1.05, dry: 0.15, t0: t0 + k * 0.4, dur: 2.5, seed: seed * 31 + k, tin: 0.05, tout: 0.5,
    });
  }
};

// ---------------------------------------------------------------- text
const glyphToLayer = (
  S: StrokeLayer, canvasDraw: (ctx: CanvasRenderingContext2D) => void, cw: number, ch: number,
  ox: number, oy: number, timeAt: (x: number, y: number) => number,
) => {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  canvasDraw(ctx);
  const core = ctx.getImageData(0, 0, cw, ch).data;
  ctx.clearRect(0, 0, cw, ch);
  ctx.filter = 'blur(2px)';
  canvasDraw(ctx);
  const halo = ctx.getImageData(0, 0, cw, ch).data;
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const a = core[(j * cw + i) * 4 + 3] / 255;
      const hl = halo[(j * cw + i) * 4 + 3] / 255;
      if (a < 0.02 && hl < 0.03) continue;
      const x = ox + i;
      const y = oy + j;
      const t = timeAt(x, y);
      const grain = 0.82 + 0.18 * vnoise(x / 1.7, y / 1.7, 77);
      if (a >= 0.02) put(S, x, y, 2.2 * a * grain, t);
      else put(S, x, y, 0.22 * hl, t + 1.5); // bleed spreads after the glyph lands
    }
};

const layoutText = (S: StrokeLayer, title: string, subtitle: string) => {
  const colX = 952;
  const top = 196;
  const maxBottom = 770;
  const chars = Array.from(title.toUpperCase());
  const units = chars.reduce((a, ch) => a + (ch === ' ' ? 0.6 : 1), 0) || 1;
  const step = Math.min(84, (maxBottom - top) / units);
  const size = Math.min(44, step * 0.72);
  const charSet: { ch: string; y: number }[] = [];
  let y = top;
  for (const ch of chars) {
    if (ch !== ' ') charSet.push({ ch, y });
    y += step * (ch === ' ' ? 0.6 : 1);
  }
  const bottom = y - step + size;
  const n = charSet.length || 1;
  const per = T.title.dur / n;
  charSet.forEach(({ ch, y: cy }, k) => {
    const box = 110;
    const ox = Math.round(colX - box / 2);
    const oy = Math.round(cy - box / 2 + size * 0.35);
    const cs = T.title.t0 + k * per;
    glyphToLayer(
      S,
      (ctx) => {
        ctx.font = `400 ${size}px ${FONT_REGULAR}`;
        (ctx as unknown as { fontVariantCaps: string }).fontVariantCaps = 'all-small-caps';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, box / 2, box / 2);
      },
      box, box, ox, oy,
      (x, yy) => cs + clamp((yy - (oy + box / 2 - size * 0.4)) / (size * 0.8), 0, 1) * per * 1.6 + (vnoise(x / 5, yy / 5, 91) - 0.5) * 1.2,
    );
  });

  // subtitle: italic, set beside the title, reading downward
  const subSize = 30;
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `italic 400 ${subSize}px ${FONT_ITALIC}`;
  const len = Math.min(c.measureText(subtitle).width, bottom - top - 40);
  const sx = colX - 66;
  const sy = top + 34;
  const cw = 60;
  const chH = Math.ceil(len) + 40;
  const ox = Math.round(sx - cw / 2);
  const oy = Math.round(sy - 20);
  glyphToLayer(
    S,
    (ctx) => {
      ctx.translate(cw / 2, 20);
      ctx.rotate(Math.PI / 2);
      ctx.font = `italic 400 ${subSize}px ${FONT_ITALIC}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(subtitle, 0, 0, len);
    },
    cw, chH, ox, oy,
    (x, yy) => T.subtitle.t0 + T.subtitle.dur * clamp((yy - sy) / len) + (vnoise(x / 4, yy / 4, 93) - 0.5) * 1.2,
  );
  return { colX, bottom };
};

// ---------------------------------------------------------------- seal (baiwen 山)
const makeSeal = (cx: number, top: number): Seal => {
  const size = 62;
  const x0 = Math.round(cx - size / 2);
  const y0 = Math.round(top);
  const dens = new Float32Array(size * size);
  const order = new Float32Array(size * size);
  const sw = 6.5; // carved line width
  const carved = (u: number, v: number) => {
    const inV = (x: number, ya: number, yb: number) => Math.abs(u - x) < sw / 2 && v > ya && v < yb;
    return (
      inV(31, 13, 47) || inV(15, 26, 47) || inV(47, 26, 47) ||
      (v > 44 && v < 44 + sw && u > 12 && u < 50)
    );
  };
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const e = 1.6 * (vnoise(i / 3, j / 3, 501) - 0.5);
      const inside = i + e > 0.5 && i - e < size - 0.5 && j + e > 0.5 && j - e < size - 0.5;
      const k = j * size + i;
      if (!inside || carved(i + e * 0.8, j - e * 0.8)) continue;
      const speck = vnoise(i / 2.2, j / 2.2, 503);
      dens[k] = speck < 0.12 ? 0.6 : 3.2 * (0.85 + 0.15 * vnoise(i / 6, j / 6, 505));
      order[k] = vnoise(i / 4, j / 4, 507) * 0.9 + vnoise(i, j, 509) * 0.1;
    }
  return { x0, y0, size, dens, order };
};

// ---------------------------------------------------------------- build
export const buildScene = (title: string, subtitle: string): Scene => {
  const washes: Wash[] = [];

  const far = mountainWash({
    baseY: 1000, seed: 101, base: 0.12, mist: 210, dir: 1, rough: 12, ...T.far,
    peaks: [{ x: 70, h: 150, w: 120 }, { x: 190, h: 105, w: 90 }, { x: 360, h: 95, w: 110 }, { x: 735, h: 185, w: 105 }, { x: 830, h: 135, w: 90 }, { x: 1030, h: 110, w: 110 }],
  });
  const mid = mountainWash({
    baseY: 1110, seed: 202, base: 0.24, mist: 180, dir: -1, rough: 16, ...T.mid,
    peaks: [{ x: 170, h: 150, w: 120 }, { x: 300, h: 110, w: 95 }, { x: 590, h: 140, w: 115 }, { x: 680, h: 100, w: 85 }, { x: 930, h: 195, w: 110 }, { x: 1045, h: 125, w: 90 }],
  });
  const near = mountainWash({
    baseY: 1225, seed: 303, base: 0.42, mist: 140, dir: 1, rough: 18, ...T.near,
    peaks: [{ x: 430, h: 120, w: 125 }, { x: 545, h: 85, w: 90 }, { x: 790, h: 95, w: 115 }, { x: 1060, h: 150, w: 110 }],
  });
  washes.push(far.wash, mid.wash, near.wash);

  // sun: just above the far range, beside the main far peak
  const R = W * 0.04; // diameter = 8% of frame width
  const scx = 560;
  let ridgeMin = H;
  for (let x = scx - 70; x <= scx + 70; x++) ridgeMin = Math.min(ridgeMin, far.ridge[x]);
  const scy = ridgeMin - R - 26;
  const sunSize = Math.ceil(R * 2.4);
  const rag = new Float32Array(360);
  for (let a = 0; a < 360; a++) {
    const th = (a / 360) * Math.PI * 2;
    rag[a] = 1 + 0.05 * (fbm(Math.cos(th) * 2 + 5, Math.sin(th) * 2 + 5, 601) - 0.5);
  }
  const sun: Sun = { cx: scx, cy: scy, R, rag, x0: Math.round(scx - sunSize / 2), y0: Math.round(scy - sunSize / 2), size: sunSize };

  // cliff
  const contour: Pt[] = [
    [0, 872], [80, 862], [165, 876], [232, 898], [262, 934], [254, 984], [228, 1030], [262, 1082],
    [283, 1136], [256, 1192], [288, 1252], [318, 1302], [302, 1350],
  ];
  washes.push(polygonWash([...contour, [0, 1350]], 404, T.cliffWash.t0, T.cliffWash.dur));

  const S = newStrokeLayer();
  const rng = mulberry32(7);
  const c0 = T.cliff;
  brush(S, contour.slice(0, 7), { w0: 10, w1: 7, ink: 1.15, dry: 0.5, t0: c0, dur: 9, seed: 11 });
  brush(S, contour.slice(6), { w0: 9, w1: 5, ink: 1.05, dry: 0.65, t0: c0 + 8, dur: 10, seed: 12 });
  brush(S, [[150, 960], [178, 1010], [160, 1070], [196, 1130], [186, 1190]], { w0: 6, w1: 3, ink: 0.9, dry: 0.75, t0: c0 + 6, dur: 10, seed: 13 });
  // axe-cut texture strokes (fu pi cun): short diagonal dry strokes off the contour
  for (let k = 0; k < 11; k++) {
    const p = contour[2 + (k % 10)];
    const sx = p[0] - 12 - rng() * 30;
    const sy = p[1] + 8 + rng() * 20;
    const l = 40 + rng() * 55;
    const a = (112 + rng() * 18) * (Math.PI / 180);
    brush(S, [[sx, sy], [sx + Math.cos(a) * l * 0.5 + 4, sy + Math.sin(a) * l * 0.5], [sx + Math.cos(a) * l, sy + Math.sin(a) * l]], {
      w0: 8, w1: 3, ink: 0.85, dry: 0.8, t0: c0 + 12 + k * 1.6, dur: 4, seed: 40 + k, tout: 0.5,
    });
  }
  // moss dots along the ridge
  for (let k = 0; k < 7; k++) {
    const x = 30 + k * 30 + rng() * 10;
    const y = 866 + (x > 160 ? (x - 160) * 0.33 : 0) - 2 - rng() * 4;
    brush(S, [[x, y], [x + 3, y + 1.5]], { w0: 6, w1: 5, ink: 1.2, dry: 0, t0: c0 + 30 + k * 0.6, dur: 1.2, seed: 70 + k, tin: 0.4, tout: 0.4, bleed: true });
  }

  // pine: trunk leaning out over the void, three branches, needle fans
  const p0 = T.pine;
  brush(S, [[206, 902], [214, 872], [240, 842], [276, 820], [312, 806], [346, 797], [378, 784]], { w0: 12, w1: 6, ink: 1.1, dry: 0.45, t0: p0, dur: 9, seed: 81, tin: 0.05, bleed: true });
  brush(S, [[222, 892], [236, 860], [266, 836]], { w0: 3, w1: 2, ink: 0.8, dry: 0.7, t0: p0 + 4, dur: 3, seed: 82 }); // bark
  brush(S, [[262, 830], [240, 808], [214, 790]], { w0: 5, w1: 3, ink: 1.05, dry: 0.4, t0: p0 + 8, dur: 4, seed: 83 });
  brush(S, [[318, 806], [340, 824], [366, 834]], { w0: 5, w1: 3, ink: 1.05, dry: 0.4, t0: p0 + 9, dur: 4, seed: 84 });
  brush(S, [[346, 797], [352, 776], [366, 758]], { w0: 4.5, w1: 3, ink: 1.05, dry: 0.4, t0: p0 + 10, dur: 4, seed: 85 });
  const fans: [number, number, number, number][] = [
    [214, 790, -175, -5], [244, 806, -165, -15], [366, 834, -170, -10], [366, 758, -175, -5],
    [392, 784, -150, 10], [300, 800, -160, -20],
  ];
  fans.forEach(([x, y, a0, a1], k) => fan(S, x, y, a0, a1, 11, 26, p0 + 12 + k * 2.2, 90 + k));

  // river: thin, broken horizontal strokes in the lower third; nothing below y = 1530
  const boatX = 652;
  const boatY = 1410;
  const lines = 20;
  for (let k = 0; k < lines; k++) {
    const q = k / (lines - 1);
    const y = 1300 + 228 * Math.pow(q, 1.25) + (rng() - 0.5) * 6;
    const len = 90 + 260 * q * (0.6 + 0.6 * rng()) + rng() * 60;
    let xa = 40 + rng() * (W - 80 - len);
    if (y < 1360 && xa < 330) xa = 330 + rng() * 120; // keep clear of the cliff foot
    let xb = Math.min(W - 30, xa + len);
    if (y > 1380 && y < 1428 && xb > boatX - 70 && xa < boatX + 70) {
      if (boatX - xa > xb - boatX) xb = boatX - 72; else xa = boatX + 72;
    }
    if (xb - xa < 30) continue;
    const amp = 1 + rng() * 1.6;
    const ph = rng() * 6;
    const pts: Pt[] = [];
    for (let x = xa; x <= xb; x += 24) pts.push([x, y + Math.sin(x / 70 + ph) * amp]);
    pts.push([xb, y + Math.sin(xb / 70 + ph) * amp]);
    const ltr = rng() > 0.25;
    brush(S, ltr ? pts : pts.reverse(), {
      w0: 2.1 - q * 0.6, w1: 1.2, ink: 0.85 - q * 0.3, dry: 0.45, t0: T.river + q * 30 + rng() * 6, dur: 6 + (xb - xa) / 50, seed: 200 + k, tout: 0.4,
    });
  }

  // boat
  const b0 = T.boat;
  brush(S, [[boatX - 54, boatY - 8], [boatX - 30, boatY + 1], [boatX, boatY + 5], [boatX + 32, boatY], [boatX + 52, boatY - 12]], { w0: 7, w1: 5, ink: 1.25, dry: 0.1, t0: b0, dur: 5, seed: 301, tin: 0.2, tout: 0.3, bleed: true });
  brush(S, [[boatX - 38, boatY + 6], [boatX, boatY + 11], [boatX + 34, boatY + 6]], { w0: 2.2, w1: 1.6, ink: 0.8, dry: 0.3, t0: b0 + 4, dur: 3, seed: 302 });
  brush(S, [[boatX - 22, boatY + 1], [boatX - 16, boatY - 14], [boatX, boatY - 19], [boatX + 14, boatY - 13], [boatX + 18, boatY + 1]], { w0: 4, w1: 3, ink: 1.1, dry: 0.35, t0: b0 + 5, dur: 4, seed: 303 });
  brush(S, [[boatX + 28, boatY - 13], [boatX + 35, boatY - 18], [boatX + 43, boatY - 13]], { w0: 3.5, w1: 2.5, ink: 1.2, dry: 0, t0: b0 + 8, dur: 1.5, seed: 304, tin: 0.3, tout: 0.3 });
  brush(S, [[boatX + 35, boatY - 15], [boatX + 36, boatY - 4]], { w0: 4.5, w1: 3.5, ink: 1.2, dry: 0, t0: b0 + 9, dur: 1.5, seed: 305, tin: 0.3, tout: 0.3 });
  brush(S, [[boatX + 44, boatY - 46], [boatX + 70, boatY + 22]], { w0: 1.8, w1: 1.4, ink: 1.0, dry: 0.2, t0: b0 + 10, dur: 2.5, seed: 306, tin: 0.1, tout: 0.3 });
  brush(S, [[boatX - 64, boatY + 18], [boatX - 20, boatY + 20]], { w0: 1.6, w1: 1.2, ink: 0.6, dry: 0.4, t0: b0 + 11, dur: 2.5, seed: 307 });
  brush(S, [[boatX + 10, boatY + 22], [boatX + 60, boatY + 20]], { w0: 1.6, w1: 1.2, ink: 0.6, dry: 0.4, t0: b0 + 12, dur: 2.5, seed: 308 });

  // inscription + seal
  const { colX, bottom } = layoutText(S, title, subtitle);
  const seal = makeSeal(colX, bottom + 30);

  // paper: faint mottling and fibres (static — the paper is not animated)
  const paper = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      paper[y * W + x] = 1 + (vnoise(x / 9, y / 9, 701) - 0.5) * 0.028 + (vnoise(x / 1.4, y / 30, 703) - 0.5) * 0.018;

  const geo: SceneGeo = { ridges: [far.ridge, mid.ridge, near.ridge], fans, contour, boat: [boatX, boatY] };
  return { washes, strokes: S, paper, sun, seal, geo };
};

// ---------------------------------------------------------------- per-frame composite
let Dk: Float32Array | null = null;
let Dr: Float32Array | null = null;

const sunSpring = (u: number) => (u >= 1.25 ? 1 : 1 - Math.exp(-6 * u) * Math.cos(6 * u)); // ~4% overshoot

export const drawFrame = (ctx: CanvasRenderingContext2D, sc: Scene, f: number, opts: { noSun?: boolean; noSeal?: boolean } = {}) => {
  if (!Dk) Dk = new Float32Array(W * H);
  if (!Dr) Dr = new Float32Array(W * H);
  Dk.fill(0);
  Dr.fill(0);

  // washes: ragged front, darker wet band right behind it
  for (const L of sc.washes) {
    for (let j = 0; j < L.h; j++) {
      const row = (L.y0 + j) * W + L.x0;
      const li = j * L.w;
      for (let i = 0; i < L.w; i++) {
        const t = L.time[li + i];
        if (f < t) continue;
        const e = f - t;
        const c = e >= 1 ? 1 : 0.35 + 0.65 * e;
        const wet = e < L.band ? 1 + L.gain * (1 - e / L.band) * (1 - e / L.band) : 1;
        Dk[row + i] += L.dens[li + i] * c * wet;
      }
    }
  }

  // strokes: grown along their paths
  const S = sc.strokes;
  for (let y = S.minY; y <= S.maxY; y++) {
    const row = y * W;
    for (let x = S.minX; x <= S.maxX; x++) {
      const t = S.time[row + x];
      if (f < t) continue;
      const e = f - t;
      Dk[row + x] += S.dens[row + x] * (e >= 1 ? 1 : 0.4 + 0.6 * e);
    }
  }

  // sun: blooms from its centre, wet rim at the front, slight overshoot
  const su = sc.sun;
  const u = (f - T.sun.t0) / T.sun.dur;
  if (u > 0 && !opts.noSun) {
    const rho = su.R * sunSpring(u);
    const wetness = clamp(1.4 - u); // rim is wettest while spreading
    for (let j = 0; j < su.size; j++)
      for (let i = 0; i < su.size; i++) {
        const x = su.x0 + i;
        const y = su.y0 + j;
        const dx = x - su.cx;
        const dy = y - su.cy;
        const r = Math.hypot(dx, dy);
        const a = Math.round(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 360) % 360;
        const edge = rho * su.rag[a];
        const cov = clamp(edge - r + 0.5);
        if (cov <= 0) continue;
        const gran = 0.85 + 0.3 * vnoise(x / 3, y / 3, 611);
        const rim = Math.exp(-(edge - r) / (2 + 2 * wetness));
        Dr[y * W + x] += cov * (1.75 * gran + (1.6 + 1.4 * wetness) * rim);
      }
  }

  // seal: pressed, ink transfers over three frames, then held
  const se = sc.seal;
  const press = f < T.seal ? 0 : f < T.seal + 1 ? 0.8 : f < T.seal + 2 ? 0.94 : 1.01;
  if (press > 0 && !opts.noSeal)
    for (let j = 0; j < se.size; j++)
      for (let i = 0; i < se.size; i++) {
        const k = j * se.size + i;
        if (se.dens[k] > 0 && se.order[k] < press) Dr[(se.y0 + j) * W + se.x0 + i] += se.dens[k];
      }

  const img = ctx.createImageData(W, H);
  const px = img.data;
  const P = sc.paper;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const ak = 1 - Math.exp(-Dk[i]);
    const ar = 1 - Math.exp(-Dr[i]);
    const g = P[i];
    for (let c = 0; c < 3; c++) {
      const base = PAPER[c] * g * (1 - ar) + RED[c] * ar;
      px[p + c] = base * (1 - ak) + INK[c] * ak;
    }
    px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
};
