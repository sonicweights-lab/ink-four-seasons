import React, { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, spring, staticFile, useCurrentFrame } from 'remotion';
import { buildScene, drawFrame, FONT_ITALIC, FONT_REGULAR, H, Scene, W } from './scene';
import { clamp, fbm, hash2, mulberry32, smoothstep, vnoise } from './noise';

// "One painting. Four seasons." 24 s, 1080x1920, 30 fps.
// The finished ink landscape lives through spring, monsoon, autumn and winter.

export const SEASONS_FRAMES = 720;
const FPS = 30;
const INK = '#1B1A18';
const PAPER = '#EEEAE0';
const RED = [184, 53, 42];

// timeline (frames)
export const T = {
  hookOut: [75, 81], // hook held to 2.5 s
  spring: { in: 18, knock: 210 }, // first blossoms open at ~0.85 s
  springLabel: [88, 196],
  monsoon: { cloudIn: 205, rainIn: 218, rainOut: 372, cloudOut: 375 },
  monsoonLabel: [214, 372],
  autumn: { in: 380, out: 520 },
  autumnLabel: [392, 505],
  winter: { in: 510 },
  winterLabel: [522, 620],
  cta: 632,
  code: 636, // four function calls type out, one every 6 frames
  ctaLine2: 658,
  seal: 668,
  freeze: 675, // last 1.5 s completely still
};
const ramp = (f: number, a: number, b: number) => smoothstep(a, b, f);

