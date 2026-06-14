#!/usr/bin/env node
/**
 * Invariant PostToolUse hook (Edit|Write).
 *
 * When an agent edits a file governed by a path-tagged invariant in
 * docs/invariants.md, this injects the relevant rule(s) back into the agent's
 * context as non-blocking guidance — so the rule is considered at authoring time
 * rather than caught (or missed) in later review.
 *
 * Contract: reads the PostToolUse payload on stdin, emits
 *   { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }
 * on stdout with exit 0 (non-blocking). Emits nothing when no invariant governs
 * the edited path. Never throws into the agent's flow — any error exits 0 silently.
 *
 * Template-owned: drives off docs/invariants.md. Until invariants carry `Paths:`
 * tags, nothing matches and the hook stays silent.
 */

import { getProjectDir } from '../lib/doc-sync.mjs'
import { invariantsForPath } from '../lib/invariants.mjs'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(''))
  })
}

async function main() {
  const raw = await readStdin()
  let filePath = ''
  try {
    filePath = JSON.parse(raw)?.tool_input?.file_path || ''
  } catch {
    return
  }
  if (!filePath) return

  const projectDir = getProjectDir()
  let rel = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length)
    : filePath
  rel = rel.replace(/^\/+/, '')
  if (!rel) return

  const matched = invariantsForPath(projectDir, rel)
  if (!matched.length) return

  const bullets = matched
    .map((inv) => {
      const cat = inv.category ? `[${inv.category}] ` : ''
      return `  • ${cat}${inv.rule}`
    })
    .join('\n')

  const context =
    `Invariants governing \`${rel}\` (docs/invariants.md):\n` +
    bullets +
    `\nDo not violate these. If this change must break one, stop and surface it ` +
    `before continuing (see AGENTS.md / docs/invariants.md).`

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: context
      }
    })
  )
}

main().catch(() => process.exit(0))
