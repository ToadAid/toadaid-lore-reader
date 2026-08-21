import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { normalizePublicBase, publicPath } from '../src/lib/public-site.ts';
import { recordRoute } from '../src/lib/lore/reader-model.ts';
import { validatePublicBuild, validatePwa } from '../scripts/validate-public-build.mjs';
import { offlineGenerationKey, precachePaths } from '../scripts/build-reader.mjs';

const REPO = resolve('.');
const WORKFLOW = readFileSync(resolve(REPO, '.github/workflows/public-pages.yml'), 'utf8');
const GITIGNORE = readFileSync(resolve(REPO, '.gitignore'), 'utf8');
const CANONICAL_URL = 'https://github.com/ToadAid/toadaid.github.io';
const PAGES_BASE = '/toadaid-lore-reader/';
const PAGES_SITE = 'https://toadaid.github.io';
const tempDirectories: string[] = [];

type PublicationOutcome = 'success' | 'sync-failed' | 'build-failed' | 'artifact-failed' | 'deploy-failed';

function deploymentGenerationKey(readerSha: string, canonicalSha: string) {
  return `public-pages-v1-reader-${readerSha}-lore-${canonicalSha}`;
}

function runPublicationCeremony(
  successfulMarkers: Set<string>,
  readerSha: string,
  canonicalSha: string,
  outcome: PublicationOutcome,
) {
  if (outcome === 'sync-failed') {
    return { deployRequired: false, deployAttempted: false, markerSaved: false, key: null };
  }
  const key = deploymentGenerationKey(readerSha, canonicalSha);
  if (successfulMarkers.has(key)) {
    return { deployRequired: false, deployAttempted: false, markerSaved: false, key };
  }
  if (outcome === 'build-failed' || outcome === 'artifact-failed') {
    return { deployRequired: true, deployAttempted: false, markerSaved: false, key };
  }
  if (outcome === 'deploy-failed') {
    return { deployRequired: true, deployAttempted: true, markerSaved: false, key };
  }
  successfulMarkers.add(key);
  return { deployRequired: true, deployAttempted: true, markerSaved: true, key };
}

test.after(() => {
  for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
});

