import { spawnSync } from "node:child_process";
import { resolveGitExecutable } from "./executable.js";

export function parseGitVersion(text: string): [number, number, number] | null {
  const match = /^git version (\d+)\.(\d+)\.(\d+)(?:[ .-].*)?$/.exec(
    text.trim(),
  );
  if (!match || /(?:^|[.-])rc\d/i.test(text)) return null;
  const values = match.slice(1, 4).map(Number);
  if (values.some((value) => !Number.isSafeInteger(value))) return null;
  return values as [number, number, number];
}
export function isSupportedGit(text: string): boolean {
  const version = parseGitVersion(text);
  return (
    version !== null &&
    (version[0] > 2 || (version[0] === 2 && version[1] >= 45))
  );
}
export function requireSupportedGit(path = process.cwd()): void {
  const result = spawnSync(
    resolveGitExecutable([process.cwd(), path]),
    ["--version"],
    {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4096,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      "Git is unavailable. Install Git 2.45+ to scan safely without lazy fetching.",
    );
  if (!isSupportedGit(result.stdout))
    throw new Error(
      "CommitVeil requires Git 2.45+ for the no-lazy-fetch guard; older or unrecognized versions cannot be scanned safely.",
    );
}