// ---------------------------------------------------------------- one-time assets
type Assets = {
  scene: Scene;
  base: HTMLCanvasElement;
  sun: HTMLCanvasElement;
  cloudDens: Float32Array; cloudTime: Float32Array; cw: number; ch: number;
  blossoms: { x: number; y: number; r: number; t: number; a: number }[];
  seal: HTMLCanvasElement;
  snowA: Float32Array; snowT: Float32Array; snowY0: number; snowH: number; snowCanvas: HTMLCanvasElement;
};

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const buildAssets = (): Assets => {
  const scene = buildScene('', '');
  const base = makeCanvas(W, H);
  drawFrame(base.getContext('2d')!, scene, 115, { noSun: true, noSeal: true });

  // sun sprite with the same granular red ink and wet rim as the original
  const R = scene.sun.R;
  const S = Math.ceil(R * 2 + 8);
  const sun = makeCanvas(S, S);
  {
    const ctx = sun.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const dx = i - S / 2;
        const dy = j - S / 2;
        const r = Math.hypot(dx, dy);
        const th = Math.atan2(dy, dx);
        const edge = R * (1 + 0.05 * (fbm(Math.cos(th) * 2 + 5, Math.sin(th) * 2 + 5, 601) - 0.5));
        const cov = clamp(edge - r + 0.5);
        if (cov <= 0) continue;
        const gran = 0.85 + 0.3 * vnoise(i / 3, j / 3, 611);
        const d = cov * (1.75 * gran + 1.7 * Math.exp(-(edge - r) / 3));
        const a = 1 - Math.exp(-d);
        const k = (j * S + i) * 4;
        img.data[k] = RED[0];
        img.data[k + 1] = RED[1];
        img.data[k + 2] = RED[2];
        img.data[k + 3] = Math.round(a * 255);
      }
    ctx.putImageData(img, 0, 0);
  }

  // monsoon clouds: low-res density + the frame the ragged front reaches each cell
  const cw = 270;
  const ch = 480;
  const cloudDens = new Float32Array(cw * ch);
  const cloudTime = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      const x = i * 4;
      const y = j * 4;
      const band = smoothstep(380, 640, y) * (1 - smoothstep(1060, 1220, y));
      const n = fbm(x / 260, y / 140, 901, 5);
      const billow = smoothstep(0.38, 0.72, n);
      cloudDens[j * cw + i] = band * (0.25 + 0.9 * billow);
      const p = 0.55 * (x / W) + 0.45 * ((y - 380) / 840);
      cloudTime[j * cw + i] = T.monsoon.cloudIn + 50 * clamp(p + (fbm(x / 90, y / 90, 905) - 0.5) * 0.35, 0, 1.2);
    }

  // blossoms on the pine fans and along the cliff top
  const rng = mulberry32(42);
  const blossoms: Assets['blossoms'] = [];
  scene.geo.fans.forEach(([fx, fy, a0, a1]) => {
    for (let k = 0; k < 4; k++) {
      const a = ((a0 + ((a1 - a0) * (k + 0.5)) / 4) * Math.PI) / 180;
      const l = 14 + rng() * 16;
      blossoms.push({ x: fx + Math.cos(a) * l, y: fy + Math.sin(a) * l, r: 6 + rng() * 5, t: 0, a: 0.6 + rng() * 0.35 });
    }
  });
  scene.geo.contour.slice(0, 6).forEach(([x, y], k) => {
    blossoms.push({ x: x + 10 + rng() * 20, y: y - 4, r: 5 + rng() * 4, t: 0, a: 0.55 + rng() * 0.3 });
    if (k % 2) blossoms.push({ x: x + 26, y: y - 2, r: 4 + rng() * 3, t: 0, a: 0.5 });
  });
  blossoms.forEach((b, i) => (b.t = T.spring.in + 6 + i * 1.7 + rng() * 6));

  // baiwen seal (山 carved out of a red square)
  const seal = makeCanvas(76, 76);
  {
    const ctx = seal.getContext('2d')!;
    const img = ctx.createImageData(76, 76);
    const sw = 8;
    const carved = (u: number, v: number) => {
      const inV = (x: number, ya: number, yb: number) => Math.abs(u - x) < sw / 2 && v > ya && v < yb;
      return inV(38, 15, 57) || inV(18, 31, 57) || inV(58, 31, 57) || (v > 53 && v < 53 + sw && u > 14 && u < 62);
    };
    for (let j = 0; j < 76; j++)
      for (let i = 0; i < 76; i++) {
        const e = 1.8 * (vnoise(i / 3, j / 3, 501) - 0.5);
        const inside = i + e > 1 && i - e < 75 && j + e > 1 && j - e < 75;
        if (!inside || carved(i + e * 0.8, j - e * 0.8)) continue;
        const speck = vnoise(i / 2.2, j / 2.2, 503) < 0.12;
        const k = (j * 76 + i) * 4;
        img.data[k] = RED[0];
        img.data[k + 1] = RED[1];
        img.data[k + 2] = RED[2];
        img.data[k + 3] = speck ? 90 : 245;
      }
    ctx.putImageData(img, 0, 0);
  }


  // winter snow: lies on the upper slopes in streaks down the gullies, thinning with depth.
  // Each pixel gets an amount and the frame it arrives, so snow accumulates downward.
  const { ridges } = scene.geo;
  let y0s = H;
  let y1s = 0;
  ridges.forEach((r) => {
    for (let x = 0; x < W; x++) {
      y0s = Math.min(y0s, r[x]);
      y1s = Math.max(y1s, r[x]);
    }
  });
  const snowY0 = Math.floor(y0s) - 2;
  const snowH = Math.ceil(y1s + 90) - snowY0;
  const snowA = new Float32Array(W * snowH);
  const snowT = new Float32Array(W * snowH).fill(Infinity);
  const caps = [64, 50, 40];
  ridges.forEach((r, k) => {
    let rmin = Infinity;
    let rmax = -Infinity;
    for (let x = 0; x < W; x++) {
      rmin = Math.min(rmin, r[x]);
      rmax = Math.max(rmax, r[x]);
    }
    const below = ridges[k + 1];
    for (let x = 310; x < W; x++) {
      const pw = smoothstep(rmax - 0.15 * (rmax - rmin), rmin + 0.25 * (rmax - rmin), r[x]);
      if (pw <= 0.01) continue;
      const D = caps[k] * pw * (0.55 + 0.8 * fbm(x / 45, k * 7, 811));
      for (let y = Math.floor(r[x]); y < r[x] + D; y++) {
        if (below && y > below[x] - 6) break;
        const sd = (y - r[x]) / D;
        if (sd < 0) continue;
        const streak = smoothstep(0.38, 0.62, fbm(x / 5.5, y / 26, 820 + k, 3));
        const a = Math.pow(1 - sd, 1.3) * (0.35 + 0.65 * streak) * (sd < 0.18 ? 1 : 0.85) * 0.96;
        const i = (y - snowY0) * W + x;
        if (a > snowA[i]) snowA[i] = a;
        const t = T.winter.in + 10 + sd * 70 + (fbm(x / 30, y / 30, 830) - 0.5) * 30;
        if (t < snowT[i]) snowT[i] = t;
      }
    }
  });
  const snowCanvas = makeCanvas(W, snowH);

  return { scene, base, sun, cloudDens, cloudTime, cw, ch, blossoms, seal, snowA, snowT, snowY0, snowH, snowCanvas };
};

