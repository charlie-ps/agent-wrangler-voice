import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './data-dir.js';
import { VOICE_MODEL, VOICE_MODEL_DIR } from '../public/voice-model.js';

// Voice's model (ported from Wrangler²), served by the board's own public/ route so the browser never
// fetches it from anyone else: fetched once, streamed to a temporary file and renamed into
// public/voice-model/ only once its SHA-256 matches the pin (public/voice-model.js), never past the
// pinned size. Only the human's Download fetches it (the `voice:model` handler's `download`).
//
// The kept copy lives in DATA_DIR/voice-model/, since an update of the checkout (or a fresh clone)
// can leave public/ without it. public/ holds only what the route serves: a check
// finding it missing or changed there puts the cached one back (hard link, else copy) once that hashes
// to the pin, and a model found only in public/ is adopted into the cache, so an install from before
// the cache never fetches again. Neither copy counts unless it hashes to the pin.
export const MODEL_DIR = fileURLToPath(new URL(`../public/${VOICE_MODEL_DIR}/`, import.meta.url));
export const CACHE_DIR = path.join(DATA_DIR, 'voice-model');

async function hashOf(file) {
  try {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  } catch { return null; }
}

const statOf = (file) => fs.promises.stat(file).catch(() => null);

// `from` linked (or copied) beside `to` and renamed over it only if what landed hashes to the pin, so
// a cache changed after it was hashed is never served. False, with nothing left behind, on any failure.
async function place(from, to, sha256) {
  const part = `${to}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  try {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    try { await fs.promises.link(from, part); } catch { await fs.promises.copyFile(from, part); }
    if (await hashOf(part) !== sha256) throw new Error('mismatch');
    await fs.promises.rename(part, to);
    return true;
  } catch {
    await fs.promises.rm(part, { force: true });
    return false;
  }
}

// Leaves public/ and the cache both holding the pinned model when either does; says whether public/ does.
async function settle({ dir, cacheDir, model }) {
  const file = path.join(dir, model.file), kept = path.join(cacheDir, model.file);
  const [a, b] = await Promise.all([statOf(file), statOf(kept)]);
  const served = !!a && await hashOf(file) === model.sha256;
  if (a && b && a.dev === b.dev && a.ino === b.ino) return served;
  if (served) {
    if (!b || await hashOf(kept) !== model.sha256) await place(file, kept, model.sha256);
    return true;
  }
  return !!b && await place(kept, file, model.sha256);
}

export async function hasVoiceModel({ dir = MODEL_DIR, cacheDir = CACHE_DIR, model = VOICE_MODEL } = {}) {
  return settle({ dir, cacheDir, model });
}

const pending = new Map();
// `onProgress(fraction)` hears the download, once a whole percent more of it has come.
export function ensureVoiceModel({ dir = MODEL_DIR, cacheDir = CACHE_DIR, model = VOICE_MODEL, fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const file = path.join(dir, model.file);
  if (pending.has(file)) return pending.get(file);
  const run = (async () => {
    if (await settle({ dir, cacheDir, model })) return file;
    await fs.promises.mkdir(dir, { recursive: true });
    const part = `${file}.${process.pid}.part`;
    try {
      const res = await fetchImpl(model.from);
      if (!res.ok || !res.body) throw new Error(`could not fetch the voice model (HTTP ${res.status})`);
      const hash = crypto.createHash('sha256'), out = fs.createWriteStream(part);
      let size = 0, told = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > model.bytes) throw new Error('the voice model is larger than the one pinned');
          const pct = Math.floor(size / model.bytes * 100);
          if (pct > told) { told = pct; onProgress(size / model.bytes); }
          hash.update(chunk);
          if (!out.write(chunk)) await once(out, 'drain');
        }
      } finally { out.end(); await once(out, 'close'); }
      const got = hash.digest('hex');
      if (got !== model.sha256) throw new Error(`the voice model failed its checksum (got ${got.slice(0, 12)}…)`);
      await fs.promises.rename(part, file);
      await place(file, path.join(cacheDir, model.file), model.sha256);
      return file;
    } catch (err) {
      await fs.promises.rm(part, { force: true });
      throw err;
    }
  })().finally(() => pending.delete(file));
  pending.set(file, run);
  return run;
}
