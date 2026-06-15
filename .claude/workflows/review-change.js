export const meta = {
  name: 'review-change',
  description: 'Multi-lens review of a plan or diff against the guardrail aspect taxonomy',
  whenToUse: 'Review a change (git range) or a plan across the codebase aspects, with adversarial verification and gating',
  phases: [
    { title: 'Route', detail: 'map changed files to activated lenses' },
    { title: 'Review', detail: 'one isolated reviewer per activated lens' },
    { title: 'Verify', detail: 'adversarially refute each gating finding' },
    { title: 'Synthesize', detail: 'dedupe, drop refuted, gate, completeness critic' }
  ]
}

// ---------------------------------------------------------------------------
// Config: the lens set (mirrors the aspect categories in docs/invariants.md). The
// full mandates live in docs/review-lenses.md; reviewers read them there.
// ---------------------------------------------------------------------------
const LENS_TITLES = {
  A1: 'Definitions-as-data contract & back-compat',
  A2: 'Shared validation parity (client + API)',
  A3: 'Expression runtime',
  A4: 'Replication & conflict',
  A5: 'ACL / readers',
  A6: 'Offline editing',
  A7: 'Index & query',
  A8: 'Docs & acceptance sync',
  A9: 'Correctness (generic)'
}
const ALL_LENSES = Object.keys(LENS_TITLES)
const GATING = new Set(['blocker', 'major'])

const FINDING = {
  type: 'object',
  required: ['severity', 'file', 'claim', 'rationale', 'confidence'],
  properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] },
    file: { type: 'string' },
    line: { type: ['integer', 'string'] },
    claim: { type: 'string' },
    rationale: { type: 'string' },
    blastRadiusRefs: { type: 'array', items: { type: 'string' } },
    suggestedFix: { type: 'string' },
    confidence: { type: 'number' }
  }
}
const ROUTE_SCHEMA = {
  type: 'object',
  required: ['mode', 'changedFiles', 'activatedLenses', 'rationale'],
  properties: {
    mode: { type: 'string', enum: ['plan', 'diff'] },
    changedFiles: { type: 'array', items: { type: 'string' } },
    activatedLenses: { type: 'array', items: { type: 'string', enum: ALL_LENSES } },
    rationale: { type: 'string' }
  }
}
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['lens', 'allClear', 'findings'],
  properties: {
    lens: { type: 'string' },
    allClear: { type: 'boolean' },
    findings: { type: 'array', items: FINDING }
  }
}
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } }
}
const REPORT_SCHEMA = {
  type: 'object',
  required: ['summary', 'blockers', 'majors', 'minors', 'gaps'],
  properties: {
    summary: { type: 'string' },
    blockers: { type: 'array', items: { type: 'object' } },
    majors: { type: 'array', items: { type: 'object' } },
    minors: { type: 'array', items: { type: 'object' } },
    gaps: { type: 'array', items: { type: 'string' } }
  }
}

// args: { mode: 'diff'|'plan', range?: string, planText?: string }
const mode = (args && args.mode) || 'diff'
const range = (args && args.range) || 'HEAD~1..HEAD'
const planText = (args && args.planText) || ''
const subject = mode === 'diff' ? `git diff ${range}` : 'the proposed plan'

// ---------------------------------------------------------------------------
// Phase 1 — Route: map the change to the lenses it must be reviewed against.
// ---------------------------------------------------------------------------
phase('Route')
const route = await agent(
  `You are the routing step of a multi-lens code review. Working directory is the repo root.

Read docs/invariants.md — the path-tagged rules (their nested Paths globs map changed paths to aspects A1..A9) — and docs/taxonomy.md (risk classes). Treat each invariant category as a lens.

MODE = ${mode}.
${mode === 'diff'
    ? `The change is the git range ${range}. Run \`git diff --stat ${range}\` and \`git diff ${range}\` to see exactly what changed.`
    : `The proposed plan is:\n<plan>\n${planText}\n</plan>`}

Decide which lenses (A1..A9) are activated for this change using the trigger table. A9 (correctness) is always activated; A8 (docs sync) is activated whenever any of A1..A7 are. Be precise — do not activate a domain lens whose files/symbols were not touched.

