/**
 * Invariant parsing for the authoring-time invariant hook.
 *
 * Reads docs/invariants.md and extracts invariants that opt into path tagging —
 * a rule followed by a nested `- Paths: ` bullet listing the globs it governs:
 *
 *   ## Persistence
 *
 *   - Writes must go through the repository layer; no direct SQL in handlers.
 *     - Paths: `src/db/**`, `src/repositories/**`
 *
 * The hook surfaces the matching rules when one of those paths is edited. Until a
 * rule has a `Paths:` tag it is invisible to the hook, so a fresh (all-`TBD`)
 * invariants file produces no output.
 *
 * Shares glob/path primitives with lib/doc-sync.mjs (the doc-sync lib) so path
 * matching behaves identically across both hooks.
 */

import fs from 'node:fs'
import path from 'node:path'
import { matchPath, isPlaceholder } from './doc-sync.mjs'

function stripBackticks(s) {
  return s.trim().replace(/^`+|`+$/g, '').trim()
}

/**
 * Parse path-tagged invariants from invariants.md content.
 * Returns [{ category, rule, paths }] for rules that declare ≥1 real path.
 * Fenced code blocks (format examples) are ignored.
 */
export function parseInvariants(content) {
  const lines = content.split(/\r?\n/)
  const fence = /^\s*(```|~~~)/
  const out = []
  let inFence = false
  let category = ''
  let current = null

  const flush = () => {
    if (current && current.paths.length && !isPlaceholder(current.rule)) {
      out.push(current)
    }
    current = null
  }

  for (const line of lines) {
    if (fence.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = line.match(/^##\s+(.*)$/)
    if (heading) {
      flush()
      category = heading[1].trim()
      continue
    }

    // Nested "- Paths: `a`, `b`" bullet attaches to the current rule.
    const paths = line.match(/^\s+-\s+Paths:\s*(.*)$/i)
    if (paths && current) {
      for (const part of paths[1].split(',')) {
        const g = stripBackticks(part)
        if (g && !isPlaceholder(g)) current.paths.push(g)
      }
      continue
    }

    // Top-level bullet starts a new rule.
    const rule = line.match(/^-\s+(.*)$/)
    if (rule) {
      flush()
      // Skip the Doc Sync Metadata bullets (that section's category name).
      if (/^doc sync metadata$/i.test(category)) continue
      current = { category, rule: rule[1].trim(), paths: [] }
      continue
    }

    // Indented non-Paths bullet or blank line: leave current rule open.
  }
  flush()
  return out
}

// Collect path-tagged invariants from <projectDir>/docs/invariants.md.
export function collectInvariants(projectDir) {
  const file = path.join(projectDir, 'docs', 'invariants.md')
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  return parseInvariants(content)
}

// Rules whose declared paths cover the given repo-relative path.
export function invariantsForPath(projectDir, rel) {
  return collectInvariants(projectDir).filter((inv) =>
    inv.paths.some((g) => matchPath(rel, g))
  )
}
