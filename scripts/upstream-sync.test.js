import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The Voice fork's daily upstream sync (upstream-sync.sh, .github/workflows/upstream-sync.yml), run
// against throwaway repositories: a bare "upstream", a bare "origin" (the fork) and the fork's checkout.
const SCRIPT = fileURLToPath(new URL('./upstream-sync.sh', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/upstream-sync.yml', import.meta.url));
const ID = ['-c', 'user.email=t@example.com', '-c', 'user.name=t'];

function repos(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (cwd, file, text) => fs.writeFileSync(path.join(cwd, file), text);
  const commit = (cwd, msg) => { git(cwd, 'add', '-A'); git(cwd, ...ID, 'commit', '-q', '-m', msg); return git(cwd, 'rev-parse', 'HEAD'); };
  // Upstream's history, and the fork cloned from it with one commit of its own.
  const up = path.join(root, 'up-work');
  fs.mkdirSync(up);
  git(up, 'init', '-q', '-b', 'main');
  write(up, 'app.js', 'one\ntwo\nthree\n');
  commit(up, 'upstream start');
  const upstream = path.join(root, 'upstream.git');
  git(root, 'clone', '-q', '--bare', up, upstream);
  const origin = path.join(root, 'origin.git');
  git(root, 'clone', '-q', '--bare', upstream, origin);
  const fork = path.join(root, 'fork');
  git(root, 'clone', '-q', origin, fork);
  write(fork, 'voice.js', 'voice\n');
  commit(fork, 'Voice');
  git(fork, 'push', '-q', 'origin', 'main');
  // A gh stub on PATH records what it is asked, so a test sees the pull request it would open.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const ghLog = path.join(root, 'gh.log');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${ghLog}'\n`, { mode: 0o755 });
  const upstreamCommit = (file, text, msg) => { write(up, file, text); const sha = commit(up, msg); git(up, 'push', '-q', upstream, 'main'); return sha; };
  const sync = (env = {}) => execFileSync('bash', [SCRIPT], {
    cwd: fork, encoding: 'utf8', env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}`, UPSTREAM_URL: upstream, REPO: 'acme/widgets-fork', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
  const heads = () => ({ origin: git(origin, 'rev-parse', 'main'), upstream: git(upstream, 'rev-parse', 'main'), branches: git(origin, 'branch', '--format=%(refname:short)').split('\n') });
  return { git, fork, origin, upstream, upstreamCommit, sync, heads, gh: () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '') };
}

test('a clean upstream change lands on the fork’s main as a merge commit, pushed only to origin', (t) => {
  const r = repos(t);
  const forkMain = r.heads().origin;
  const theirs = r.upstreamCommit('app.js', 'one\ntwo\nthree\nfour\n', 'upstream: four');
  const out = r.sync();
  assert.match(out, /Clean merge/);
  const after = r.heads();
  assert.equal(after.upstream, theirs, 'upstream untouched');
  assert.deepEqual(r.git(r.origin, 'rev-list', '--parents', '-n', '1', 'main').split(' ').slice(1), [forkMain, theirs], 'a merge commit: the fork’s main, then upstream’s');
  assert.match(r.git(r.origin, 'log', '-1', '--format=%s', 'main'), /^Merge upstream\/main \([0-9a-f]+\) into main$/);
  assert.equal(r.git(r.fork, 'remote', 'get-url', '--push', 'upstream'), 'DISABLED');
  assert.equal(r.gh(), '', 'no pull request for a clean merge');
  assert.match(r.sync(), /Already up to date/, 'the next day finds nothing to do');
});

test('a conflicting upstream change leaves main alone and opens a pull request on the fork from a sync branch', (t) => {
  const r = repos(t);
  r.git(r.fork, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(r.fork, 'app.js'), 'one\nTWO (fork)\nthree\n');
  r.git(r.fork, 'add', '-A'); r.git(r.fork, ...ID, 'commit', '-q', '-m', 'fork edit'); r.git(r.fork, 'push', '-q', 'origin', 'main');
  const forkMain = r.heads().origin;
  const theirs = r.upstreamCommit('app.js', 'one\nTWO (upstream)\nthree\n', 'upstream edit');
  const out = r.sync();
  assert.match(out, /Conflicts/);
  assert.match(out, /conflict: app\.js/);
  const after = r.heads();
  assert.equal(after.origin, forkMain, 'main untouched');
  assert.equal(after.upstream, theirs, 'upstream untouched');
  const branch = after.branches.find((b) => b.startsWith('sync/upstream-'));
  assert.ok(branch, 'upstream’s main pushed to a branch on origin');
  assert.equal(r.git(r.origin, 'rev-parse', branch), theirs);
  assert.match(r.gh(), new RegExp(`pr create --repo acme/widgets-fork --base main --head ${branch.replace('/', '\\/')}`));
});

test('a dry run says what it would do and changes nothing', (t) => {
  const r = repos(t);
  const before = r.heads();
  r.upstreamCommit('app.js', 'one\ntwo\nthree\nfour\n', 'upstream: four');
  const out = r.sync({ DRY_RUN: '1' });
  assert.match(out, /\+ git merge --no-ff --no-edit -m Merge upstream\/main/);
  assert.match(out, /\+ git push origin HEAD:refs\/heads\/main/);
  assert.equal(r.heads().origin, before.origin);
});

test('the script pushes nowhere but origin, and the workflow runs it daily on the fork alone', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const pushes = src.split('\n').filter((l) => /\bgit push\b/.test(l) && !l.trim().startsWith('#'));
  assert.ok(pushes.length >= 2);
  for (const l of pushes) assert.match(l, /git push origin /, l.trim());
  assert.match(src, /git remote set-url --push upstream DISABLED/);
  assert.ok(src.indexOf('set-url --push upstream DISABLED') < src.indexOf('git fetch'), 'upstream’s push is disabled before anything is fetched');
  assert.match(src, /git merge --no-ff/);
  const wf = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(wf, /schedule:\n\s+- cron: '\d+ \d+ \* \* \*'/);
  assert.match(wf, /if: github\.repository == 'charlie-ps\/agent-wrangler-voice'/);
  assert.match(wf, /bash scripts\/upstream-sync\.sh/);
  assert.doesNotMatch(wf, /git push/);
});
