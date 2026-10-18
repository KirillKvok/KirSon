// A helper thread of the processing worker: takes chunks of blur passes (core/par.js).
import { work } from "./core/par.js";

self.onmessage = (e) => work(e.data);
self.postMessage("ready");
