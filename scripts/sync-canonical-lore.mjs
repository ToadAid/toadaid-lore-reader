#!/usr/bin/env node
// Canonical-main source-following lore sync (Stage 2A-P2R2).
//
// ONE AUTHORED SOURCE → SYNC → DERIVED READER.
//
//   canonical main (ToadAid/toadaid.github.io/lore/data.json)
//     │  resolve once → EXACT_SHA (frozen for this generation)
//     │  import exact Git-object bytes <EXACT_SHA>:lore/data.json
//     │  validate → mechanically compute digest + provenance
//     ▼
//   derived Reader generation (transactionally published)
//
// The operator supplies ONLY the local canonical repository path. The sync
// command owns generation resolution: it resolves canonical `main` to one exact
// full SHA, freezes it, imports the exact Git-object bytes, validates, and
// records the commit + digest automatically. The operator must NEVER update a
// Reader-side generation SHA or digest merely because lore content changed.
//
// The exact-commit importer (scripts/import-canonical-lore.mjs) remains the
// deterministic engine underneath; this command = resolve main → that engine.

import { mkdtemp, mkdir, rm, rename, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CANONICAL_REPOSITORY, CANONICAL_BRANCH, CANONICAL_PATH } from '../src/lib/lore/provenance.ts';
import { resolveCanonicalMain, readCanonicalBytes } from '../src/lib/lore/canonical-git-source.ts';
import { buildGenerationArtifacts, writeGenerationArtifacts, GENERATION_FILES } from './import-canonical-lore.mjs';
import { loadGeneratedArchive } from '../src/lib/lore/archive-cover-state.ts';
import { loadMediaReaderState } from '../src/lib/lore/media-reader-state.ts';

function fail(message) { throw new Error(`Canonical lore sync refused: ${message}`); }

// The ONLY arguments the operator may supply to the sync command. Generation
// resolution is OWNED by the sync command: the operator never supplies the
// commit, digest, source bytes, source path, or repository identity.
const ALLOWED_ARGS = new Set(['canonical-repo', 'output', 'generated-at']);

// Forbidden for ordinary sync (Stage 2A-P2R2 §9). Supplying any of these means
// the operator is trying to hand-pin a generation — the exact thing P2R2
// removes. They are rejected explicitly.
const FORBIDDEN_ARGS = new Set(['commit', 'digest', 'source', 'source-path', 'repository']);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--')) fail('arguments must be --name value pairs');
    const name = key.slice(2);
    if (value === undefined || value.startsWith('--')) fail(`--${name} requires a value`);
    if (FORBIDDEN_ARGS.has(name)) {
      fail(`--${name} is not accepted by sync; canonical main is resolved automatically (no Reader-side commit/digest/source)`);
    }
    if (!ALLOWED_ARGS.has(name)) fail(`unknown argument --${name}`);
    args[name] = value;
  }
  if (!args['canonical-repo']) fail('missing --canonical-repo (local canonical git repository path)');
  return args;
}

/** Read the prior generation's provenance from `outputDirectory` for the
 *  preservation report. Best-effort: any error or missing file yields null.
 *  Never throws — this is reporting only. */
async function readPriorProvenance(outputDirectory) {
  try {
    const text = await readFile(resolve(outputDirectory, 'LORE_SOURCE.json'), 'utf8');
    const p = JSON.parse(text);
    if (p && typeof p.commit === 'string' && typeof p.sourceDigest === 'string') {
      return { commit: p.commit, sourceDigest: p.sourceDigest, recordCount: p.recordCount };
    }
    return null;
  } catch {
    return null;
  }
}

/** Publish a complete validated in-memory generation transactionally. Writes the
 *  complete candidate to a temporary directory on the SAME filesystem as the
 *  output, re-validates the candidate from disk, then atomically renames each
 *  file over the live output. On any failure before publish, the output
 *  directory is untouched and the candidate is removed (Stage 2A-P2R2 §16). */
async function publishGeneration(artifacts, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const candidate = await mkdtemp(resolve(outputDirectory, '.sync-candidate-'));
  try {
    await writeGenerationArtifacts(artifacts, candidate);

    // Re-validate the COMPLETE candidate from disk: the loader proves
    // identity + self-consistency, and the media reader proves the media
    // manifest belongs to the exact same generation (mixed-generation fails
    // closed). If the on-disk candidate is not a valid complete generation,
    // publish is refused and the live output is left intact.
    loadGeneratedArchive(candidate);
    loadMediaReaderState(candidate);

    // Publish: atomic per-file rename over the live files (same filesystem).
    for (const file of GENERATION_FILES) {
      await rename(resolve(candidate, file), resolve(outputDirectory, file));
    }
  } finally {
    // Remove the candidate directory and any leftover files (it is empty on a
    // clean publish; this also cleans up after a pre-publish failure).
    await rm(candidate, { recursive: true, force: true });
  }
}

/**
 * Run a canonical-main sync. Returns a structured result and never throws for
 * classified sync refusals (invalid source, duplicate IDs, fetch failure, wrong
 * remote, etc.) — those become `{ ok: false, reason, ... }` so the operator and
 * tests can assert them. A refused sync NEVER mutates the output directory;
 * `preserved` is always true on refusal.
 *
 * @param {{ canonicalRepo: string, output?: string, generatedAt?: string }} opts
 */
export async function syncCanonicalLore({ canonicalRepo, output = 'generated', generatedAt }) {
  const outputDirectory = resolve(output);
  const previousGeneration = await readPriorProvenance(outputDirectory);
  let resolvedCommit;
  try {
    // 1-2. verify usable git repo + corresponds to the canonical repository.
    // 3-5. narrow fetch of canonical main → resolve to one exact SHA → freeze.
    resolvedCommit = resolveCanonicalMain(canonicalRepo);

    // 6. import exact Git-object bytes from the frozen SHA (never the dirty
    //    working tree). 7. validate + mechanically compute digest + provenance.
    const { bytes, commit, path } = readCanonicalBytes(canonicalRepo, resolvedCommit);
    const artifacts = buildGenerationArtifacts(bytes, {
      repository: CANONICAL_REPOSITORY,
      path,
      commit,
    }, generatedAt);

    // Transactional publish: complete candidate → validate → atomic replace.
    // A failure here leaves the live output untouched.
    await publishGeneration(artifacts, outputDirectory);

    return {
      ok: true,
      resolvedCommit,
      provenance: artifacts.source,
      previousGeneration,
    };
  } catch (error) {
    return {
      ok: false,
      resolvedCommit,
      reason: error.message,
      previousGeneration,
      preserved: true,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await syncCanonicalLore({
    canonicalRepo: args['canonical-repo'],
    output: args.output,
    generatedAt: args['generated-at'],
  });

  if (result.ok) {
    console.log('CANONICAL_SYNC_OK');
    console.log(`repository: ${CANONICAL_REPOSITORY}`);
    console.log(`branch: ${CANONICAL_BRANCH}`);
    console.log(`path: ${CANONICAL_PATH}`);
    console.log(`resolved_commit: ${result.provenance.commit}`);
    console.log(`source_digest: ${result.provenance.sourceDigest}`);
    console.log(`record_count: ${result.provenance.recordCount}`);
    return;
  }

  console.log('CANONICAL_SYNC_REFUSED');
  if (result.resolvedCommit) console.log(`resolved_commit: ${result.resolvedCommit}`);
  console.log(`reason: ${result.reason}`);
  console.log(`previous_generation_preserved: YES`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}