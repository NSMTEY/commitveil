import { describe, expect, it } from "vitest";
import { isSupportedGit, parseGitVersion } from "../../src/git/version.js";

describe("Git startup version guard", () => {
  it.each([
    "git version 2.45.0",
    "git version 2.55.0.windows.3",
    "git version 2.50.1 (Apple Git-155)",
    "git version 3.0.0\n",
  ])("supports %s", (version) => {
    expect(isSupportedGit(version)).toBe(true);
  });
  it.each([
    "git version 2.44.9",
    "git version 1.99.0",
    "git version 2.45.0.rc0",
    "git version 2.4",
    "git version broken",
    "untrusted 2.99.0",
    "git version 999999999999999999999.1.0",
  ])("rejects %s", (version) => {
    expect(isSupportedGit(version)).toBe(false);
  });
  it("parses vendor suffixes without treating them as version components", () => {
    expect(parseGitVersion("git version 2.55.0.windows.3")).toEqual([2, 55, 0]);
  });
});
