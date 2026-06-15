#!/usr/bin/env node
/**
 * Doc-sync PostToolUse hook (Edit|Write).
 *
 * When an agent edits a file that a knowledge doc declares as a "watched" code,
 * test, or config path (the `## Doc Sync Metadata` blocks from docs/doc-sync.md),
 * this injects a non-blocking reminder naming those docs — so the agent reconciles
 * and re-baselines the doc at authoring time instead of letting it silently drift.
 *
 * Contract: reads the PostToolUse payload on stdin, emits
 *   { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }
 * on stdout with exit 0 (non-blocking). Emits nothing when no doc watches the
 * edited path. Never throws into the agent's flow — any error exits 0 silently.
 *
 * Template-owned: drives entirely off the project's own docs. While docs are
 * still `TBD` (placeholder paths), nothing matches and the hook stays silent.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectDocMeta, matchPath, getProjectDir } from '../lib/doc-sync.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
void __dirname // reserved; lib resolves the project root itself

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
    return // unparseable — stay silent
  }
  if (!filePath) return

  const projectDir = getProjectDir()
  let rel = filePath.startsWith(projectDir)
    ? filePath.slice(projectDir.length)
    : filePath
  rel = rel.replace(/^\/+/, '')
  if (!rel) return

  const metas = collectDocMeta(projectDir)
  const matched = metas.filter(
    (m) => m.file !== rel && m.realPaths.some((g) => matchPath(rel, g))
  )
  if (!matched.length) return

  const bullets = matched
    .map((m) => {
      const baseTag = m.baselineReal
        ? `baseline \`${m.baseline}\``
        : 'no baseline set — review and set one'
      return `  • \`${m.file}\` (${baseTag})`
    })
    .join('\n')

  const context =
    `Doc-sync: you edited \`${rel}\`, which is a watched path for:\n` +
    bullets +
    `\nIf this change alters behavior, contracts, tests, or runtime for that area, ` +
    `reconcile the doc and bump its \`Last code review baseline\` (see docs/doc-sync.md). ` +
    `A no-op is fine; an unreviewed drift is not.`

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
