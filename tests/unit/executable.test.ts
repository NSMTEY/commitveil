import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveGitExecutable } from "../../src/git/executable.js";

const base = mkdtempSync(resolve(".test-repositories-executable-"));
const blocked = join(base, "untrusted");
const trusted = join(base, "trusted");
mkdirSync(blocked);
mkdirSync(trusted);
const filename = process.platform === "win32" ? "git.exe" : "git";
for (const directory of [blocked, trusted]) {
  writeFileSync(join(directory, filename), "not executed");
  chmodSync(join(directory, filename), 0o755);
}
afterAll(() => rmSync(base, { recursive: true, force: true }));
describe("absolute Git executable selection", () => {
  it("ignores empty, relative and repository-local PATH entries", () => {
    expect(
      resolveGitExecutable([blocked], {
        PATH: `${delimiter}.${delimiter}${blocked}${delimiter}${trusted}`,
      }),
    ).toBe(join(trusted, filename));
  });
  it("handles quoted Windows paths and case-insensitive PATH variable names", () => {
    expect(resolveGitExecutable([blocked], { Path: `"${trusted}"` })).toBe(
      join(trusted, filename),
    );
  });
  it("fails closed rather than falling back to an implicit cwd search", () => {
    expect(() =>
      resolveGitExecutable([blocked], {
        PATH: `${delimiter}.${delimiter}${blocked}`,
      }),
    ).toThrow("trusted absolute PATH");
  });
  it("excludes the enclosing repository when scanning from a subdirectory", () => {
    const nested = join(blocked, "sub");
    mkdirSync(nested);
    mkdirSync(join(blocked, ".git"));
    expect(
      resolveGitExecutable([nested], {
        PATH: `${blocked}${delimiter}${trusted}`,
      }),
    ).toBe(join(trusted, filename));
  });
});
