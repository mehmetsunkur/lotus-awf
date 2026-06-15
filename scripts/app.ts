import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesignDocument, TemplateArtifact } from "../src/shared/types";

/**
 * Definitions-as-code CLI (M7 developer tier). Extracts the running app's
 * definitions to one JSON file per definition (the on-disk form a developer
 * commits and diffs in git) and applies an edited set back through the existing
 * M6 promotion API — so the CLI shares the server's validation and
 * additive/update-only apply semantics rather than reimplementing them.
 */
const API_URL = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;

function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      opts[token.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return opts;
}

async function post(pathname: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`POST ${pathname} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const fileFor = (id: string) => `${id.replace(/[:/]/g, "_")}.json`;

async function extract(opts: Record<string, string>): Promise<void> {
  const out = opts.out || "app-definitions";
  const template: TemplateArtifact = await post("/api/templates/export", {
    version: opts.version,
    source: opts.source || "cli"
  });
  await mkdir(out, { recursive: true });
  for (const definition of template.definitions) {
    await writeFile(path.join(out, fileFor(definition._id)), `${JSON.stringify(definition, null, 2)}\n`);
  }
  const { definitions, ...meta } = template;
  await writeFile(path.join(out, "template.json"), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`Extracted ${definitions.length} definitions to ${out}/ (template ${template.templateId})`);
}

async function apply(opts: Record<string, string>): Promise<void> {
  const dir = opts.in || "app-definitions";
  const meta = JSON.parse(await readFile(path.join(dir, "template.json"), "utf8")) as Omit<TemplateArtifact, "definitions">;
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json") && file !== "template.json");
  const definitions: DesignDocument[] = [];
  for (const file of files) {
    definitions.push(JSON.parse(await readFile(path.join(dir, file), "utf8")) as DesignDocument);
  }
  const template: TemplateArtifact = { ...meta, definitions };
  const result = await post("/api/templates/apply", { template });
  const diff = result.diff as { added: unknown[]; changed: unknown[]; unchanged: unknown[]; removed: unknown[] };
  console.log(
    `Applied ${template.templateId}: +${diff.added.length} added, ~${diff.changed.length} changed, ` +
      `=${diff.unchanged.length} unchanged (${diff.removed.length} removed locally, not deleted)`
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (command === "extract") await extract(opts);
  else if (command === "apply") await apply(opts);
  else {
    console.error("Usage: tsx scripts/app.ts <extract|apply> [--out <dir>] [--in <dir>] [--version <v>] [--source <s>]");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
