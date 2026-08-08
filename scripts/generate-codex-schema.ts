const outputDirectory = "packages/codex-protocol/generated";
const adapterDirectory = "packages/codex-protocol/src";

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

function exportedStringLiterals(source: string, typeName: string): string[] {
  const declaration = source.slice(source.indexOf(`export type ${typeName}`));
  if (!declaration) throw new Error(`Generated type ${typeName} was not found`);
  return [...declaration.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

try {
  const version = await run(["codex", "--version"]);
  await run(["mkdir", "-p", outputDirectory]);
  await Promise.all([
    run(["codex", "app-server", "generate-ts", "--out", outputDirectory]),
    run(["codex", "app-server", "generate-json-schema", "--out", outputDirectory]),
  ]);
  const [commandDecisionSource, fileDecisionSource] = await Promise.all([
    Bun.file(`${outputDirectory}/v2/CommandExecutionApprovalDecision.ts`).text(),
    Bun.file(`${outputDirectory}/v2/FileChangeApprovalDecision.ts`).text(),
  ]);
  const commandDecisions = exportedStringLiterals(
    commandDecisionSource,
    "CommandExecutionApprovalDecision",
  );
  const fileDecisions = exportedStringLiterals(
    fileDecisionSource,
    "FileChangeApprovalDecision",
  );
  const sharedSimpleDecisions = fileDecisions.filter((decision) => (
    commandDecisions.includes(decision)
  ));
  const expectedDecisions = ["accept", "acceptForSession", "decline", "cancel"];
  if (JSON.stringify(sharedSimpleDecisions) !== JSON.stringify(expectedDecisions)) {
    throw new Error(
      `Codex approval decisions changed: ${sharedSimpleDecisions.join(", ")}`,
    );
  }

  // Commit the narrow adapter consumed by Office IDE, not thousands of unrelated
  // generated protocol files. A CLI upgrade regenerates this file and makes any
  // decision-literal drift visible in review.
  const generatedAdapter = `// GENERATED CODE! DO NOT MODIFY BY HAND!\n`
    + `// Source: ${version} app-server TypeScript bindings.\n\n`
    + `export const CODEX_APP_SERVER_SCHEMA_VERSION = ${JSON.stringify(version)} as const;\n\n`
    + `export type CodexApprovalDecision =\n`
    + sharedSimpleDecisions.map((decision, index) => (
      `  | ${JSON.stringify(decision)}${index === sharedSimpleDecisions.length - 1 ? ";" : ""}\n`
    )).join("");
  await Bun.write(`${adapterDirectory}/generated.ts`, generatedAdapter);
  console.log(`Generated Codex app-server schemas from ${version} in ${outputDirectory}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Install and sign in to the Codex CLI, then rerun `bun run codex:schema`.");
  process.exitCode = 1;
}
