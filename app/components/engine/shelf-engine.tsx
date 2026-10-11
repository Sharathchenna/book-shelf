"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { hashString } from "@/lib/color";
import type { Item } from "@/lib/types";
import { useShelf } from "../shelf-provider";
import { DARK_PALETTE, hexToRgb, hull, inside, Iso, LIGHT_PALETTE, type RGB, type V3 } from "./iso";

/**
 * The Shelf Engine: the bookshelf as a machine. A turntable carries the shelf's own books,
 * driven through a gear train from a crank; a balance wheel ticks; on the central column an
 * open book turns its pages, and an odometer counts every page ever turned.
 *
 * Drag the crank to wind it. S slows time (1/20, then 1/100). E lifts the parts apart.
 */

const BOOKS_ON_TABLE = 34;
const TABLE_R = 100;
const RING_R = 80;
const PLATE_Z = 16;
const TABLE_Z = 22;
const TABLE_TOP = 27;
/** Gear train (pitch radii): centre wheel under the turntable, intermediate wheel, crank pinion. */
const CENTRE = { r: 44, teeth: 60 };
const INTER = { r: 26, teeth: 36, at: polar(72, -0.44) };
const PINION = { r: 12, teeth: 14, at: polar(112, -0.44) };
const BALANCE_AT = polar(114, 0.36);
const ODOMETER = { a: 1.25, r: 113 };
const CRANK_ARM = 17;
const SPEEDS = [1, 1 / 20, 1 / 100];
const SPEED_LABEL = ["1×", "1/20 speed", "1/100 speed"];

