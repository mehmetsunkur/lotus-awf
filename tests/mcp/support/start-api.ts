import { execFileSync } from "node:child_process";

function commandWorks(command: string, args: string[]) {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dockerRunner(): { command: string; args: string[] } {
  if (process.env.DOCKER_USE_SUDO === "1") return { command: "sudo", args: ["-n", "docker"] };
  if (commandWorks("docker", ["version"])) return { command: "docker", args: [] };
  if (commandWorks("sudo", ["-n", "docker", "version"])) return { command: "sudo", args: ["-n", "docker"] };
  throw new Error("Docker is not accessible. Grant Docker socket access or configure passwordless sudo for docker.");
}

function runDocker(runner: { command: string; args: string[] }, args: string[], stdio: "ignore" | "inherit" = "ignore"): void {
  execFileSync(runner.command, [...runner.args, ...args], { stdio });
}

function dockerOutput(runner: { command: string; args: string[] }, args: string[]): string {
  return execFileSync(runner.command, [...runner.args, ...args], { encoding: "utf8" }).trim();
}

function ensureCouchServices(runner: { command: string; args: string[] }): void {
  runDocker(runner, ["compose", "up", "-d", "local-couchdb", "server-couchdb"], "inherit");
}

function serviceIp(runner: { command: string; args: string[] }, service: string): string {
  const id = dockerOutput(runner, ["compose", "ps", "-q", service]);
  if (!id) {
    throw new Error(`Docker Compose service "${service}" is not running; expected "docker compose up -d local-couchdb server-couchdb" to start it.`);
  }
  const ip = dockerOutput(runner, [
    "inspect",
    id,
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
  ]);
  if (!ip) throw new Error(`Docker Compose service "${service}" has no Docker network IP.`);
  return ip;
}

const runner = dockerRunner();
ensureCouchServices(runner);
process.env.E2E = "1";
process.env.LOCAL_COUCH_URL ??= `http://admin:password@${serviceIp(runner, "local-couchdb")}:5984`;
process.env.SERVER_COUCH_URL ??= `http://admin:password@${serviceIp(runner, "server-couchdb")}:5984`;

await import("../../../src/server/index");
