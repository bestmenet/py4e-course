/* Python runs in a terminable worker, so a loop cannot freeze the page. */
let worker = null;
let ready = null;
let pending = null;
let sequence = 0;

function discard() {
  worker?.terminate();
  worker = null;
  ready = null;
}

async function initialize() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    try {
      worker = new Worker(new URL('./python-worker.js', import.meta.url), { type: 'module' });
    } catch (err) { reject(err); return; }
    const loadTimer = setTimeout(() => {
      discard();
      reject(new Error('Python could not load in 90 seconds. Check your connection and retry.'));
    }, 90000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready' || data.type === 'init-error') {
        clearTimeout(loadTimer);
        if (data.type === 'ready') resolve();
        else { discard(); reject(new Error(data.error)); }
      } else if (data.type === 'started' && pending?.id === data.id) {
        pending.started();
      } else if (data.type === 'result' && pending?.id === data.id) {
        pending.finish(data.result);
      }
    };
    worker.onerror = (event) => {
      clearTimeout(loadTimer);
      const err = new Error(event.message || 'The browser Python worker stopped.');
      discard();
      reject(err);
      pending?.fail(err);
    };
  });
  try { await ready; } catch (err) { ready = null; throw err; }
}

let busy = false;
export async function runPython(payload = {}) {
  if (busy) throw new Error('A Python program is already running. Wait for it to finish.');
  if (typeof payload.code !== 'string' || payload.code.length > 100000) {
    throw new Error('Enter a Python program of at most 100,000 characters.');
  }
  busy = true;
  try {
    await initialize();
    return await new Promise((resolve, reject) => {
      const id = ++sequence;
      const seconds = Math.max(0.5, Math.min(Number(payload.timeout) || 10, 30));
      let timer = setTimeout(() => {
        discard(); pending = null;
        reject(new Error('Could not prepare the sample data. Check your connection and retry.'));
      }, 60000);
      pending = {
        id,
        started() {
          clearTimeout(timer);
          timer = setTimeout(() => {
            discard(); pending = null;
            resolve({ ok: false, stdout: '', stderr: `Stopped after ${seconds}s — possible infinite loop.`,
              duration_ms: seconds * 1000, timed_out: true, truncated: false, exit_code: null });
          }, seconds * 1000);
        },
        finish(result) { clearTimeout(timer); pending = null; resolve(result); },
        fail(err) { clearTimeout(timer); pending = null; reject(err); },
      };
      worker.postMessage({ id, payload });
    });
  } finally { busy = false; }
}
