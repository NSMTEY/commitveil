#!/usr/bin/env node
import { init } from "./commands/init.js";
import { scan } from "./commands/scan.js";

const args = process.argv.slice(2);
const help =
  "CommitVeil 0.1.0\nUsage: commitveil scan [path] [--json] [--reveal]\n       commitveil init\n       commitveil --help | --version";
try {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
    console.log(help);
  else if (args.length === 1 && args[0] === "--version") console.log("0.1.0");
  else if (args[0] === "init" && args.length === 1) console.log(init());
  else if (args[0] === "scan") {
    const positional: string[] = [];
    let json = false;
    let reveal = false;
    let literal = false;
    for (const arg of args.slice(1)) {
      if (!literal && arg === "--") literal = true;
      else if (!literal && arg === "--json") json = true;
      else if (!literal && arg === "--reveal") reveal = true;
      else if (!literal && arg.startsWith("-"))
        throw new Error("Unknown scan option. Use --help.");
      else positional.push(arg);
    }
    if (positional.length > 1)
      throw new Error("Expected at most one repository path.");
    const result = scan(positional[0] ?? process.cwd(), json, reveal);
    console.log(result.output);
    process.exitCode = result.code;
  } else throw new Error("Invalid command. Use --help.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Internal error.";
  if (args.includes("--json"))
    console.error(JSON.stringify({ schemaVersion: 1, error: message }));
  else console.error(`CommitVeil: ${message}`);
  process.exitCode = 2;
}
