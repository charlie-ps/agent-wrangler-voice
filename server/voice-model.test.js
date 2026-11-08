import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureVoiceModel, hasVoiceModel, MODEL_DIR, CACHE_DIR } from './voice-model.js';
import { DATA_DIR } from './data-dir.js';
import { makeVoiceModelHandler } from './voice-handlers.js';
import { VOICE_MODEL } from '../public/voice-model.js';

const good = Buffer.from('the pinned model');
const pin = { file: 'm.tar.gz', from: 'https://example.com/m.tar.gz', sha256: crypto.createHash('sha256').update(good).digest('hex'), bytes: good.length };
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-voice-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'public'), cacheDir = path.join(root, 'cache');
  const asked = [];
  const serve = (...chunks) => async (url) => { asked.push(url); return { ok: true, status: 200, body: (async function* () { yield* chunks.map((c) => Buffer.from(c)); })() }; };
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  return { dir, cacheDir, asked, serve, file: path.join(dir, pin.file), kept: path.join(cacheDir, pin.file), left: () => [...ls(dir), ...ls(cacheDir)] };
}

test('the model is fetched once from its pinned source and kept only when it hashes to the pin', async (t) => {
  const s = setup(t);
  const heard = [];
  assert.equal(await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve('the pinned ', 'model'), onProgress: (f) => heard.push(f) }), s.file);
  assert.deepEqual(heard, [11 / 16, 1], 'the download says how far it has got');
  assert.deepEqual(fs.readFileSync(s.file), good);
  assert.deepEqual(s.asked, [pin.from]);
  await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve('never asked') });
  assert.equal(s.asked.length, 1, 'already there and still matching: nothing fetched');
});

test('the model counts as present only while the file on disk hashes to the pin, and checking fetches nothing', async (t) => {
  const s = setup(t);
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), false, 'absent');
  fs.mkdirSync(s.dir);
  fs.writeFileSync(s.file, 'swapped');
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), false, 'changed on disk');
  fs.writeFileSync(s.file, good);
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), true);
  assert.deepEqual(s.asked, []);
});

test('a model that fails its checksum, outgrows the pin or is not served is never kept, and leaves nothing behind', async (t) => {
  const s = setup(t);
  await assert.rejects(ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve('the tampered model') }), /larger than the one pinned/);
  await assert.rejects(ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve('the pinned modeL') }), /failed its checksum/);
  await assert.rejects(ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
  assert.deepEqual(s.left(), [], 'no model and no part file');
});

test('a model changed on disk is fetched afresh', async (t) => {
  const s = setup(t);
  fs.mkdirSync(s.dir);
  fs.writeFileSync(s.file, 'swapped');
  await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve(good) });
  assert.deepEqual(fs.readFileSync(s.file), good);
  assert.equal(s.asked.length, 1);
});

test('asks at once share one download', async (t) => {
  const s = setup(t);
  const fetchImpl = s.serve(good);
  await Promise.all([ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl }), ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl })]);
  assert.equal(s.asked.length, 1);
});

test('an update that wiped public/ finds the cached model: present, put back and nothing fetched', async (t) => {
  const s = setup(t);
  await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve(good) });
  assert.deepEqual(fs.readFileSync(s.kept), good, 'the download is cached');
  fs.rmSync(s.dir, { recursive: true });
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), true);
  assert.deepEqual(fs.readFileSync(s.file), good, 'served again from public/');
  fs.rmSync(s.dir, { recursive: true });
  assert.equal(await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve('never asked') }), s.file);
  assert.deepEqual(fs.readFileSync(s.file), good);
  assert.deepEqual(s.asked, [pin.from], 'fetched once, by the first Download only');
});

test('a cache that does not hash to the pin is never put back, so Voice asks to download', async (t) => {
  const s = setup(t);
  fs.mkdirSync(s.cacheDir);
  fs.writeFileSync(s.kept, 'the tampered one');
  const sent = [];
  await makeVoiceModelHandler({ platform: 'linux', has: () => hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }) })
    .handler({}, { broadcast: (m) => sent.push(m), log() {} });
  assert.deepEqual(sent, [{ event: 'voice-model', op: 'check', present: false, platform: 'linux' }], 'the board is told to show its Download warning');
  assert.equal(fs.existsSync(s.file), false, 'nothing restored into public/');
  assert.deepEqual(s.left(), [pin.file], 'no part file left');
  await ensureVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin, fetchImpl: s.serve(good) });
  assert.equal(s.asked.length, 1, 'the Download fetches afresh');
  assert.deepEqual(fs.readFileSync(s.kept), good, 'and replaces the bad cache');
});

test('a model only in public/ is adopted into the cache on check, with no fetch', async (t) => {
  const s = setup(t);
  fs.mkdirSync(s.dir);
  fs.writeFileSync(s.file, good);
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), true);
  assert.deepEqual(fs.readFileSync(s.kept), good);
  assert.deepEqual(s.asked, []);
  fs.rmSync(s.dir, { recursive: true });
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), true, 'survives public/ losing it');
});

test('a public/ copy changed on disk is replaced from a good cache', async (t) => {
  const s = setup(t);
  fs.mkdirSync(s.dir);
  fs.mkdirSync(s.cacheDir);
  fs.writeFileSync(s.file, 'swapped');
  fs.writeFileSync(s.kept, good);
  assert.equal(await hasVoiceModel({ dir: s.dir, cacheDir: s.cacheDir, model: pin }), true);
  assert.deepEqual(fs.readFileSync(s.file), good);
});

test('the real model is served from the extension’s own public/, ignored by git, and kept under DATA_DIR', () => {
  assert.equal(MODEL_DIR, fileURLToPath(new URL('../public/voice-model/', import.meta.url)));
  assert.equal(CACHE_DIR, path.join(DATA_DIR, 'voice-model'), 'kept outside the checkout an update replaces');
  assert.match(VOICE_MODEL.from, /^https:\/\//);
  assert.match(VOICE_MODEL.sha256, /^[0-9a-f]{64}$/);
  assert.match(fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8'), /^public\/voice-model\/$/m);
});