// ---------------------------------------------------------------- per-frame layers
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// text revealed (and later covered) behind a ragged brush edge — ink arrives, it never cross-fades
const brushText = (
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, f: number,
  tIn: number, tOut: number | null, seed: number, tracking = 0, color = INK, maxW = 880,
) => {
  if (f < tIn) return;
  ctx.save();
  let size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  ctx.font = font;
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking}px`;
  // shrink to fit the safe width (120 px clear of the right edge)
  while (ctx.measureText(text).width > maxW && size > 20) {
    size -= 2;
    ctx.font = font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
  }
  const w = ctx.measureText(text).width + 24;
  const pin = clamp((f - tIn) / 12);
  const pout = tOut === null ? 0 : clamp((f - tOut) / 10);
  if (pout >= 1) {
    ctx.restore();
    return;
  }
  ctx.beginPath();
  const top = y - size * 1.1;
  const bot = y + size * 0.45;
  const xr = x - 12 + w * pin;
  const xl = x - 12 + w * pout;
  ctx.moveTo(xl, top);
  for (let yy = top; yy <= bot; yy += 6) ctx.lineTo(xl + (hash2(Math.floor(yy), 1, seed) - 0.5) * 16 * (pout > 0 ? 1 : 0), yy);
  for (let yy = bot; yy >= top; yy -= 6) ctx.lineTo(xr + (hash2(Math.floor(yy), 2, seed) - 0.5) * 18, yy);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.8, size * 0.018);
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.restore();
};

const drawSun = (ctx: CanvasRenderingContext2D, A: Assets, f: number) => {
  const { cx, cy } = A.scene.sun;
  const fall = ramp(f, T.autumn.in, T.autumn.in + 70); // autumn sun sinks lower and grows a touch
  const scale = 1 + 0.12 * fall;
  const y = cy + 58 * fall;
  const pale = ramp(f, T.winter.in, T.winter.in + 50); // winter sun turns pale
  ctx.save();
  const cloud = ramp(f, T.monsoon.cloudIn + 10, T.monsoon.cloudIn + 50) * (1 - ramp(f, T.monsoon.cloudOut, T.monsoon.cloudOut + 40));
  ctx.globalAlpha = (1 - 0.62 * pale) * (1 - 0.85 * cloud);
  const s = A.sun.width * scale;
  ctx.drawImage(A.sun, cx - s / 2, y - s / 2, s, s);
  ctx.restore();
};

const drawSpring = (ctx: CanvasRenderingContext2D, A: Assets, f: number) => {
  const knock = 1 - 0.75 * ramp(f, T.spring.knock, T.spring.knock + 40);
  for (const b of A.blossoms) {
    const t = f - b.t;
    if (t <= 0) continue;
    const s = spring({ frame: t, fps: FPS, config: { damping: 9, stiffness: 120 } }) * knock;
    if (s <= 0.02) continue;
    const r = b.r * s;
    // wet edge: a darker ring at the bloom's rim, a softer body inside
    ctx.fillStyle = rgba(RED, b.a * 0.45);
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(RED, b.a);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + b.x;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(a) * r * 0.55, b.y + Math.sin(a) * r * 0.55, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // drifting petals, more of them once the rain arrives
  for (let i = 0; i < 70; i++) {
    const b = A.blossoms[i % A.blossoms.length];
    const t0 = T.spring.in + 30 + hash2(i, 3, 77) * 200;
    const t = f - t0;
    if (t < 0 || t > 160) continue;
    const x = b.x + t * (1.3 + hash2(i, 4, 77)) + Math.sin(t / 9 + i) * 12;
    const y = b.y + t * (1.6 + hash2(i, 5, 77) * 1.2);
    if (y > 1500) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t / 10 + i);
    ctx.fillStyle = rgba(RED, 0.75);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

const drawMonsoon = (ctx: CanvasRenderingContext2D, A: Assets, f: number, low: HTMLCanvasElement) => {
  const M = T.monsoon;
  if (f < M.cloudIn || f > M.cloudOut + 50) return;
  // clouds: ink arrives behind a ragged front with a darker wet band, then lifts away as mist
  const lctx = low.getContext('2d')!;
  const img = lctx.createImageData(A.cw, A.ch);
  const lift = ramp(f, M.cloudOut, M.cloudOut + 45);
  for (let i = 0; i < A.cw * A.ch; i++) {
    const t = A.cloudTime[i];
    if (f < t) continue;
    const e = f - t;
    const wet = e < 10 ? 1 + 0.9 * (1 - e / 10) : 1;
    const d = A.cloudDens[i] * wet * (e >= 1 ? 1 : 0.4 + 0.6 * e) * (1 - lift);
    const a = 1 - Math.exp(-d * 0.95);
    img.data[i * 4] = 27;
    img.data[i * 4 + 1] = 26;
    img.data[i * 4 + 2] = 24;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  lctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, W, H);
  ctx.restore();

  // rain: thin slanted strokes
  const rain = ramp(f, M.rainIn, M.rainIn + 25) * (1 - ramp(f, M.rainOut - 25, M.rainOut));
  if (rain > 0) {
    ctx.save();
    ctx.strokeStyle = rgba([27, 26, 24], 0.32 * rain);
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 300; i++) {
      const sp = 52 + hash2(i, 1, 33) * 26;
      const len = 36 + hash2(i, 2, 33) * 40;
      const y = ((hash2(i, 3, 33) * (H + 300) + f * sp) % (H + 300)) - 150;
      const x = hash2(i, 4, 33) * (W + 300) - 100 - y * 0.22;
      if (y > 1520) continue;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.22, y + len);
    }
    ctx.stroke();
    // ripples on the river
    for (let i = 0; i < 22; i++) {
      const period = 34 + hash2(i, 5, 33) * 20;
      const age = ((f + hash2(i, 6, 33) * period) % period) / period;
      const k = Math.floor((f + hash2(i, 6, 33) * period) / period);
      const rx = 360 + hash2(i, k, 34) * 660;
      const ry = 1305 + hash2(i, k, 35) * 215;
      ctx.strokeStyle = rgba([27, 26, 24], 0.38 * (1 - age) * rain);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 4 + age * 34, (4 + age * 34) * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
};

const drawAutumn = (ctx: CanvasRenderingContext2D, A: Assets, f: number) => {
  const { fans } = A.scene.geo;
  for (let i = 0; i < 64; i++) {
    const t0 = T.autumn.in + 4 + hash2(i, 1, 55) * (T.autumn.out - T.autumn.in - 40);
    const t = f - t0;
    if (t < 0 || t > 200 || f > T.winter.in + 24) continue;
    const fromTree = i % 3 !== 0;
    const [fx, fy] = fans[i % fans.length];
    const x0 = fromTree ? fx : -30;
    const y0 = fromTree ? fy : 600 + hash2(i, 2, 55) * 500;
    const vx = 2.6 + hash2(i, 3, 55) * 2.4;
    const vy = 1.3 + hash2(i, 4, 55) * 1.4;
    const x = x0 + t * vx + Math.sin(t / 11 + i) * 18;
    const y = y0 + t * vy + Math.sin(t / 7 + i * 2) * 6;
    if (y > 1510 || x > W + 30) continue;
    const s = 9 + hash2(i, 5, 55) * 7;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t / 14 + i);
    ctx.scale(1, Math.abs(Math.cos(t / 9 + i)) * 0.8 + 0.2); // tumbling
    ctx.fillStyle = i % 4 === 0 ? 'rgba(27,26,24,0.82)' : rgba(RED, 0.88);
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(0, -s * 0.62, s, 0);
    ctx.quadraticCurveTo(0, s * 0.62, -s, 0);
    ctx.fill();
    ctx.restore();
  }
};

const drawWinter = (ctx: CanvasRenderingContext2D, A: Assets, f: number) => {
  const g = ramp(f, T.winter.in, T.winter.in + 90);
  if (g <= 0) return;
  {
    const sctx = A.snowCanvas.getContext('2d')!;
    const img = sctx.createImageData(W, A.snowH);
    for (let i = 0; i < W * A.snowH; i++) {
      const t = A.snowT[i];
      if (f < t) continue;
      const e = f - t;
      img.data[i * 4] = 246;
      img.data[i * 4 + 1] = 243;
      img.data[i * 4 + 2] = 235;
      img.data[i * 4 + 3] = Math.round(A.snowA[i] * (e >= 3 ? 1 : 0.4 + 0.2 * e) * 255);
    }
    sctx.putImageData(img, 0, 0);
    ctx.drawImage(A.snowCanvas, 0, A.snowY0);
  }
  const { fans, contour } = A.scene.geo;
  ctx.save();
  ctx.fillStyle = PAPER;
  // snow along the cliff top and on the pine
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  contour.slice(0, 6).forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 2) : ctx.moveTo(x, y + 2)));
  for (let i = 5; i >= 0; i--) {
    const [x, y] = contour[i];
    ctx.lineTo(x, y + 2 + 16 * g * (0.6 + 0.4 * hash2(i, 9, 813)));
  }
  ctx.closePath();
  ctx.fill();
  fans.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.ellipse(x, y - 5, 19 * g, 6.5 * g, -0.05 * i, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // falling snow: paper-white flakes with a faint ink edge so they read on paper too
  const fl = ramp(f, T.winter.in, T.winter.in + 30);
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i < 170; i++) {
    const sp = 1.4 + hash2(i, 1, 66) * 1.6;
    const y = ((hash2(i, 2, 66) * (H + 100) + (f - T.winter.in) * sp * 2) % (H + 100)) - 50;
    if (y > 1520) continue;
    const x = hash2(i, 3, 66) * W + Math.sin(f / 25 + i) * 14;
    const r = 2 + hash2(i, 4, 66) * 3;
    ctx.globalAlpha = fl;
    ctx.fillStyle = '#FBFAF6';
    ctx.strokeStyle = 'rgba(27,26,24,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

// code that types itself out (and backspaces away when its season ends)
const MONO = 'InkMono';
const typeCode = (
  ctx: CanvasRenderingContext2D, code: string, comment: string, x: number, y: number, size: number,
  f: number, tStart: number, cps: number, tErase: number | null,
) => {
  if (f < tStart) return;
  const full = code + comment;
  let n = Math.min(full.length, Math.floor((f - tStart) * cps));
  if (tErase !== null && f >= tErase) n = Math.max(0, full.length - Math.floor((f - tErase) * cps * 1.6));
  if (n <= 0) return;
  ctx.save();
  ctx.font = `400 ${size}px ${MONO}`;
  const name = code.slice(0, code.indexOf('('));
  let cx = x;
  const seg = (txt: string, col: string) => {
    if (!txt) return;
    ctx.fillStyle = col;
    ctx.fillText(txt, cx, y);
    cx += ctx.measureText(txt).width;
  };
  const shown = full.slice(0, n);
  seg(shown.slice(0, Math.min(n, name.length)), INK);
  seg(shown.slice(name.length, Math.min(n, code.length)), '#6E6A62');
  seg(shown.slice(code.length), '#B8352A');
  // block cursor while typing
  const typing = n < full.length || (tErase !== null && f >= tErase);
  if (typing) {
    ctx.fillStyle = INK;
    ctx.fillRect(cx + 2, y - size * 0.78, size * 0.55, size * 0.95);
  }
  ctx.restore();
};

const drawText = (ctx: CanvasRenderingContext2D, A: Assets, f: number) => {
  // all text: x 80..960 (>=120 px from the right edge), baselines above y 1152 (top 60%)
  const big = `italic 400 150px ${FONT_ITALIC}`;
  const label = `400 58px ${FONT_REGULAR}`;
  const sub = `italic 400 54px ${FONT_ITALIC}`;
  const RED_HEX = '#B8352A';
  // hook — fully on screen in frame one, held to 2.5 s
  brushText(ctx, 'Same code.', 80, 350, big, f + 20, 0, T.hookOut[0] + 20, 1);
  brushText(ctx, 'Four seasons.', 80, 510, big, f + 14, 0, T.hookOut[1] + 14, 2);
  const FN = ['drawSpring(ctx, frame)', 'drawMonsoon(ctx, frame)', 'drawAutumn(ctx, frame)', 'drawWinter(ctx, frame)'];
  const seasons: [string, string, number[]][] = [
    ['I \u00B7 SPRING', 'the pine blossoms', T.springLabel],
    ['II \u00B7 MONSOON', 'the river swells', T.monsoonLabel],
    ['III \u00B7 AUTUMN', 'the sun sinks lower', T.autumnLabel],
    ['IV \u00B7 WINTER', 'the paper goes quiet', T.winterLabel],
  ];
  seasons.forEach(([l, s, [a, b]], i) => {
    brushText(ctx, l, 80, 330, label, f, a, b, 10 + i, 10);
    brushText(ctx, s, 80, 418, sub, f, a + 8, b, 20 + i);
    typeCode(ctx, FN[i], '', 80, 488, 36, f, a + 18, 2.2, b - 4);
  });
  // ending
  // ending: the four real calls that make the four seasons
  const endBig = `italic 400 112px ${FONT_ITALIC}`;
  brushText(ctx, '4 functions.', 80, 300, endBig, f, T.cta, null, 40);
  brushText(ctx, '4 seasons.', 80, 418, endBig, f, T.cta + 6, null, 41);
  const calls: [string, string][] = [
    ['drawSpring(ctx, frame);', '   // blossoms'],
    ['drawMonsoon(ctx, frame);', '  // clouds, rain'],
    ['drawAutumn(ctx, frame);', '   // falling leaves'],
    ['drawWinter(ctx, frame);', '   // snow'],
  ];
  calls.forEach(([c, cm], i) => typeCode(ctx, c, cm, 80, 500 + i * 44, 31, f, T.code + i * 6, 6, null));
  brushText(ctx, 'Comment SEASONS for the code.', 80, 716, `italic 400 52px ${FONT_ITALIC}`, f, T.ctaLine2, null, 42, 0, RED_HEX);
  // seal pressed last, top right beside the title (inside the 120 px margin)
  if (f >= T.seal) {
    const press = f < T.seal + 1 ? 0.7 : f < T.seal + 2 ? 0.9 : 1;
    ctx.save();
    ctx.globalAlpha = press;
    ctx.drawImage(A.seal, 880, 228);
    ctx.restore();
  }
};

// ---------------------------------------------------------------- component
let cache: Assets | null = null;
let fontsPromise: Promise<void> | null = null;
const loadFonts = () => {
  if (!fontsPromise) {
    const faces = [
      new FontFace(FONT_REGULAR, `url(${staticFile('CrimsonPro-Regular.ttf')})`),
      new FontFace(FONT_ITALIC, `url(${staticFile('CrimsonPro-Italic.ttf')})`, { style: 'italic' }),
      new FontFace('InkMono', `url(${staticFile('JetBrainsMono-Regular.ttf')})`),
    ];
    fontsPromise = Promise.all(faces.map((f) => f.load())).then((l) => l.forEach((f) => document.fonts.add(f)));
  }
  return fontsPromise;
};

export const Seasons: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);
  const lowRef = useRef<HTMLCanvasElement | null>(null);
  const [handle] = useState(() => delayRender('Building seasons scene'));
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    loadFonts().then(() => setReady(true));
  }, []);
  useLayoutEffect(() => {
    if (!ready || !ref.current) return;
    if (!cache) cache = buildAssets();
    if (!lowRef.current) lowRef.current = makeCanvas(cache.cw, cache.ch);
    const ctx = ref.current.getContext('2d')!;
    const fv = Math.min(f, T.freeze);
    ctx.drawImage(cache.base, 0, 0);
    drawSun(ctx, cache, fv);
    drawWinter(ctx, cache, fv); // snow caps sit on the mountains, under weather
    drawSpring(ctx, cache, fv);
    drawMonsoon(ctx, cache, fv, lowRef.current);
    drawAutumn(ctx, cache, fv);
    drawText(ctx, cache, fv);
    continueRender(handle);
  }, [ready, f, handle]);

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER }}>
      <Audio src={staticFile('seasons_audio.wav')} />
      <canvas ref={ref} width={W} height={H} style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
  );
};
