const outputDirectory = "packages/codex-protocol/generated";

async function run(command: string[]): Promise<string> {
  // Bun owns the process lifecycle. This script intentionally does not depend on Node.
  const process = Bun.spawn(command, {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${exitCode})\n${stderr.trim()}`);
  }
  return stdout.trim();
}

try {
  const version = await run(["codex", "--version"]);
  await run(["mkdir", "-p", outputDirectory]);
  await Promise.all([
    run(["codex", "app-server", "generate-ts", "--out", outputDirectory]),
    run(["codex", "app-server", "generate-json-schema", "--out", outputDirectory]),
  ]);
  console.log(`Generated Codex app-server schemas from ${version} in ${outputDirectory}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Install and sign in to the Codex CLI, then rerun `bun run codex:schema`.");
  process.exitCode = 1;
}