function polar(r: number, a: number): [number, number] {
  return [r * Math.cos(a), r * Math.sin(a)];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function lerp(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The machine's state, advanced each frame. */
type Sim = {
  /** Turntable angle. */
  theta: number;
  crank: number;
  balance: number;
  /** Mainspring, 0–1. */
  reserve: number;
  flipT: number;
  /** Progress of the page being turned, or -1 between turns. */
  flipping: number;
  pages: number;
  /** Odometer roll after a page lands, 1 → 0. */
  roll: number;
  /** Eased towards 1 when pulled apart. */
  apart: number;
  /** Eased towards 1 while a book is hovered, slowing the turntable so it can be clicked. */
  brake: number;
};

/** Where interactive things landed on screen in the last frame. */
type Hits = {
  books: { item: Item; poly: [number, number][] }[];
  crank: [number, number] | null;
  pivot: [number, number] | null;
};

type Scene = { items: Item[]; table: Item[]; lectern: Item | undefined; hoverId: string | null };

// ---- drawing ---------------------------------------------------------------------------------

function draw(el: HTMLCanvasElement, s: Sim, scene: Scene, hits: Hits) {
  const dpr = window.devicePixelRatio || 1;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }
  const ctx = el.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pal = document.documentElement.dataset.theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  // Fit the whole machine, including the column lifted apart (-185) down to the case shadow (+110).
  const scale = Math.min(w / 360, h / 300);
  const iso = new Iso(ctx, w / 2, h / 2 + 37 * scale, scale, pal);
  const e = ease(Math.min(1, Math.max(0, s.apart)));
  const lift = { table: 30 * e, books: 46 * e, column: 72 * e, bridge: 16 * e };
  const metal = pal.metal;

  // Soft contact shadow under the case.
  const [sx, sy0] = iso.p([0, 0, 0]);
  const sy = sy0 + 8 * scale;
  const g = ctx.createRadialGradient(sx, sy, 10, sx, sy, 175 * scale);
  g.addColorStop(0, pal.shadow);
  g.addColorStop(1, "transparent");
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, 0.5);
  ctx.translate(-sx, -sy);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, 175 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ---- the case: knurled bezel, plate, screws, engraving
  iso.cylinder(0, 0, 0, 9, 140, { knurl: 150 });
  iso.cylinder(0, 0, 9, 12, 135);
  iso.cylinder(0, 0, 12, PLATE_Z, 131);
  for (const r of [126, 121]) iso.poly(iso.circle(0, 0, PLATE_Z, r, 64), null, pal.hairline, 0.6);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31;
    // Leave room for the odometer, the engraving and the crank.
    if ([1.25, 2.05, 5.84].some((at) => Math.abs(a - at) < 0.3)) continue;
    iso.screw(124 * Math.cos(a), 124 * Math.sin(a), PLATE_Z, 3.2, a * 2.7);
  }
  iso.text(
    `${scene.items.length.toLocaleString("en-US")} VOLUMES · THE SHELF ENGINE`,
    [-54, 104, PLATE_Z],
    [0.89, 0.46, 0],
    [-0.46, 0.89, 0],
    3.6,
    { color: pal.text },
  );

  // ---- gear train under the turntable (seen when the parts are lifted apart)
  iso.gear(0, 0, PLATE_Z, PLATE_Z + 2.6, CENTRE.r, CENTRE.teeth, s.theta, { spokes: 5 });
  iso.gear(INTER.at[0], INTER.at[1], PLATE_Z, PLATE_Z + 2.6, INTER.r, INTER.teeth, -s.theta * (CENTRE.r / INTER.r) + 0.05, { spokes: 4 });

  // ---- turntable: its knurled edge is the ring the train drives
  const tz = TABLE_Z + lift.table;
  iso.cylinder(0, 0, tz, tz + (TABLE_TOP - TABLE_Z), TABLE_R, { knurl: 110, rotation: s.theta });
  for (const r of [94, 62, 30]) iso.poly(iso.circle(0, 0, tz + 5, r, 64), null, pal.hairline, 0.6);
  for (let k = 0; k < 6; k++) {
    const a = s.theta + (k / 6) * Math.PI * 2;
    iso.screw(46 * Math.cos(a), 46 * Math.sin(a), tz + 5, 2.4, a * 3);
  }

  // ---- everything standing up, painted back to front
  const parts: { depth: number; draw: () => void }[] = [];
  const bookHits: Hits["books"] = [];
  const baseZ = TABLE_TOP + lift.books;

  scene.table.forEach((item, i) => {
    const a = s.theta + (i / scene.table.length) * Math.PI * 2;
    const thick = Math.min(11, Math.max(4.5, (item.pages ?? 300) / 70));
    const hard = (item.format ?? "").toLowerCase().includes("hard");
    const height = (hard ? 33 : 28) + (hashString(item.id) % 5);
    const c: V3 = [RING_R * Math.cos(a), RING_R * Math.sin(a), baseZ + (scene.hoverId === item.id ? 5 : 0)];
    const rot = a + Math.PI / 2;
    const color = hexToRgb(item.color);
    const coverTone: RGB = [color[0] * 0.92, color[1] * 0.92, color[2] * 0.92];
    parts.push({
      depth: c[0] + c[1] + c[2],
      draw: () => {
        // Spine out (-y), fore-edge in (+y), covers on the sides, page block on top.
        iso.box(
          c,
          [thick, 16, height],
          rot,
          (face) => (face === "-y" ? color : face === "+y" || face === "top" ? pal.paper : coverTone),
          (face, pts) => {
            if (face === "top") iso.line(lerp(pts[0], pts[3], 0.5), lerp(pts[1], pts[2], 0.5), pal.ink, 0.5);
            if (face === "-y") {
              iso.line(lerp(pts[0], pts[3], 0.82), lerp(pts[1], pts[2], 0.82), "rgba(255,255,255,0.35)", 0.6);
              iso.line(lerp(pts[0], pts[3], 0.18), lerp(pts[1], pts[2], 0.18), "rgba(255,255,255,0.35)", 0.6);
            }
          },
        );
        bookHits.push({ item, poly: hull(iso.boxCorners(c, [thick, 16, height], rot).map((pt) => iso.p(pt))) });
      },
    });
  });

  // Centre column, collar, lectern and the open book.
  const cz = TABLE_TOP + lift.column;
  parts.push({
    depth: 40 + lift.column,
    draw: () => {
      iso.cylinder(0, 0, tz + 5, tz + 9, 22, { knurl: 48, rotation: -s.theta });
      iso.cylinder(0, 0, cz, cz + 44, 13);
      iso.cylinder(0, 0, cz + 44, cz + 48, 36);
      iso.ring(0, 0, cz + 48, 33, 35.5, iso.shade(metal, [0, 0, 1], -0.06));
      drawOpenBook(iso, cz + 48, s, scene.lectern);
    },
  });

  // Crank pinion and crank, outside the turntable.
  const [px, py] = PINION.at;
  const kx = px + CRANK_ARM * Math.cos(s.crank);
  const ky = py + CRANK_ARM * Math.sin(s.crank);
  parts.push({
    depth: px + py + 20,
    draw: () => {
      iso.gear(px, py, PLATE_Z, PLATE_Z + 3, PINION.r, PINION.teeth, s.theta * (CENTRE.r / PINION.r) + 0.2);
      iso.cylinder(px, py, PLATE_Z + 4, 44, 2.6);
      iso.box([(px + kx) / 2, (py + ky) / 2, 44], [CRANK_ARM + 6, 6, 2.6], s.crank, () => metal);
      iso.cylinder(kx, ky, 46.6, 58, 4, { knurl: 18, rotation: s.crank * 2 });
      hits.crank = iso.p([kx, ky, 52]);
      hits.pivot = iso.p([px, py, 44]);
    },
  });

  // Balance wheel under its bridge: oscillates, with a hairspring that breathes with it.
  const [bx, by] = BALANCE_AT;
  const swing = Math.sin(s.balance) * ((200 + 95 * s.reserve) * Math.PI) / 360;
  parts.push({
    depth: bx + by + 22,
    draw: () => {
      iso.cylinder(bx, by, PLATE_Z, PLATE_Z + 2, 3.2);
      const spring: V3[] = [];
      for (let k = 0; k <= 90; k++) {
        const f = k / 90;
        const ang = f * Math.PI * 9 + swing * (1 - f);
        const r = 1.5 + f * 8;
        spring.push([bx + r * Math.cos(ang), by + r * Math.sin(ang), PLATE_Z + 3]);
      }
      iso.poly(spring, null, pal.line, 0.5);
      iso.ring(bx, by, PLATE_Z + 6, 11.2, 13.2, iso.shade(metal, [0, 0, 1]));
      for (let k = 0; k < 3; k++) {
        const a = swing + (k / 3) * Math.PI * 2;
        iso.line([bx, by, PLATE_Z + 6], [bx + 11.2 * Math.cos(a), by + 11.2 * Math.sin(a), PLATE_Z + 6], pal.line, 1.2);
      }
      for (let k = 0; k < 8; k++) {
        const a = swing + (k / 8) * Math.PI * 2;
        iso.cylinder(bx + 13.2 * Math.cos(a), by + 13.2 * Math.sin(a), PLATE_Z + 5.4, PLATE_Z + 6.6, 0.9);
      }
      const bz = PLATE_Z + 9 + lift.bridge;
      iso.box([bx - 4, by - 9, bz], [8, 34, 3], -0.62, () => metal);
      iso.cylinder(bx, by, bz + 3, bz + 4.4, 3.4);
      iso.screw(bx - 13, by - 21, bz + 3, 2.4, 0.9);
      iso.screw(bx + 5.5, by + 3.5, bz + 3, 2.2, 2.1);
    },
  });

  // Odometer: every page ever turned; the last wheel rolls as each page lands.
  const [ox, oy] = polar(ODOMETER.r, ODOMETER.a);
  parts.push({ depth: ox + oy + 20, draw: () => drawOdometer(iso, [ox, oy, PLATE_Z], ODOMETER.a, s) });

  parts.sort((a, b) => a.depth - b.depth).forEach((p) => p.draw());
  hits.books = bookHits;
}

