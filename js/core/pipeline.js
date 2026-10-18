// Operations registry and pipeline — the same model as kirson/core/pipeline.py:
// an operation has parameters (sliders, choices, hidden values), a UI category and an
// optional `active` test; the pipeline caches every step's output, so moving one slider
// recomputes only that step and the ones after it.

export const REGISTRY = {};

export function P(name, label, min, max, def = 0, extra = {}) {
  return { name, label, min, max, def, options: null, hidden: false, ...extra };
}
export function choice(name, label, options, def = 0) {
  return { name, label, min: 0, max: options.length - 1, def, options, hidden: false };
}
export function hidden(name, def) {
  return { name, label: name, min: 0, max: 0, def, options: null, hidden: true };
}

export function register(id, label, params, apply, { category = "Коррекция", active = null } = {}) {
  if (REGISTRY[id]) throw new Error(`operation ${id} already registered`);
  REGISTRY[id] = { id, label, params, apply, category, active };
}

export function defaults(op) {
  const v = {};
  for (const p of op.params) v[p.name] = p.def;
  return v;
}

export function isIdentity(op, values) {
  const v = { ...defaults(op), ...values };
  if (op.active) return !op.active(v);
  return op.params.every((p) => JSON.stringify(v[p.name]) === JSON.stringify(p.def));
}

export class Context {
  // noCache: do not keep every step's output (export: at 12 MP each is 36 MB)
  constructor(scale = 1, cache = new Map(), { noCache = false } = {}) {
    this.scale = scale;
    this.cache = cache; // also holds the face analysis, masks, step outputs
    this.noCache = noCache;
  }
}

export class Pipeline {
  constructor(steps = []) {
    this.steps = steps; // [{op, values, enabled}]
  }

  static fromOrder(order) {
    return new Pipeline(order.filter((id) => REGISTRY[id]).map((op) => ({ op, values: {}, enabled: true })));
  }

  static fromJSON(data) {
    return new Pipeline(data.steps.map((s) => ({ op: s.op, values: { ...(s.values || {}) }, enabled: s.enabled !== false })));
  }

  toJSON() {
    return { steps: this.steps.map((s) => ({ op: s.op, values: { ...s.values }, enabled: s.enabled })) };
  }

  step(op) {
    return this.steps.find((s) => s.op === op);
  }

  run(img, ctx = new Context()) {
    ctx.cache.set("_source", img);
    let cache = ctx.cache.get("_pipeline");
    if (!cache) ctx.cache.set("_pipeline", (cache = new Map()));
    let sig = `${img.w}x${img.h}:${ctx.cache.get("_imageId") || ""}`;
    let out = img;
    this.steps.forEach((step, i) => {
      const op = REGISTRY[step.op];
      if (!op) return;
      const values = { ...defaults(op), ...step.values };
      if (!step.enabled || isIdentity(op, values)) return;
      sig += `|${step.op}:${JSON.stringify(values)}`;
      const hit = cache.get(i);
      if (hit && hit.sig === sig) out = hit.out;
      else {
        const t0 = performance.now();
        out = op.apply(out, values, ctx);
        (ctx.timings ||= {})[step.op] = Math.round(performance.now() - t0);
        if (!ctx.noCache) cache.set(i, { sig, out });
      }
    });
    return out;
  }
}

// Mix of two uint8 images: amount 0 -> a, 1 -> b
export function blend(a, b, amount) {
  if (amount <= 0) return a;
  if (amount >= 1) return b;
  const out = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] + (b.data[i] - a.data[i]) * amount + 0.5;
  return { w: a.w, h: a.h, data: out };
}
