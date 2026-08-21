import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCanonicalSync, runReaderBuild } from './native-sync.mjs';

// Stage 2A-DESK1 §8/§15 / §31 tests #14/#15/#16/#17.
// The desktop REUSES the one governed sync command by spawning it; it supplies
// ONLY --canonical-repo and --output. It never supplies --commit, --digest, or
// source bytes, and it does not duplicate the parser/validator.

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function captureSpawnArgs(call) {
  return new Promise((resolveCap) => {
    let captured = null;
    call({
      onSpawn: (child) => {
        // child.spawnargs = [executable, ...args]
        captured = child.spawnargs || [child.spawnfile];
        try { child.kill('SIGKILL'); } catch { /* already exiting */ }
      },
    }).catch(() => {}).then(() => resolveCap(captured));
  });
}

test('#14/#15/#16 sync is spawned with only --canonical-repo and --output (no --commit/--digest/--source bytes)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'desk-native-'));
  try {
    const args = await captureSpawnArgs((opts) => runCanonicalSync({
      canonicalRepo: '/home/tommy/toadaid.github.io',
      repoRoot: tmp,
      output: join(tmp, 'generated'),
      ...opts,
    }));
    assert.ok(args, 'a child process was spawned');
    const joined = args.join(' ');
    assert.match(joined, /sync:canonical/, 'reuses the existing governed npm script');
    assert.match(joined, /--canonical-repo/);
    assert.match(joined, /--output/);
    // Never pins a generation or supplies source bytes.
    assert.doesNotMatch(joined, /--commit\b/);
    assert.doesNotMatch(joined, /--digest\b/);
    assert.doesNotMatch(joined, /--source\b/);
    assert.doesNotMatch(joined, /--source-path\b/);
    assert.doesNotMatch(joined, /--repository\b/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('#9 build is spawned using the existing `npm run build`', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'desk-native-build-'));
  try {
    const args = await captureSpawnArgs((opts) => runReaderBuild({ repoRoot: tmp, ...opts }));
    assert.ok(args);
    const joined = args.join(' ');
    assert.match(joined, /run/);
    assert.match(joined, /build/);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('#17 desktop does not import/reimplement the canonical sync parser/validator', async () => {
  const forbidden = ['import-canonical-lore', 'archive-cover-state', 'canonical-git-source', 'media-interpretation', 'legacy-media-candidates', 'provenance'];
  const files = (await readdir(__dirname)).filter((f) => f.endsWith('.mjs') || f.endsWith('.cjs'));
  const { readFile } = await import('node:fs/promises');
  for (const file of files) {
    if (file.endsWith('.test.mjs')) continue;
    const text = await readFile(join(__dirname, file), 'utf8');
    for (const name of forbidden) {
      // Only an actual import/require of the engine module is forbidden; prose
      // comments that mention the loader by name are allowed.
      const importOrRequire = new RegExp(
        `(import\\s[^;]*from\\s*['"][^'"]*${name}[^'"]*['"])|(require\\(\\s*['"][^'"]*${name}[^'"]*['"])`,
      );
      assert.doesNotMatch(text, importOrRequire, `desktop/${file} must not import the engine module ${name}`);
    }
  }
});