function drawOpenBook(iso: Iso, z: number, s: Sim, book: Item | undefined) {
  const pal = iso.pal;
  iso.box([0, 0, z], [54, 38, 1.6], 0, () => hexToRgb(book?.color ?? "#2f5d4a"));
  const pz = z + 1.6;
  const pageLines = (x0: number, x1: number, zz: number) => {
    for (let k = 0; k < 9; k++) {
      const y = -14 + k * 3.3;
      iso.line([x0, y, zz], [x1, y, zz], pal.ink, 0.5);
    }
  };
  iso.box([-13, 0, pz], [25, 35, 3], 0, () => pal.paper);
  iso.box([13, 0, pz], [25, 35, 3], 0, () => pal.paper);
  pageLines(-23, -4, pz + 3);
  pageLines(4, 23, pz + 3);
  // The turning page: hinged at the spine, curling as it lifts and falls.
  if (s.flipping >= 0) {
    const phi = ease(s.flipping) * Math.PI;
    const curl = Math.sin(phi) * 7;
    const edge = (y: number) => {
      const out: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        const u = f * 25;
        const bend = Math.sin(f * Math.PI) * curl * 0.35;
        out.push([u * Math.cos(phi) - bend * Math.sin(phi), y, pz + 3 + u * Math.sin(phi) + bend * Math.cos(phi) * 0.4 + f * curl * Math.sin(phi) * 0.2]);
      }
      return out;
    };
    const near = edge(17.5);
    const far = edge(-17.5).reverse();
    // Shade whichever side of the page faces the viewer: the front while it lifts, the back as it falls.
    const front: V3 = [-Math.sin(phi), 0, Math.cos(phi)];
    const facing = front[0] + front[2] >= 0;
    iso.poly([...near, ...far], iso.shade(pal.paper, facing ? front : [-front[0], 0, -front[2]], facing ? 0 : -0.03), pal.line, 0.6);
  }
  // A ribbon from the spine.
  iso.poly(
    [
      [0.5, 17.5, pz + 3],
      [2.5, 17.5, pz + 3],
      [3.5, 25, pz - 2],
      [1.5, 24, pz - 1],
    ],
    pal.accent,
    null,
  );
}

