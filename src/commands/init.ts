import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryRoot } from "../git/collect.js";
export function init(): string {
  const root = repositoryRoot(process.cwd());
  try {
    writeFileSync(
      join(root, ".commitveil.json"),
      `${JSON.stringify({ allowedNames: [], allowedEmails: ["*@users.noreply.github.com"] }, null, 2)}\n`,
      { flag: "wx" },
    );
  } catch {
    throw new Error(
      "Cannot create .commitveil.json; check repository validity, permissions and whether it already exists.",
    );
  }
  return "Created .commitveil.json. Add approved names before scanning; an empty allowedNames array approves no names.";
}
