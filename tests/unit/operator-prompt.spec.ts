import { describe, expect, it } from "vitest";
import { assembleShiftPrompt } from "../../src/operator/prompt";

describe("operator shift prompt", () => {
  it("assembles the M27/M28 shared prompt shape exactly", () => {
    const prompt = assembleShiftPrompt({
      displayName: "Carol Kaptan",
      jobTitle: "Director of Flight Operations",
      companyName: "Agentic Airlines PLC",
      kbAppId: "kb-t1",
      jobDescription: "You run the flight schedule."
    });

    expect(prompt).toBe(
      [
        "You are Carol Kaptan, Director of Flight Operations at Agentic Airlines PLC.",
        'The company handbook is the app "kb-t1" — consult it to learn how the company',
        "works. Then carry out your working day.",
        "",
        "Your job description:",
        "You run the flight schedule."
      ].join("\n")
    );
  });

  it("carries the kb appId as the prompt's only pointer", () => {
    const prompt = assembleShiftPrompt({
      displayName: "Ivy Ramp",
      jobTitle: "Ramp Agent",
      companyName: "Agentic Airlines PLC",
      kbAppId: "handbook-42",
      jobDescription: "Ramp checks."
    });
    expect(prompt).toContain('"handbook-42"');
    expect(prompt).not.toContain("view:");
    expect(prompt).not.toContain("lotus_");
  });
});