function drawOdometer(iso: Iso, at: V3, a: number, s: Sim) {
  const pal = iso.pal;
  const rot = a - Math.PI / 2;
  iso.box(at, [46, 14, 14], rot, () => pal.metal);
  // Digit windows on the outward face (local +y), drawn in that face's plane.
  const ux: V3 = [Math.cos(rot), Math.sin(rot), 0];
  const out: V3 = [-Math.sin(rot), Math.cos(rot), 0];
  const face: V3 = [at[0] + out[0] * 7.01, at[1] + out[1] * 7.01, at[2] + 7];
  const digits = String(s.pages).padStart(6, "0").slice(-6);
  const prev = String(s.pages - 1).padStart(6, "0").slice(-6);
  const { ctx } = iso;
  const [fx, fy] = iso.p(face);
  const [uxs, uys] = iso.p([face[0] + ux[0], face[1] + ux[1], face[2]]);
  const [vxs, vys] = iso.p([face[0], face[1], face[2] - 1]);
  const dark = document.documentElement.dataset.theme === "dark";
  ctx.save();
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([uxs - fx, uys - fy, vxs - fx, vys - fy, fx, fy])));
  ctx.font = "600 6.4px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let k = 0; k < 6; k++) {
    const x = -19.5 + k * 6.8;
    ctx.fillStyle = k === 5 ? pal.accent : dark ? "#141816" : "#26302b";
    ctx.fillRect(x - 2.8, -4.4, 5.6, 8.8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 2.8, -4.4, 5.6, 8.8);
    ctx.clip();
    ctx.fillStyle = "#f4f2ea";
    const rolling = digits[k] !== prev[k] && s.roll > 0;
    const off = rolling ? -s.roll * 8.8 : 0;
    ctx.fillText(digits[k], x, 0.4 - off);
    if (rolling) ctx.fillText(prev[k], x, 0.4 - off - 8.8);
    ctx.restore();
  }
  ctx.restore();
  iso.text("PAGES TURNED", [face[0], face[1], at[2] + 13.2], ux, [0, 0, -1], 2.6, { color: pal.text });
}

