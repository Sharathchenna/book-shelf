/**
 * A small isometric drawing kit for canvas: true-isometric projection, solid parts shaded by
 * the way each face turns to the light, painted back to front. World axes: x and y on the
 * ground (x toward the lower right of the screen, y toward the lower left), z up.
 */

export type V3 = [number, number, number];
export type RGB = [number, number, number];

const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** Direction the camera looks from; faces whose normals point this way are visible. */
const VIEW: V3 = [1, 1, 1];
/** Light from upper left-front, so tops are brightest and the two sides read differently. */
const LIGHT = normalize([0.15, 0.62, 1]);

export function normalize([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export type Palette = {
  /** Base colour of machined parts. */
  metal: RGB;
  /** Linework. */
  line: string;
  /** Fine detail lines (engraving). */
  hairline: string;
  paper: RGB;
  /** Marks on paper (page text, the page block). */
  ink: string;
  shadow: string;
  text: string;
  accent: string;
};

export const LIGHT_PALETTE: Palette = {
  metal: [246, 246, 243],
  line: "rgba(48, 50, 48, 0.62)",
  hairline: "rgba(48, 50, 48, 0.2)",
  paper: [251, 249, 243],
  ink: "rgba(48, 50, 48, 0.22)",
  shadow: "rgba(30, 40, 35, 0.16)",
  text: "rgba(40, 42, 40, 0.75)",
  accent: "#1e7a58",
};

export const DARK_PALETTE: Palette = {
  metal: [46, 52, 49],
  line: "rgba(220, 228, 222, 0.42)",
  hairline: "rgba(220, 228, 222, 0.14)",
  paper: [192, 188, 176],
  ink: "rgba(24, 28, 26, 0.3)",
  shadow: "rgba(0, 0, 0, 0.45)",
  text: "rgba(225, 230, 226, 0.75)",
  accent: "#4cc493",
};

export class Iso {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly ox: number,
    readonly oy: number,
    readonly s: number,
    readonly pal: Palette,
  ) {}

  p([x, y, z]: V3): [number, number] {
    return [this.ox + (x - y) * C * this.s, this.oy + ((x + y) * S - z) * this.s];
  }

  /** Shade a base colour for a face with the given normal. */
  shade(base: RGB, normal: V3, boost = 0): string {
    const lit = 0.8 + 0.2 * Math.max(0, dot(normalize(normal), LIGHT)) + boost;
    const [r, g, b] = base.map((c) => Math.round(Math.min(255, c * lit)));
    return `rgb(${r},${g},${b})`;
  }

  path(points: V3[]) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((pt, i) => {
      const [x, y] = this.p(pt);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  poly(points: V3[], fill: string | CanvasGradient | null, stroke: string | null = this.pal.line, width = 0.7) {
    const { ctx } = this;
    this.path(points);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  line(a: V3, b: V3, stroke = this.pal.line, width = 0.7) {
    const { ctx } = this;
    const [ax, ay] = this.p(a);
    const [bx, by] = this.p(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  /**
   * A box centred at `c` with size [w, d, h] (h upward from c[2]), turned `rot` radians about z.
   * `faceColor` picks a base colour per face: "top", "+x", "-x", "+y", "-y" in the box's own frame.
   */
  box(c: V3, [w, d, h]: V3, rot: number, faceColor: (face: BoxFace) => RGB, decorate?: (face: BoxFace, corners: V3[]) => void) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const at = (lx: number, ly: number, lz: number): V3 => [c[0] + lx * cos - ly * sin, c[1] + lx * sin + ly * cos, c[2] + lz];
    const hw = w / 2;
    const hd = d / 2;
    const faces: { face: BoxFace; n: V3; pts: V3[] }[] = [
      { face: "+x", n: [cos, sin, 0], pts: [at(hw, -hd, 0), at(hw, hd, 0), at(hw, hd, h), at(hw, -hd, h)] },
      { face: "-x", n: [-cos, -sin, 0], pts: [at(-hw, hd, 0), at(-hw, -hd, 0), at(-hw, -hd, h), at(-hw, hd, h)] },
      { face: "+y", n: [-sin, cos, 0], pts: [at(hw, hd, 0), at(-hw, hd, 0), at(-hw, hd, h), at(hw, hd, h)] },
      { face: "-y", n: [sin, -cos, 0], pts: [at(-hw, -hd, 0), at(hw, -hd, 0), at(hw, -hd, h), at(-hw, -hd, h)] },
      { face: "top", n: [0, 0, 1], pts: [at(-hw, -hd, h), at(hw, -hd, h), at(hw, hd, h), at(-hw, hd, h)] },
    ];
    for (const f of faces) {
      if (dot(f.n, VIEW) <= 0) continue;
      this.poly(f.pts, this.shade(faceColor(f.face), f.n));
      decorate?.(f.face, f.pts);
    }
  }

  /** Corners of a box, for hit-testing. */
  boxCorners(c: V3, [w, d, h]: V3, rot: number): V3[] {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const out: V3[] = [];
    for (const lx of [-w / 2, w / 2]) for (const ly of [-d / 2, d / 2]) for (const lz of [0, h]) {
      out.push([c[0] + lx * cos - ly * sin, c[1] + lx * sin + ly * cos, c[2] + lz]);
    }
    return out;
  }

  circle(cx: number, cy: number, z: number, r: number, n = 48, a0 = 0, a1 = Math.PI * 2): V3[] {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
    }
    return out;
  }

  /**
   * A vertical cylinder from z0 to z1. Its side is lit like turned metal; `knurl` adds the
   * fine grooves of a crown or bezel, `rotation` turns them.
   */
  cylinder(cx: number, cy: number, z0: number, z1: number, r: number, opts: { base?: RGB; top?: RGB; knurl?: number; rotation?: number; stroke?: string | null } = {}) {
    const base = opts.base ?? this.pal.metal;
    // The visible half of the side: normals facing the camera (cos a + sin a > 0).
    const a0 = -Math.PI / 4;
    const a1 = (Math.PI * 3) / 4;
    const bottom = this.circle(cx, cy, z0, r, 32, a0, a1);
    const top = this.circle(cx, cy, z1, r, 32, a1, a0);
    if (z1 - z0 > 0.01) {
      const [lx] = this.p([cx + r * Math.cos(a1), cy + r * Math.sin(a1), z0]);
      const [rx] = this.p([cx + r * Math.cos(a0), cy + r * Math.sin(a0), z0]);
      const g = this.ctx.createLinearGradient(lx, 0, rx, 0);
      g.addColorStop(0, this.shade(base, [-0.7, 0.7, 0], -0.12));
      g.addColorStop(0.35, this.shade(base, [0, 1, 0.2], 0.04));
      g.addColorStop(0.75, this.shade(base, [1, 0, 0], -0.05));
      g.addColorStop(1, this.shade(base, [1, -0.5, 0], -0.14));
      this.poly([...bottom, ...top], g, opts.stroke === undefined ? this.pal.line : opts.stroke);
      if (opts.knurl) {
        const step = (Math.PI * 2) / opts.knurl;
        const off = ((opts.rotation ?? 0) % step + step) % step;
        for (let a = a0 + off; a < a1; a += step) {
          this.line([cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + 0.4], [cx + r * Math.cos(a), cy + r * Math.sin(a), z1 - 0.4], this.pal.hairline, 0.6);
        }
      }
    }
    this.poly(this.circle(cx, cy, z1, r), this.shade(opts.top ?? base, [0, 0, 1]), opts.stroke === undefined ? this.pal.line : opts.stroke);
  }

  /** Outline of a gear in its plane: `teeth` trapezoid teeth between radii rRoot and rTip. */
  gearOutline(cx: number, cy: number, z: number, rRoot: number, rTip: number, teeth: number, rot: number): V3[] {
    const out: V3[] = [];
    const pitch = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
      const a = rot + i * pitch;
      for (const [f, r] of [[0, rRoot], [0.18, rTip], [0.5, rTip], [0.68, rRoot]] as const) {
        const ang = a + f * pitch;
        out.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang), z]);
      }
    }
    return out;
  }

  /** A toothed wheel, thickness z0..z1, with a hub, spokes cut out and an arbor. */
  gear(cx: number, cy: number, z0: number, z1: number, rRoot: number, teeth: number, rot: number, opts: { spokes?: number; base?: RGB } = {}) {
    const base = opts.base ?? this.pal.metal;
    const rTip = rRoot + Math.max(1.6, rRoot * 0.12);
    // Extrude by stacking outlines: reads as a solid edge at this scale.
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const z = z0 + ((z1 - z0) * i) / layers;
      this.poly(this.gearOutline(cx, cy, z, rRoot, rTip, teeth, rot), this.shade(base, [0.6, 0.6, 0], -0.1), i === 0 ? this.pal.line : null);
    }
    this.poly(this.gearOutline(cx, cy, z1, rRoot, rTip, teeth, rot), this.shade(base, [0, 0, 1]));
    // Spoke windows: dark cut-outs between the rim and the hub.
    const spokes = opts.spokes ?? (rRoot > 14 ? 4 : 0);
    if (spokes) {
      const inner = rRoot * 0.32;
      const outer = rRoot * 0.78;
      const span = (Math.PI * 2) / spokes;
      for (let k = 0; k < spokes; k++) {
        const a = rot + k * span + span * 0.16;
        const b = rot + (k + 1) * span - span * 0.16;
        const win = [...this.circle(cx, cy, z1, outer, 10, a, b), ...this.circle(cx, cy, z1, inner, 6, b, a)];
        this.poly(win, this.shade(base, [0, 0, 1], -0.22), this.pal.hairline);
      }
    }
    this.cylinder(cx, cy, z1, z1 + 1.4, Math.max(2, rRoot * 0.14));
  }

  /** A flat ring (annulus) in a horizontal plane. */
  ring(cx: number, cy: number, z: number, r0: number, r1: number, fill: string) {
    const { ctx } = this;
    ctx.beginPath();
    this.circle(cx, cy, z, r1).forEach((pt, i) => {
      const [x, y] = this.p(pt);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    this.circle(cx, cy, z, r0).reverse().forEach((pt, i) => {
      const [x, y] = this.p(pt);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.fillStyle = fill;
    ctx.fill("evenodd");
    ctx.strokeStyle = this.pal.line;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  /** A blued-steel style screw head with its slot. */
  screw(cx: number, cy: number, z: number, r: number, slot: number) {
    this.cylinder(cx, cy, z, z + r * 0.45, r);
    const dx = Math.cos(slot) * r * 0.8;
    const dy = Math.sin(slot) * r * 0.8;
    this.line([cx - dx, cy - dy, z + r * 0.45], [cx + dx, cy + dy, z + r * 0.45], this.pal.line, 1.1);
  }

  /** Text lying in a plane through `origin`, running along `u`, with `v` pointing down the glyphs. */
  text(str: string, origin: V3, u: V3, v: V3, size: number, opts: { color?: string; align?: CanvasTextAlign; font?: string } = {}) {
    const { ctx } = this;
    const [ox, oy] = this.p(origin);
    const [ux, uy] = this.p([origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]]);
    const [vx, vy] = this.p([origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]]);
    ctx.save();
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([ux - ox, uy - oy, vx - ox, vy - oy, ox, oy])));
    ctx.font = opts.font ?? `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = opts.color ?? this.pal.text;
    ctx.textAlign = opts.align ?? "center";
    ctx.textBaseline = "middle";
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
}

export type BoxFace = "top" | "+x" | "-x" | "+y" | "-y";

/** Convex hull of projected points (for hit-testing a part on screen). */
export function hull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function inside([x, y]: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
