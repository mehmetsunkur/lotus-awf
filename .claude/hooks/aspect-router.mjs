#!/usr/bin/env node
/**
 * Aspect-router PostToolUse hook.
 *
 * When an agent edits a file in a blast-radius row of the guardrail trigger
 * table (docs/guardrails/aspect-taxonomy.md), this injects the relevant aspect
 * questions back into the agent's context as non-blocking guidance — so the
 * agent self-reviews its change against the aspects it just touched, at
 * authoring time, instead of relying on an expensive after-the-fact review.
 *
 * Contract: reads the PostToolUse payload on stdin, emits
 *   { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }
 * on stdout with exit 0 (non-blocking). Emits nothing when no row matches.
 * Never throws into the agent's flow — any error exits 0 silently.
 */

const LENS = {
  A1: 'A1 Contract/back-compat — will definitions/documents ALREADY replicated to clients still load & validate? Provide a migration or default for old data.',
  A2: 'A2 Validation parity — enforce the rule on BOTH the client and the API save path, via src/shared (do not inline it in only one).',
  A3: 'A3 Expression runtime — no eval escape; identical DETERMINISTIC result in browser and server; a malformed/hostile expression must fail closed.',
  A4: 'A4 Replication/conflict — bidirectional sync intact; _rev/_conflicts handled; no silent data loss on resolve; shape change must not break conflict comparison.',
  A5: 'A5 ACL/readers — readers/authors set correctly; no row/field/select-option leaks across users or roles; new query paths still honour readers filtering.',
  A6: 'A6 Offline — must work against the LOCAL CouchDB with no server round-trip; select options/definitions sourced from local data.',
  A7: 'A7 Index/query — a new view sort/filter field may need a Mango index; indexes are defined in THREE places (scripts/seed.ts, scripts/reset.ts, seedTarget in src/server/index.ts) — update all three.',
  A8: 'A8 Docs/acceptance — update docs/M*/0X-* so the spec stays true; check no acceptance criterion is now false.'
}

// Trigger table (mirrors docs/guardrails/aspect-taxonomy.md), keyed by
// repo-relative path. A9 (generic correctness) is always implied and not echoed.
const RULES = [
  { re: /^src\/shared\/validation\.ts$/, lenses: ['A2', 'A8'] },
  { re: /^src\/shared\/expression\.ts$/, lenses: ['A3', 'A8'] },
  { re: /^src\/shared\/types\.ts$/, lenses: ['A1', 'A8'] },
  { re: /^src\/server\/seed-data\.ts$/, lenses: ['A1', 'A5', 'A7', 'A8'] },
  { re: /^src\/server\/index\.ts$/, lenses: ['A2', 'A4', 'A5', 'A6', 'A7', 'A8'], note: 'src/server/index.ts spans several aspects — apply those relevant to the handler you changed.' },
  { re: /^src\/server\/couch\.ts$/, lenses: ['A4', 'A7', 'A8'] },
  { re: /^src\/server\/config\.ts$/, lenses: ['A6', 'A4'] },
  { re: /^scripts\/(seed|reset)\.ts$/, lenses: ['A7', 'A1'] },
  { re: /^scripts\/(replicate|force-conflict)\.ts$/, lenses: ['A4'] },
  { re: /^scripts\/acl-spike\.ts$/, lenses: ['A5'] },
  { re: /^src\/client\/main\.tsx$/, lenses: ['A2', 'A6'], note: 'If this edit was purely presentational, confirm and move on — but do not assume inert; verify A2/A6 are untouched.' }
]

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

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  let rel = filePath.startsWith(root) ? filePath.slice(root.length) : filePath
  rel = rel.replace(/^\/+/, '')

  const matched = RULES.find((r) => r.re.test(rel))
  if (!matched) return

  const lines = matched.lenses.map((id) => `  • ${LENS[id]}`)
  const note = matched.note ? `\n${matched.note}` : ''
  const context =
    `Aspect check for \`${rel}\` (guardrail blast-radius — docs/guardrails/lens-mandates.md):\n` +
    lines.join('\n') +
    note +
    `\nConfirm each touched aspect before finishing; a clean pass is fine, an unconsidered one is not.`

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context }
    })
  )
}

main().catch(() => process.exit(0))