// ---- the component ----------------------------------------------------------------------------

export function ShelfEngine({ pagesTurned }: { pagesTurned: number }) {
  const { items, openBook } = useShelf();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(0);
  const [apart, setApart] = useState(false);
  const [readout, setReadout] = useState("");
  const [hover, setHover] = useState<Item | null>(null);
  const [visible, setVisible] = useState(false);

  // A stable, varied selection of the shelf for the turntable, and the book open on the lectern.
  const table = useMemo(
    () => items.toSorted((a, b) => hashString(a.id) - hashString(b.id)).slice(0, BOOKS_ON_TABLE),
    [items],
  );
  const lectern = useMemo(() => items.find((i) => i.status === "reading") ?? items[0], [items]);

  const sim = useRef<Sim>({ theta: 0, crank: 0, balance: 0, reserve: 0.65, flipT: 0, flipping: -1, pages: pagesTurned, roll: 0, apart: 0, brake: 0 });
  const hits = useRef<Hits>({ books: [], crank: null, pivot: null });
  const drag = useRef<{ angle: number } | null>(null);
  const lastReadout = useRef("");

  const frame = useEffectEvent((dt: number) => {
    const el = canvas.current;
    if (!el) return;
    const s = sim.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = reduced ? 0 : dt * SPEEDS[speed];

    // Mainspring: the reserve runs down; the train runs faster when wound.
    s.reserve = Math.max(0.08, s.reserve - t * 0.0035);
    const drive = 0.35 + 0.95 * s.reserve;
    s.brake += ((hover ? 1 : 0) - s.brake) * Math.min(1, dt * 6);
    if (!drag.current) {
      const dTheta = ((Math.PI * 2) / 90) * drive * t * (1 - 0.9 * s.brake);
      s.theta += dTheta;
      s.crank += dTheta * (CENTRE.r / PINION.r);
    }
    s.balance += Math.PI * 2 * 2.5 * t;
    s.flipT += t * drive;
    if (s.flipping < 0 && s.flipT > 2.4) {
      s.flipping = 0;
      s.flipT = 0;
    }
    if (s.flipping >= 0) {
      s.flipping += t / 1.15;
      if (s.flipping >= 1) {
        s.flipping = -1;
        s.pages += 1;
        s.roll = 1;
      }
    }
    s.roll = Math.max(0, s.roll - t * 3);
    s.apart += ((apart ? 1 : 0) - s.apart) * Math.min(1, dt * 4.5);

    draw(el, s, { items, table, lectern, hoverId: hover?.id ?? null }, hits.current);

    const amplitude = Math.round(200 + 95 * s.reserve);
    const text = `${SPEED_LABEL[speed]} · page ${s.pages.toLocaleString("en-US")} · amplitude ${amplitude}° · reserve ${Math.round(s.reserve * 100)}%`;
    // Re-render the legend only when its text changes, not every frame.
    if (text !== lastReadout.current) {
      lastReadout.current = text;
      setReadout(text);
    }
  });

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) frame(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // Only run while on screen.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Keyboard: S slow, E apart, while the engine is on screen and nothing else wants the keys.
  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!visible || ev.metaKey || ev.ctrlKey || ev.altKey || document.querySelector("dialog[open]")) return;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (ev.key === "s" || ev.key === "S") setSpeed((v) => (v + 1) % SPEEDS.length);
    else if (ev.key === "e" || ev.key === "E") setApart((v) => !v);
  });
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => onKey(ev);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const local = (ev: React.PointerEvent): [number, number] => {
    const r = ev.currentTarget.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const nearCrank = (pt: [number, number]) => {
    const c = hits.current.crank;
    return c ? Math.hypot(pt[0] - c[0], pt[1] - c[1]) < 26 : false;
  };
  const bookAt = (pt: [number, number]) => hits.current.books.findLast((b) => inside(pt, b.poly))?.item ?? null;

  return (
    <div ref={wrap} className="relative mx-auto max-w-6xl">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`The Shelf Engine: a turntable of ${table.length} books from the shelf, driven by a gear train and a crank, with an open book turning its pages and an odometer counting every page turned.`}
        className="mx-auto block aspect-[1.25] w-full max-w-[52rem] touch-pan-y select-none"
        onPointerMove={(ev) => {
          const pt = local(ev);
          const el = ev.currentTarget;
          if (drag.current) {
            const [cx, cy] = hits.current.pivot ?? pt;
            const angle = Math.atan2(pt[1] - cy, pt[0] - cx);
            let delta = angle - drag.current.angle;
            if (delta > Math.PI) delta -= Math.PI * 2;
            if (delta < -Math.PI) delta += Math.PI * 2;
            drag.current.angle = angle;
            // Turning the crank winds the mainspring and drives the train through the gears.
            const s = sim.current;
            s.crank += delta;
            s.theta += delta * (PINION.r / CENTRE.r);
            s.reserve = Math.min(1, s.reserve + Math.abs(delta) / (Math.PI * 6));
            return;
          }
          const book = bookAt(pt);
          if (book?.id !== hover?.id) setHover(book);
          el.style.cursor = book ? "pointer" : nearCrank(pt) ? "grab" : "";
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(ev) => {
          const pt = local(ev);
          if (!nearCrank(pt)) return;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          const [cx, cy] = hits.current.pivot ?? pt;
          drag.current = { angle: Math.atan2(pt[1] - cy, pt[0] - cx) };
          ev.currentTarget.style.cursor = "grabbing";
        }}
        onPointerUp={(ev) => {
          if (drag.current) {
            drag.current = null;
            ev.currentTarget.style.cursor = "grab";
            return;
          }
          const book = bookAt(local(ev));
          if (book) openBook(book.id, table.map((b) => b.id));
        }}
      />

      {/* Legend, like an instrument's: controls and a live readout. */}
      <div className="mx-auto mt-2 flex max-w-md flex-col items-center gap-2 text-[13px] text-muted lg:absolute lg:top-6 lg:right-0 lg:mt-0 lg:items-start">
        <p>Drag the crank ↻ to wind</p>
        <div className="flex gap-4 lg:flex-col lg:gap-1.5">
          <KeyHint k="S" label={speed ? SPEED_LABEL[speed] : "slow"} active={speed > 0} onClick={() => setSpeed((v) => (v + 1) % SPEEDS.length)} />
          <KeyHint k="E" label="apart" active={apart} onClick={() => setApart((v) => !v)} />
        </div>
        <p className="mt-1 max-w-72 text-center text-[12px] text-fg/80 tabular-nums lg:text-left">
          {hover ? `${hover.title} · ${hover.author}` : readout}
        </p>
      </div>
    </div>
  );
}

function KeyHint({ k, label, active, onClick }: { k: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-center gap-2 transition-colors hover:text-fg aria-pressed:text-fg"
    >
      <kbd className="grid size-5 place-items-center rounded-md bg-chip font-sans text-[11px] font-semibold text-fg ring-1 ring-line [[aria-pressed=true]>&]:bg-ink [[aria-pressed=true]>&]:text-ink-fg">
        {k}
      </kbd>
      {label}
    </button>
  );
}
