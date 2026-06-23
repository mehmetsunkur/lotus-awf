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

function serviceIp(runner: { command: string; args: string[] }, service: string): string {
  const id = execFileSync(runner.command, [...runner.args, "compose", "ps", "-q", service], { encoding: "utf8" }).trim();
  return execFileSync(runner.command, [
    ...runner.args,
    "inspect",
    id,
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"
  ], { encoding: "utf8" }).trim();
}

const runner = dockerRunner();
process.env.E2E = "1";
process.env.LOCAL_COUCH_URL ??= `http://admin:password@${serviceIp(runner, "local-couchdb")}:5984`;
process.env.SERVER_COUCH_URL ??= `http://admin:password@${serviceIp(runner, "server-couchdb")}:5984`;

await import("../../../src/server/index");