Return: mode, changedFiles (the actual files in the change), activatedLenses (subset of A1..A9), and a one-paragraph rationale citing the trigger-table rows you applied.`,
  { schema: ROUTE_SCHEMA, label: 'route', phase: 'Route' }
)

const activated = (route.activatedLenses || []).filter((l) => ALL_LENSES.includes(l))
if (!activated.includes('A9')) activated.push('A9')
log(`mode=${mode} target=${subject}`)
log(`changed: ${(route.changedFiles || []).length} files | lenses: ${activated.join(', ')}`)

// ---------------------------------------------------------------------------
// Phases 2+3 — Review (one isolated agent per lens) then Verify (refute each
// gating finding), pipelined so each lens verifies as soon as it finishes.
// ---------------------------------------------------------------------------
phase('Review')
const reviewed = await pipeline(
  activated,
  // Stage 1: review through a single lens.
  (lensId) =>
    agent(
      `You are a single-lens reviewer in a multi-lens review. Working directory is the repo root.

Read docs/review-lenses.md. Follow the "Shared preamble" exactly, then apply ONLY the mandate for lens ${lensId} — ${LENS_TITLES[lensId]}. Its underlying rule is the same-named category in docs/invariants.md. Ignore every concern owned by other lenses.

MODE = ${mode}.
${mode === 'diff'
        ? `The change is git range ${range}. Inspect it with \`git diff ${range} -- <files>\` and read the cited source/docs before asserting anything.`
        : `The proposed plan is:\n<plan>\n${planText}\n</plan>`}

Return findings strictly per the schema. If your lens is clean, set allClear=true and return an empty findings array — do NOT invent issues. Cite concrete file:line. Set lens="${lensId}".`,
      { schema: FINDINGS_SCHEMA, label: `review:${lensId}`, phase: 'Review' }
    ),
  // Stage 2: adversarially verify each gating-severity finding.
  async (review, lensId) => {
    if (!review) return null
    const toVerify = (review.findings || []).filter((f) => GATING.has(f.severity))
    const passthrough = (review.findings || []).filter((f) => !GATING.has(f.severity))
    const verified = await parallel(
      toVerify.map((f, i) => () =>
        agent(
          `You are an independent refuter. Working directory is the repo root. You did NOT write the finding below and have no stake in it.

Claimed finding (lens ${lensId}):
${JSON.stringify(f, null, 2)}

Read the cited code/docs in the repo. Try to PROVE this is a non-issue. Default to refuted=true unless you can demonstrate concrete harm via a real path through the code/spec. Return refuted + a one-paragraph reason.`,
          { schema: VERDICT_SCHEMA, label: `verify:${lensId}:${(f.file || '?').split('/').pop()}#${i}`, phase: 'Verify' }
        ).then((verdict) => ({ ...f, lens: lensId, verdict }))
      )
    )
    return {
      lens: lensId,
      allClear: review.allClear,
      verified: verified.filter(Boolean),
      passthrough: passthrough.map((f) => ({ ...f, lens: lensId }))
    }
  }
)

// ---------------------------------------------------------------------------
// Deterministic gating: drop refuted gating-findings before synthesis.
// ---------------------------------------------------------------------------
const lensResults = reviewed.filter(Boolean)
const survivors = []
for (const r of lensResults) {
  for (const f of r.verified || []) if (!(f.verdict && f.verdict.refuted)) survivors.push(f)
  for (const f of r.passthrough || []) survivors.push(f)
}
const clearLenses = lensResults.filter((r) => r.allClear && !(r.verified || []).length).map((r) => r.lens)
log(`findings surviving refutation: ${survivors.length} | all-clear lenses: ${clearLenses.join(', ') || 'none'}`)

// ---------------------------------------------------------------------------
// Phase 4 — Synthesize: dedupe, rank, gate, completeness critic.
// ---------------------------------------------------------------------------
phase('Synthesize')
const report = await agent(
  `You are the synthesis step of a multi-lens review. Working directory is the repo root.

Activated lenses: ${activated.join(', ')}.
Lenses that returned all-clear: ${clearLenses.join(', ') || 'none'}.
Changed files: ${JSON.stringify(route.changedFiles || [])}.

Verified findings that survived refutation (refuted ones already removed):
${JSON.stringify(survivors, null, 2)}

Do four things:
1. Dedupe/cluster findings that describe the same underlying issue (same file region + same claim).
2. Rank and bucket by severity into blockers, majors, minors.
3. Run a COMPLETENESS CRITIC: which activated lens produced neither a finding nor an explicit all-clear? Which changed file appears in NO finding and was plausibly relevant? List these as "gaps".
4. Write a 2-4 sentence summary with the gating verdict (per docs/review-lenses.md: any blocker => not done; majors must be fixed or waived).

Return per the schema.`,
  { schema: REPORT_SCHEMA, label: 'synthesize', phase: 'Synthesize' }
)

return { mode, range, activatedLenses: activated, clearLenses, survivingFindings: survivors.length, report }