function tempDir(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

function run(cwd: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'PUB1 Test',
  GIT_AUTHOR_EMAIL: 'pub1@test.local',
  GIT_COMMITTER_NAME: 'PUB1 Test',
  GIT_COMMITTER_EMAIL: 'pub1@test.local',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function git(cwd: string, args: string[]) {
  return run(cwd, 'git', args, GIT_ENV);
}

function copyReaderFixture() {
  const project = join(tempDir('pub1-reader-'), 'reader');
  cpSync(REPO, project, {
    recursive: true,
    filter(source) {
      const path = relative(REPO, source);
      const first = path.split(/[\\/]/, 1)[0];
      return !['.git', '.codegraph', '.astro', 'dist', 'generated', 'node_modules'].includes(first);
    },
  });
  mkdirSync(join(project, 'generated'), { recursive: true });
  symlinkSync(resolve(REPO, 'node_modules'), join(project, 'node_modules'), 'dir');
  return project;
}

function canonicalFixture() {
  const root = tempDir('pub1-canonical-');
  const bare = join(root, 'remote.git');
  const clone = join(root, 'checkout');
  run(root, 'git', ['init', '--bare', '-q', bare], GIT_ENV);
  run(root, 'git', ['clone', '-q', bare, clone], GIT_ENV);
  git(clone, ['remote', 'set-url', 'origin', CANONICAL_URL]);
  git(clone, ['config', `url.${bare}.insteadOf`, CANONICAL_URL]);
  return { bare, clone };
}

function commitLore(fixture: ReturnType<typeof canonicalFixture>, records: Array<Record<string, unknown>>, message: string) {
  mkdirSync(join(fixture.clone, 'lore'), { recursive: true });
  writeFileSync(join(fixture.clone, 'lore/data.json'), JSON.stringify(records));
  git(fixture.clone, ['add', 'lore/data.json']);
  git(fixture.clone, ['commit', '-q', '-m', message]);
  git(fixture.clone, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return git(fixture.clone, ['rev-parse', 'HEAD']);
}

function sourceDigest(project: string) {
  const hash = createHash('sha256');
  for (const path of ['astro.config.mjs', 'package.json', 'public', 'scripts', 'src']) {
    const root = join(project, path);
    const files = path.endsWith('.mjs') || path.endsWith('.json')
      ? [root]
      : readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
    for (const file of files) {
      hash.update(relative(project, file));
      hash.update(readFileSync(file));
    }
  }
  return hash.digest('hex');
}

function sync(project: string, canonical: string) {
  return run(project, 'npm', ['run', 'sync:canonical', '--', '--canonical-repo', canonical]);
}

function build(project: string, mode: 'local' | 'pages') {
  const env = { ...process.env };
  delete env.PUBLIC_BASE;
  delete env.PUBLIC_SITE;
  if (mode === 'pages') {
    env.PUBLIC_BASE = PAGES_BASE;
    env.PUBLIC_SITE = PAGES_SITE;
  }
  run(project, 'npm', ['run', 'build'], env);
  return join(project, 'dist');
}

function pwaBuild(project: string, base: string) {
  const env = { ...process.env, PUBLIC_PWA: '1', PUBLIC_BASE: base, PUBLIC_SITE: PAGES_SITE, PUBLIC_READER_SHA: 'a'.repeat(40) };
  run(project, 'npm', ['run', 'build'], env);
  return join(project, 'dist');
}

test('public base abstraction preserves local root and prefixes the Pages project site once', () => {
  assert.equal(normalizePublicBase(undefined), '/');
  assert.equal(normalizePublicBase('/'), '/');
  assert.equal(normalizePublicBase('/toadaid-lore-reader'), PAGES_BASE);
  assert.equal(publicPath('/chronicle/', '/'), '/chronicle/');
  assert.equal(publicPath('/bookmarks/', PAGES_BASE), `${PAGES_BASE}bookmarks/`);
  assert.equal(recordRoute('TOBY A', '/'), '/record/TOBY%20A/');
  assert.equal(recordRoute('TOBY A', PAGES_BASE), `${PAGES_BASE}record/TOBY%20A/`);
});

test('offline cache identity requires both exact generation SHAs without time or randomness', () => {
  const reader = 'a'.repeat(40);
  const lore = 'b'.repeat(40);
  assert.equal(offlineGenerationKey(reader, lore), offlineGenerationKey(reader, lore));
  assert.notEqual(offlineGenerationKey('c'.repeat(40), lore), offlineGenerationKey(reader, lore));
  assert.notEqual(offlineGenerationKey(reader, 'c'.repeat(40)), offlineGenerationKey(reader, lore));
  assert.doesNotMatch(offlineGenerationKey(reader, lore), /date|time|random|uuid/i);
});

test('cover is timeless while verified record count remains derived archive state', () => {
  const cover = readFileSync(resolve(REPO, 'src/pages/index.astro'), 'utf8');
  const state = readFileSync(resolve(REPO, 'src/lib/lore/archive-cover-state.ts'), 'utf8');
  assert.match(cover, />Verified canonical archive</);
  assert.doesNotMatch(cover, /records preserved/);
  assert.match(cover, /canonicalCommit\.slice\(0, 9\)/);
  assert.match(state, /recordCount/);
});

test('public workflow has the three governed automatic triggers and no PR deployment trigger', () => {
  assert.match(WORKFLOW, /schedule:\s*\n\s*- cron: ['"]\*\/5 \* \* \* \*['"]/);
  assert.match(WORKFLOW, /workflow_dispatch:/);
  assert.match(WORKFLOW, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.doesNotMatch(WORKFLOW, /pull_request:/);
});

test('first exact Reader+Lore pair deploys, then the same successfully deployed pair skips', () => {
  const markers = new Set<string>();
  const reader = 'a'.repeat(40);
  const lore = 'b'.repeat(40);
  const first = runPublicationCeremony(markers, reader, lore, 'success');
  assert.deepEqual(first, {
    deployRequired: true,
    deployAttempted: true,
    markerSaved: true,
    key: deploymentGenerationKey(reader, lore),
  });
  const unchanged = runPublicationCeremony(markers, reader, lore, 'success');
  assert.equal(unchanged.deployRequired, false);
  assert.equal(unchanged.deployAttempted, false);
  assert.equal(unchanged.markerSaved, false);
});

test('same Reader with new canonical SHA requires deployment', () => {
  const reader = 'a'.repeat(40);
  const markers = new Set([deploymentGenerationKey(reader, 'b'.repeat(40))]);
  const changed = runPublicationCeremony(markers, reader, 'c'.repeat(40), 'success');
  assert.equal(changed.deployRequired, true);
  assert.equal(changed.deployAttempted, true);
});

test('new Reader SHA with same canonical SHA requires deployment', () => {
  const lore = 'b'.repeat(40);
  const markers = new Set([deploymentGenerationKey('a'.repeat(40), lore)]);
  const changed = runPublicationCeremony(markers, 'c'.repeat(40), lore, 'success');
  assert.equal(changed.deployRequired, true);
  assert.equal(changed.deployAttempted, true);
});

test('failed deployment saves no marker and the next run attempts deployment again', () => {
  const markers = new Set<string>();
  const reader = 'a'.repeat(40);
  const lore = 'b'.repeat(40);
  const failed = runPublicationCeremony(markers, reader, lore, 'deploy-failed');
  assert.equal(failed.deployAttempted, true);
  assert.equal(failed.markerSaved, false);
  assert.equal(markers.size, 0);
  const retry = runPublicationCeremony(markers, reader, lore, 'success');
  assert.equal(retry.deployRequired, true);
  assert.equal(retry.deployAttempted, true);
  assert.equal(retry.markerSaved, true);
});

test('invalid sync, build failure, and artifact failure cannot deploy or save a marker', () => {
  for (const outcome of ['sync-failed', 'build-failed', 'artifact-failed'] as const) {
    const markers = new Set<string>();
    const result = runPublicationCeremony(markers, 'a'.repeat(40), 'b'.repeat(40), outcome);
    assert.equal(result.deployAttempted, false, `${outcome}: no deploy`);
    assert.equal(result.markerSaved, false, `${outcome}: no marker`);
    assert.equal(markers.size, 0, `${outcome}: successful marker set remains empty`);
  }
});

test('workflow key uses exact Reader and generated canonical commits and marker is SHA-only non-authority', () => {
  const sync = WORKFLOW.indexOf('npm run sync:canonical');
  const generatedCommitRead = WORKFLOW.indexOf("readFileSync('generated/LORE_SOURCE.json'");
  const markerRestore = WORKFLOW.indexOf('actions/cache/restore@v5');
  assert.ok(sync >= 0 && generatedCommitRead > sync && markerRestore > generatedCommitRead);
  assert.match(WORKFLOW, /public-pages-v1-reader-\$\{GITHUB_SHA\}-lore-\$\{canonical_sha\}/);
  assert.match(WORKFLOW, /key: \$\{\{ steps\.deployment-generation\.outputs\.generation_key \}\}/);
  assert.match(WORKFLOW, /lookup-only: true/);
  assert.doesNotMatch(WORKFLOW, /restore-keys:/, 'only an exact pair may match');
  const markerWrite = WORKFLOW.match(/printf 'reader_sha=%s\\ncanonical_sha=%s\\n'[\s\S]*?> \.public-pages-deployment-marker/);
  assert.ok(markerWrite, 'success marker contains exactly the two generation SHAs');
  assert.doesNotMatch(markerWrite[0], /lore\/data\.json|reader-snapshot|sourceDigest|canonical bytes/i);
});

test('workflow skips all build/publication work on a marker hit and saves only after deploy success', () => {
  for (const name of [
    'Validate Reader',
    'Build Pages project site',
    'Validate Pages artifact',
    'Configure GitHub Pages',
    'Upload GitHub Pages artifact',
  ]) {
    const block = WORKFLOW.match(new RegExp(`- name: ${name}\\n([\\s\\S]*?)(?=\\n      - name:|\\n\\n  deploy:)`));
    assert.ok(block, `${name} step exists`);
    assert.match(block[0], /if: steps\.deployment-gate\.outputs\.deploy_required == 'true'/, `${name} is gated`);
  }
  assert.match(WORKFLOW, /deploy:\s*\n[\s\S]*?needs: build\s*\n\s*if: needs\.build\.outputs\.deploy_required == 'true'/);
  const deploy = WORKFLOW.indexOf('actions/deploy-pages@v5');
  const markerCreate = WORKFLOW.indexOf('Create successful deployment marker');
  const markerSave = WORKFLOW.indexOf('actions/cache/save@v5');
  assert.ok(deploy >= 0 && markerCreate > deploy && markerSave > markerCreate, 'marker save is reachable only after successful deploy');
  assert.doesNotMatch(WORKFLOW.slice(0, deploy), /actions\/cache\/save@v5/, 'no pre-deploy marker save');
});

test('public workflow reuses only the P2R2 canonical-repo operator surface', () => {
  const syncLine = WORKFLOW.split('\n').find((line) => line.includes('npm run sync:canonical'));
  assert.ok(syncLine, 'sync:canonical invocation exists');
  assert.match(syncLine, /--canonical-repo "\$GITHUB_WORKSPACE\/canonical-lore"/);
  for (const forbidden of ['--commit', '--digest', '--source ', '--source-path', '--repository']) {
    assert.ok(!syncLine.includes(forbidden), `workflow must not pass ${forbidden}`);
  }
  assert.match(WORKFLOW, /repository: ToadAid\/toadaid\.github\.io/);
  assert.match(WORKFLOW, /persist-credentials: false/);
});

test('sync, test, build, artifact validation, upload, and deploy are mechanically fail-closed', () => {
  const ordered = [
    'npm run sync:canonical',
    'npm test',
    'npm run build',
    'validate-public-build.mjs',
    'actions/upload-pages-artifact@v5',
    'actions/deploy-pages@v5',
  ].map((value) => WORKFLOW.indexOf(value));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered, 'publication steps are strictly ordered');
  assert.match(WORKFLOW, /deploy:\s*\n[\s\S]*?needs: build/);
  assert.doesNotMatch(WORKFLOW, /continue-on-error:|if:\s*always\(\)/);
});

test('workflow uses least privilege, current first-party Pages actions, and safe deployment concurrency', () => {
  assert.match(WORKFLOW, /permissions:\s*\n\s*contents: read\s*\n\s*pages: write\s*\n\s*id-token: write/);
  assert.match(WORKFLOW, /actions\/configure-pages@v6/);
  assert.match(WORKFLOW, /actions\/upload-pages-artifact@v5/);
  assert.match(WORKFLOW, /actions\/deploy-pages@v5/);
  assert.match(WORKFLOW, /group: pages\s*\n\s*cancel-in-progress: false/);
  assert.match(WORKFLOW, /name: github-pages/);
  assert.match(WORKFLOW, /steps\.deployment\.outputs\.page_url/);
});

test('workflow cannot mutate either source repository or commit generated material', () => {
  assert.doesNotMatch(WORKFLOW, /\bgit\s+(?:commit|push)\b|\bgh\s+api\b|contents:\s*write/);
  assert.doesNotMatch(WORKFLOW, /uses:\s*(?!actions\/)[^\s]+pages/i);
  assert.match(GITIGNORE, /^generated\/\*$/m);
  assert.match(GITIGNORE, /^!generated\/\.gitkeep$/m);
  assert.equal(existsSync(resolve(REPO, 'lore/data.json')), false, 'Reader has no authored canonical source copy');
});

test('Reader pages never fetch canonical lore at browser runtime', () => {
  const pageFiles = [
    'src/pages/index.astro',
    'src/pages/chronicle/index.astro',
    'src/pages/bookmarks/index.astro',
    'src/pages/record/[canonicalId].astro',
  ];
  const source = pageFiles.map((file) => readFileSync(resolve(REPO, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /fetch\s*\([^)]*toadaid\.github\.io\/lore\/data\.json/i);
  assert.doesNotMatch(source, /https:\/\/toadaid\.github\.io\/lore\/data\.json/);
});

test('valid canonical A then B drives local and Pages builds through the same command with no Reader source mutation', { timeout: 30_000 }, () => {
  const project = copyReaderFixture();
  const canonical = canonicalFixture();
  const before = sourceDigest(project);

  const commitA = commitLore(canonical, [
    { id: 'PUB_A', date: '2026-01-01', title: 'Public A', comment: 'A', img: 'https://cdn.example.test/a.jpg' },
  ], 'public generation A');
  assert.match(sync(project, canonical.clone), /CANONICAL_SYNC_OK/);
  assert.equal(JSON.parse(readFileSync(join(project, 'generated/LORE_SOURCE.json'), 'utf8')).commit, commitA);

  const localDist = build(project, 'local');
  assert.equal(validatePublicBuild(localDist, '/').base, '/');
  assert.equal(existsSync(join(localDist, 'manifest.webmanifest')), false, 'ordinary local build has no PWA artifact');
  assert.doesNotMatch(readFileSync(join(localDist, 'index.html'), 'utf8'), /serviceWorker\.register/);
  const localRecord = readFileSync(join(localDist, 'record/PUB_A/index.html'), 'utf8');
  assert.match(localRecord, /data-share-url="\/record\/PUB_A\/"/);
  assert.match(localRecord, /href="\/chronicle\/"/);

  const pagesADist = build(project, 'pages');
  const pagesAResult = validatePublicBuild(pagesADist, PAGES_BASE);
  assert.ok(pagesAResult.internalReferences > 0);
  const coverA = readFileSync(join(pagesADist, 'index.html'), 'utf8');
  const chronicleA = readFileSync(join(pagesADist, 'chronicle/index.html'), 'utf8');
  assert.match(coverA, /href="\/toadaid-lore-reader\/chronicle\/"/);
  assert.match(coverA, /\/toadaid-lore-reader\/art\/pond-archive\/cover-desktop\.png/);
  assert.match(chronicleA, /href="\/toadaid-lore-reader\/bookmarks\/"/);
  assert.match(chronicleA, /\/toadaid-lore-reader\/art\/pond-archive\/pond-archive-lotus-moon\.png/);

  const commitB = commitLore(canonical, [
    { id: 'PUB_B1', date: '2026-02-01', title: 'Public B1', comment: 'B1', img: 'https://cdn.example.test/b.jpg' },
    { id: 'PUB_B2', date: '2026-02-02', title: 'Public B2', comment: 'B2', img: 'https://youtu.be/dQw4w9WgXcQ' },
  ], 'public generation B');
  assert.notEqual(commitA, commitB);
  assert.match(sync(project, canonical.clone), /CANONICAL_SYNC_OK/);
  assert.equal(JSON.parse(readFileSync(join(project, 'generated/LORE_SOURCE.json'), 'utf8')).commit, commitB);
  assert.equal(sourceDigest(project), before, 'Reader source is unchanged while canonical main advances');

  const pagesBDist = build(project, 'pages');
  validatePublicBuild(pagesBDist, PAGES_BASE);
  const bookmarks = readFileSync(join(pagesBDist, 'bookmarks/index.html'), 'utf8');
  const first = readFileSync(join(pagesBDist, 'record/PUB_B1/index.html'), 'utf8');
  const second = readFileSync(join(pagesBDist, 'record/PUB_B2/index.html'), 'utf8');
  assert.match(bookmarks, /\/toadaid-lore-reader\/record\/PUB_B1\//);
  assert.match(first, /data-share-url="\/toadaid-lore-reader\/record\/PUB_B1\/"/);
  assert.match(first, /href="\/toadaid-lore-reader\/record\/PUB_B2\/"/);
  assert.match(first, /https:\/\/cdn\.example\.test\/b\.jpg/);
  assert.match(second, /data-yt-embed="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  assert.match(second, /href="https:\/\/youtu\.be\/dQw4w9WgXcQ"/);
});

test('admitted PWA builds are base-bounded and precache the complete static Reader only', { timeout: 30_000 }, () => {
  const project = copyReaderFixture();
  const canonical = canonicalFixture();
  const commit = commitLore(canonical, [
    { id: 'PWA_A', date: '2026-01-01', title: 'PWA A', comment: 'A', img: 'https://cdn.example.test/a.jpg' },
    { id: 'PWA_B', date: '2026-01-02', title: 'PWA B', comment: 'B', img: 'https://youtu.be/dQw4w9WgXcQ' },
  ], 'pwa generation');
  assert.match(sync(project, canonical.clone), /CANONICAL_SYNC_OK/);
  for (const base of ['/', PAGES_BASE]) {
    const dist = pwaBuild(project, base);
    validatePublicBuild(dist, base);
    validatePwa(dist, base);
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.start_url, base);
    assert.equal(manifest.scope, base);
    assert.ok(manifest.icons.every((icon: { src: string }) => icon.src.startsWith(base)));
    const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
    assert.match(sw, new RegExp(`lore-${commit}`));
    assert.match(sw, /request\.method !== 'GET'/);
    assert.match(sw, /url\.origin !== self\.location\.origin/);
    assert.match(sw, /name\.startsWith\(OWNED_PREFIX\)/);
    assert.doesNotMatch(sw, /toadaid\.github\.io\/lore\/data\.json|raw\.githubusercontent\.com/i);
    assert.doesNotMatch(sw, /cdn\.example\.test|youtube-nocookie|youtu\.be/);
    for (const route of [base, `${base}chronicle/`, `${base}bookmarks/`, `${base}record/PWA_A/`, `${base}record/PWA_B/`]) assert.match(sw, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(precachePaths(dist, base).filter((path) => /^https?:/.test(path)), []);
  }
});

test('built-output validator rejects an internal root link that escapes the Pages base', () => {
  const directory = tempDir('pub1-bad-build-');
  mkdirSync(join(directory, 'chronicle'), { recursive: true });
  mkdirSync(join(directory, 'bookmarks'), { recursive: true });
  mkdirSync(join(directory, 'record/X'), { recursive: true });
  mkdirSync(join(directory, 'art/pond-archive'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), '<a href="/chronicle/">bad</a>');
  writeFileSync(join(directory, 'chronicle/index.html'), 'ok');
  writeFileSync(join(directory, 'bookmarks/index.html'), 'ok');
  writeFileSync(join(directory, 'record/X/index.html'), 'ok');
  for (const asset of ['cover-desktop.png', 'cover-mobile.png', 'pond-archive-lotus-moon.png']) {
    writeFileSync(join(directory, 'art/pond-archive', asset), 'fixture');
  }
  assert.throws(() => validatePublicBuild(directory, PAGES_BASE), /root URL escapes Pages base: \/chronicle\//);
});
