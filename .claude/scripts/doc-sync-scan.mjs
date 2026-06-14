#!/usr/bin/env node
/**
 * Doc-sync drift scanner — the deterministic core of the /doc-sync-check command.
 *
 * For every doc with a real baseline + watched paths, reports which watched
 * files changed between the baseline and the working tree. Report-only: never
 * edits a doc, never fails the command (always exits 0). The command then reads
 * this report and proposes reconciliations.
 *
 * Template-owned. Run from anywhere inside the project (resolves the root via
 * CLAUDE_PROJECT_DIR or git).
 */

import { execFileSync } from 'node:child_process'
import {
  getProjectDir,
  collectDocMeta,
  changedSince,
  matchPath
} from '../lib/doc-sync.mjs'

const projectDir = getProjectDir()

let head = null
let isRepo = true
try {
  head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()
} catch {
  isRepo = false
}

const metas = collectDocMeta(projectDir)

if (!metas.length) {
  console.log('No docs with a `## Doc Sync Metadata` block were found under docs/.')
  process.exit(0)
}

console.log(`Doc-sync drift report${head ? ` — HEAD ${head}` : ''}`)
console.log('')

// Cache changed-file lists per distinct baseline.
const cache = new Map()
function changedFor(baseline) {
  if (!cache.has(baseline)) cache.set(baseline, changedSince(projectDir, baseline))
  return cache.get(baseline)
}

let stale = 0
let clean = 0
let untracked = 0

for (const m of metas) {
  if (!m.realPaths.length) {
    console.log(`UNTRACKED  ${m.file}  (no watched paths set)`)
    untracked++
    continue
  }
  if (!m.baselineReal) {
    console.log(`UNTRACKED  ${m.file}  (no baseline set)`)
    untracked++
    continue
  }
  if (!isRepo) {
    console.log(`UNKNOWN    ${m.file}  (not a git repository — cannot diff)`)
    continue
  }

  const changed = changedFor(m.baseline)
  if (changed === null) {
    console.log(`UNKNOWN    ${m.file}  (baseline \`${m.baseline}\` not found in git history)`)
    continue
  }

  const hits = changed.filter((f) => m.realPaths.some((g) => matchPath(f, g)))
  if (hits.length) {
    console.log(`STALE      ${m.file}  (baseline ${m.baseline})`)
    console.log('   changed watched files:')
    for (const f of hits) console.log(`     - ${f}`)
    stale++
  } else {
    console.log(`CLEAN      ${m.file}  (baseline ${m.baseline})`)
    clean++
  }
}

console.log('')
console.log(
  `Summary: ${stale} stale, ${clean} clean, ${untracked} untracked` +
    (isRepo ? '.' : ' (git unavailable).')
)
