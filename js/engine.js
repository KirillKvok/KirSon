import { HELPERS } from "./device.js";
// Main-thread side of the processing worker: "the newest request wins" for previews
// (while one render runs, further requests only replace the pending one).

export class Engine {
  constructor() {
    // the helper thread count travels in the address (the worker has no localStorage of its own)
    this.worker = new Worker(new URL(`./worker.js?helpers=${HELPERS}`, import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => console.error(`processing worker: ${e.message || "failed"} @ ${e.filename || ""}:${e.lineno || ""}`); // in the problem report
    this.nextId = 1;
    this.waiting = new Map(); // id -> {resolve, reject}
    this.busy = false;
    this.pending = null;
    this.onPreview = null; // (imageData, ms) => void
  }

  _onMessage(m) {
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    if (m.type === "error") w.reject(new Error(m.message));
    else w.resolve(m);
  }

  _call(msg, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id }, transfer);
    });
  }

  setImage(key, imageData, scale, imageId) {
    const buf = imageData.data.slice().buffer;
    this.worker.postMessage({ type: "image", key, w: imageData.width, h: imageData.height, data: buf, scale, imageId },
      [buf]);
  }

  setPicture(pid, imageData) {
    const buf = imageData.data.slice().buffer;
    this.worker.postMessage({ type: "picture", pid, w: imageData.width, h: imageData.height, data: buf }, [buf]);
  }

  setObjectMask(x, y, plane) {
    const buf = plane.data.slice().buffer;
    this.worker.postMessage({ type: "objectMask", x, y, w: plane.w, h: plane.h, data: buf }, [buf]);
  }

  setObjectFill(x, y, fill) {
    this.worker.postMessage({ type: "objectFill", x, y, fill });
  }

  setAnalysis(analysis) {
    this.worker.postMessage({ type: "analysis", analysis });
  }

  forgetAnalysis(imageId) {
    this.worker.postMessage({ type: "forgetAnalysis", imageId });
  }

  drop(key) {
    this.worker.postMessage({ type: "drop", key });
  }

  async render(key, state, before = false) {
    const m = await this._call({ type: "render", key, state, before });
    return {
      image: new ImageData(new Uint8ClampedArray(m.data), m.w, m.h), ms: m.ms, timings: m.timings, threads: m.threads,
      before: m.before ? new ImageData(new Uint8ClampedArray(m.before), m.bw, m.bh) : null,
    };
  }

  async auto(key) {
    return (await this._call({ type: "auto", key })).values;
  }

  async mask(key, name) {
    const m = await this._call({ type: "mask", key, name });
    return new ImageData(new Uint8ClampedArray(m.data), m.w, m.h);
  }

  // Preview: only the newest request matters.
  preview(key, state, before = true) {
    const job = { key, state, before };
    if (this.busy) {
      this.pending = job;
      return;
    }
    this._run(job);
  }

  async _run(job) {
    this.busy = true;
    try {
      const { image, ms, before } = await this.render(job.key, job.state, job.before);
      // shown even when a newer request waits: it is newer than what is on screen (while a slider moves,
      // skipping it left the photo frozen until the finger lifted)
      if (this.onPreview) this.onPreview(image, ms, before, job.key);
    } catch (err) {
      console.error(err);
    }
    this.busy = false;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this._run(next);
    }
  }
}
