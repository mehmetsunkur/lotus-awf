/**
 * The ENTIRE prompt for a persona shift (M27 contract, ADR-0021): identity line, the
 * single root pointer (the kb appId — the wiki URL a new hire gets), and the persona's
 * own job description read from the org app. Nothing else — no other appId, no view or
 * document id, no tool name. Shared by the working-day spec (tests/mcp/agent/twin.spec.ts)
 * and the operator daemon so the two can never drift; the spec's prompt-hygiene
 * assertion runs against this function's output.
 */
export type ShiftPromptInputs = {
  /** Directory display name, e.g. "Carol Kaptan". */
  displayName: string;
  /** Org-app job title, e.g. "Director of Flight Operations". */
  jobTitle: string;
  /** Company name for the identity line (fixture: "Agentic Airlines PLC"). */
  companyName: string;
  /** appId of the knowledge-base app — the prompt's only appId. */
  kbAppId: string;
  /** The persona's jobDescription payload field, verbatim. */
  jobDescription: string;
};

export function assembleShiftPrompt(inputs: ShiftPromptInputs): string {
  return [
    `You are ${inputs.displayName}, ${inputs.jobTitle} at ${inputs.companyName}.`,
    `The company handbook is the app "${inputs.kbAppId}" — consult it to learn how the company`,
    "works. Then carry out your working day.",
    "",
    "Your job description:",
    inputs.jobDescription
  ].join("\n");
}
