import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { scan } from "../../src/commands/scan.js";

// Fixtures live outside the checkout and are removed after the suite.
const base = realpathSync(
  mkdtempSync(join(tmpdir(), "commitveil-repositories-")),
);
const cli = resolve("dist/cli.js");
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_AUTHOR_NAME: "Alias",
  GIT_AUTHOR_EMAIL: "alias@users.noreply.github.com",
  GIT_COMMITTER_NAME: "Alias",
  GIT_COMMITTER_EMAIL: "alias@users.noreply.github.com",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
};
let sequence = 0;
function git(
  root: string,
  args: string[],
  overrides: Record<string, string> = {},
) {
  const result = spawnSync("git", ["-C", root, ...args], {
    env: { ...env, ...overrides },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function repo(
  policy: unknown = {
    allowedNames: ["Alias"],
    allowedEmails: ["*@users.noreply.github.com"],
  },
) {
  const root = join(base, `repository ${sequence++}`);
  mkdirSync(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Alias"]);
  git(root, ["config", "user.email", "alias@users.noreply.github.com"]);
  writeFileSync(join(root, ".commitveil.json"), JSON.stringify(policy));
  return root;
}
function commit(
  root: string,
  message = "synthetic",
  overrides: Record<string, string> = {},
) {
  git(
    root,
    [
      "-c",
      "core.hooksPath=",
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "-m",
      message,
    ],
    overrides,
  );
  return git(root, ["rev-parse", "HEAD"]);
}
function run(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [cli, "scan", root, ...args], {
    encoding: "utf8",
    env,
  });
}
beforeAll(() => {
  const build = spawnSync(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    { encoding: "utf8" },
  );
  if (build.status !== 0) throw new Error(build.stdout + build.stderr);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));
// Git/CLI fixtures are synchronous. Yield between tests so worker RPC and timers
// are serviced even during a long cross-platform suite.
afterEach(() => setImmediate());
describe("real Git histories and executable", () => {
  it("passes pseudonymous history and ordinary SSH remote with exit 0", () => {
    const root = repo();
    commit(root);
    git(root, [
      "remote",
      "add",
      "origin",
      "git@github.com:NSMTEY/commitveil.git",
    ]);
    expect(run(root).status).toBe(0);
  });
  it("detects old author email while HEAD is clean", () => {
    const root = repo();
    const old = commit(root, "old", {
      GIT_AUTHOR_EMAIL: "old@example.invalid",
    });
    commit(root, "clean");
    const result = run(root, ["--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV001",
        commit: old,
        value: "o***@example.invalid",
      }),
    );
  });
  it("detects committer email separately", () => {
    const root = repo();
    commit(root, "commit", {
      GIT_COMMITTER_EMAIL: "committer@example.invalid",
    });
    expect(scan(root, true, false).output).toContain("CV002");
    expect(run(root).status).toBe(1);
  });
  it.each([
    "Co-authored-by",
    "Signed-off-by",
    "Reviewed-by",
    "Tested-by",
    "Reported-by",
    "Acked-by",
    "Suggested-by",
  ])("checks %s", (trailer) => {
    const root = repo();
    commit(root, `subject\n\n${trailer}: Other <other@example.invalid>`);
    expect(JSON.parse(run(root, ["--json"]).stdout).findings).toContainEqual(
      expect.objectContaining({ ruleId: "CV003", field: "email" }),
    );
  });
  it("includes branch-only and tag-only history", () => {
    const root = repo();
    commit(root);
    git(root, ["checkout", "-b", "other"]);
    const hash = commit(root, "other", {
      GIT_AUTHOR_EMAIL: "branch@example.invalid",
    });
    git(root, ["tag", "saved"]);
    git(root, ["checkout", "main"]);
    expect(run(root).stdout).toContain(hash);
    git(root, ["branch", "-D", "other"]);
    expect(run(root).stdout).toContain(hash);
  });
  it("includes detached HEAD", () => {
    const root = repo();
    commit(root);
    git(root, ["checkout", "--detach"]);
    const hash = commit(root, "detached", {
      GIT_AUTHOR_EMAIL: "detached@example.invalid",
    });
    expect(run(root).stdout).toContain(hash);
  });
  it("allows explicitly approved collaborators", () => {
    const root = repo({
      allowedNames: ["Alias", "Collaborator"],
      allowedEmails: [
        "*@users.noreply.github.com",
        "collaborator@example.invalid",
      ],
    });
    commit(
      root,
      "Co-authored-by: Collaborator <collaborator@example.invalid>",
      {
        GIT_AUTHOR_NAME: "Collaborator",
        GIT_AUTHOR_EMAIL: "collaborator@example.invalid",
      },
    );
    expect(run(root).status).toBe(0);
  });
  it("checks local identity including all duplicate values", () => {
    const root = repo();
    git(root, ["config", "--add", "user.email", "local@example.invalid"]);
    git(root, ["config", "user.name", "Other"]);
    const findings = JSON.parse(run(root, ["--json"]).stdout).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "CV004", field: "name" }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: "CV004", field: "email" }),
    );
  });
  it.each([
    "http://user:synthetic@example.invalid/repo",
    "https://synthetic@example.invalid/repo",
    "https://user%40name:synthetic@example.invalid/repo",
  ])("detects credential remote %s", (url) => {
    const root = repo();
    git(root, ["remote", "add", "origin", url]);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("CV005");
    expect(result.stdout).not.toContain("synthetic");
    for (const args of [["--reveal"], ["--json", "--reveal"]]) {
      const revealed = run(root, args);
      expect(revealed.status).toBe(1);
      expect(revealed.stdout).not.toContain("synthetic");
    }
  });
  it("checks push URLs and allows ordinary HTTPS URLs", () => {
    const root = repo();
    git(root, ["remote", "add", "origin", "https://example.invalid/repo"]);
    expect(run(root).status).toBe(0);
    git(root, [
      "config",
      "remote.origin.pushurl",
      "https://user:synthetic@example.invalid/repo",
    ]);
    expect(run(root).status).toBe(1);
  });
  it("handles unusual messages, malformed trailers and hostile controls", () => {
    const root = repo();
    commit(
      root,
      "subject\n\nSigned-off-by: malformed\nCo-authored-by: Evil\x1b[2J <evil@example.invalid>\n\u202e\n\nbody",
      { GIT_AUTHOR_NAME: "Evil\x1b[2J" },
    );
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("\x1b");
    expect(result.stdout).not.toContain("\u202e");
    expect(result.stdout).toContain("\\u001b");
    expect(() => JSON.parse(run(root, ["--json"]).stdout)).not.toThrow();
  });
  it("produces deterministic redacted JSON, and reveals only on request", () => {
    const root = repo();
    commit(root, "leak", { GIT_AUTHOR_EMAIL: "private@example.invalid" });
    const first = run(root, ["--json"]);
    expect(first.stdout).toBe(run(root, ["--json"]).stdout);
    expect(JSON.parse(first.stdout).redacted).toBe(true);
    expect(first.stdout).not.toContain("private@");
    const revealed = run(root, ["--json", "--reveal"]);
    expect(JSON.parse(revealed.stdout).redacted).toBe(false);
    expect(revealed.stdout).toContain("private@");
  });
  it.each([
    "{",
    "null",
    "[]",
    '{"allowedEmails":42}',
    '{"allowedNames":[1]}',
    '{"typo":[]}',
    '{"allowedEmails":[""]}',
  ])("rejects invalid config %s with exit 2", (text) => {
    const root = repo();
    writeFileSync(join(root, ".commitveil.json"), text);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("Invalid");
  });
  it("returns 2 for invalid repositories and arguments", () => {
    expect(run(base).status).toBe(2);
    expect(run(repo(), ["--unknown"]).status).toBe(2);
  });
  it("supports empty, bare and subdirectory repositories", () => {
    const root = repo();
    expect(run(root).status).toBe(0);
    commit(root);
    const sub = join(root, "sub");
    mkdirSync(sub);
    expect(run(sub).status).toBe(0);
    const bare = join(base, `bare-${sequence++}`);
    git(root, ["clone", "--bare", root, bare]);
    expect(run(bare).status).toBe(1);
    writeFileSync(
      join(bare, ".commitveil.json"),
      readFileSync(join(root, ".commitveil.json")),
    );
    expect(run(bare).status).toBe(0);
  });
  it("uses safe defaults without config and init never overwrites", () => {
    const root = repo();
    rmSync(join(root, ".commitveil.json"));
    commit(root);
    expect(run(root).status).toBe(1);
    const invoke = () =>
      spawnSync(process.execPath, [cli, "init"], {
        cwd: root,
        encoding: "utf8",
        env,
      });
    expect(invoke().status).toBe(0);
    const original = readFileSync(join(root, ".commitveil.json"), "utf8");
    expect(invoke().status).toBe(2);
    expect(readFileSync(join(root, ".commitveil.json"), "utf8")).toBe(original);
  });
  it("does not invoke hooks or follow included configuration", () => {
    const root = repo();
    commit(root);
    const sentinel = join(root, "executed");
    const hook = join(root, "hook.cjs");
    writeFileSync(
      hook,
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed');`,
    );
    writeFileSync(
      join(root, "included.config"),
      "[user]\nemail = hidden@example.invalid\n",
    );
    git(root, ["config", "include.path", "../included.config"]);
    git(root, ["config", "core.fsmonitor", `"${process.execPath}" "${hook}"`]);
    expect(run(root).status).toBe(0);
    expect(() => readFileSync(sentinel)).toThrow();
  });
  it("fails closed on a partial clone with a missing reachable commit, without fetching", () => {
    const root = repo();
    const old = commit(root, "old");
    commit(root, "new");
    const helper = join(root, "fetch-helper.cjs");
    const sentinel = join(root, "fetch-executed");
    writeFileSync(
      helper,
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed'); process.exit(1);`,
    );
    git(root, ["remote", "add", "origin", "ssh://example.invalid/repo"]);
    git(root, ["config", "remote.origin.promisor", "true"]);
    git(root, ["config", "extensions.partialClone", "origin"]);
    git(root, [
      "config",
      "core.sshCommand",
      `"${process.execPath}" "${helper}"`,
    ]);
    rmSync(join(root, ".git", "objects", old.slice(0, 2), old.slice(2)));
    expect(run(root).status).toBe(2);
    expect(() => readFileSync(sentinel)).toThrow();
  });
  it("parses NULs and fake batch headers in messages without losing following commits", () => {
    const root = repo();
    const parent = commit(root);
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
    const raw = `tree ${tree}\nparent ${parent}\nauthor Alias <nul@example.invalid> 1577836800 +0000\ncommitter Alias <alias@users.noreply.github.com> 1577836800 +0000\n\nmessage\0\n${parent} commit 100\nCo-authored-by: Other <other@example.invalid>\n`;
    const object = spawnSync(
      "git",
      [
        "-C",
        root,
        "hash-object",
        "-t",
        "commit",
        "-w",
        "--stdin",
        "--literally",
      ],
      { env, input: raw, encoding: "utf8" },
    );
    expect(object.status, object.stderr).toBe(0);
    git(root, ["update-ref", "refs/heads/raw", object.stdout.trim()]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.scannedCommits).toBe(2);
    expect(parsed.findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV001",
        value: "n***@example.invalid",
      }),
    );
    expect(parsed.findings).toContainEqual(
      expect.objectContaining({ ruleId: "CV003", field: "email" }),
    );
  });
  it("surfaces unconfigured names with allowed noreply emails until explicitly approved", () => {
    const root = repo();
    rmSync(join(root, ".commitveil.json"));
    commit(root, "unconfigured", {
      GIT_AUTHOR_NAME: "Real Person",
      GIT_COMMITTER_NAME: "Another Person",
      GIT_AUTHOR_EMAIL: "123+alias@users.noreply.github.com",
    });
    const first = run(root, ["--json"]);
    expect(first.status).toBe(1);
    const findings = JSON.parse(first.stdout).findings;
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV001",
        field: "name",
        value: "Real Person",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV002",
        field: "name",
        value: "Another Person",
      }),
    );
    expect(
      findings.some((finding: { field: string }) => finding.field === "email"),
    ).toBe(false);
    writeFileSync(
      join(root, ".commitveil.json"),
      JSON.stringify({
        allowedNames: ["Alias", "Real Person", "Another Person"],
        allowedEmails: ["*@users.noreply.github.com"],
      }),
    );
    expect(run(root).status).toBe(0);
  });
  it.each([
    {},
    { allowedNames: [], allowedEmails: ["*@users.noreply.github.com"] },
    { allowedEmails: ["*@users.noreply.github.com"] },
  ])("empty or omitted name policies approve no names: %j", (policy) => {
    const root = repo(policy);
    commit(root);
    expect(run(root).status).toBe(1);
  });
  it("passes an empty repository with no identities but reviews configured local names", () => {
    const root = repo();
    rmSync(join(root, ".commitveil.json"));
    expect(run(root).status).toBe(1);
    git(root, ["config", "--unset", "user.name"]);
    git(root, ["config", "--unset", "user.email"]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).scannedCommits).toBe(0);
  });
  it("audits enabled worktree-specific identity settings", () => {
    const root = repo();
    git(root, ["config", "extensions.worktreeConfig", "true"]);
    git(root, ["config", "--worktree", "user.name", "Other"]);
    expect(JSON.parse(run(root, ["--json"]).stdout).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV004",
        field: "name",
        value: "Other",
      }),
    );
  });
  it("allows annotated taggers and does not invent taggers for lightweight tags", () => {
    const root = repo();
    commit(root);
    git(root, [
      "-c",
      "tag.gpgSign=false",
      "tag",
      "-a",
      "approved",
      "-m",
      "tag",
    ]);
    git(root, ["tag", "lightweight"]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).scannedTags).toBe(1);
  });
  it("finds annotated tagger email with deterministic redacted tag context", () => {
    const root = repo();
    commit(root);
    git(root, ["-c", "tag.gpgSign=false", "tag", "-a", "email", "-m", "tag"], {
      GIT_COMMITTER_EMAIL: "tagger@example.invalid",
    });
    const hash = git(root, ["rev-parse", "refs/tags/email"]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(run(root, ["--json"]).stdout);
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV006",
        field: "email",
        value: "t***@example.invalid",
        tag: hash,
      }),
    );
    expect(run(root, ["--reveal"]).stdout).toContain("tagger@example.invalid");
    expect(run(root, ["--json", "--reveal"]).stdout).toContain(
      "tagger@example.invalid",
    );
  });
  it("finds annotated tagger names even when email is allowed", () => {
    const root = repo();
    commit(root);
    git(root, ["-c", "tag.gpgSign=false", "tag", "-a", "name", "-m", "tag"], {
      GIT_COMMITTER_NAME: "Real Person",
    });
    expect(JSON.parse(run(root, ["--json"]).stdout).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV006",
        field: "name",
        value: "Real Person",
      }),
    );
    rmSync(join(root, ".commitveil.json"));
    expect(run(root).status).toBe(1);
  });
  it("audits nested tags reachable outside the current branch", () => {
    const root = repo();
    commit(root);
    git(root, ["checkout", "-b", "other"]);
    commit(root, "other");
    git(
      root,
      ["-c", "tag.gpgSign=false", "tag", "-a", "inner", "-m", "inner"],
      { GIT_COMMITTER_EMAIL: "inner@example.invalid" },
    );
    const hash = git(root, ["rev-parse", "refs/tags/inner"]);
    git(root, [
      "-c",
      "tag.gpgSign=false",
      "tag",
      "-a",
      "outer",
      "inner",
      "-m",
      "outer",
    ]);
    git(root, ["tag", "-d", "inner"]);
    git(root, ["checkout", "main"]);
    git(root, ["branch", "-D", "other"]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).scannedTags).toBe(2);
    expect(JSON.parse(result.stdout).findings).toContainEqual(
      expect.objectContaining({ ruleId: "CV006", tag: hash }),
    );
  });
  it("fails closed on missing or malformed tagger metadata", () => {
    const root = repo();
    const parent = commit(root);
    const raw = `object ${parent}\ntype commit\ntag malformed\n\nmessage\n`;
    const object = spawnSync(
      "git",
      ["-C", root, "hash-object", "-t", "tag", "-w", "--stdin", "--literally"],
      { input: raw, encoding: "utf8", env },
    );
    expect(object.status, object.stderr).toBe(0);
    git(root, ["update-ref", "refs/tags/malformed", object.stdout.trim()]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(() => JSON.parse(result.stderr)).not.toThrow();
  });
  it.each([
    "token",
    "access_token",
    "auth",
    "authorization",
    "apikey",
    "api_key",
    "key",
    "password",
    "passwd",
    "secret",
    "ACCESS_TOKEN",
    "%74oken",
    "api-key",
    "token%5B%5D",
  ])(
    "detects query credentials named %s without disclosure even with reveal",
    (key) => {
      const root = repo();
      git(root, [
        "remote",
        "add",
        "origin",
        `https://example.invalid/repo?normal=1&${key}=synthetic-sensitive-value`,
      ]);
      for (const args of [
        [],
        ["--reveal"],
        ["--json"],
        ["--json", "--reveal"],
      ]) {
        const result = run(root, args);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("CV005");
        expect(result.stdout).not.toContain("synthetic-sensitive-value");
        expect(result.stderr).toBe("");
      }
    },
  );
  it("allows ordinary queries and unusual valid HTTP/SSH remotes", () => {
    const root = repo();
    commit(root);
    for (const url of [
      "https://example.invalid/repo?branch=main&depth=1",
      "https://[::1]:443/repo?version=2",
      "ssh://git@example.invalid:2222/repo",
      "git@example.invalid:repo",
      "HTTPS://example.invalid/repo?ref=main",
    ]) {
      git(root, ["config", "remote.origin.url", url]);
      expect(run(root).status).toBe(0);
    }
    git(root, [
      "config",
      "remote.origin.pushurl",
      "https://example.invalid/repo?token=synthetic-sensitive-value",
    ]);
    expect(run(root, ["--reveal"]).status).toBe(1);
  });
  it("fails safely for malformed HTTP remote URLs without logging them", () => {
    const root = repo();
    git(root, [
      "config",
      "remote.origin.url",
      "https://[broken?token=synthetic-sensitive-value",
    ]);
    const result = run(root, ["--reveal", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(
      "synthetic-sensitive-value",
    );
  });
  it("refuses shallow history instead of passing a clean HEAD", () => {
    const source = repo();
    commit(source, "old", { GIT_AUTHOR_EMAIL: "old@example.invalid" });
    commit(source, "clean");
    const shallow = join(base, `shallow-${sequence++}`);
    git(source, ["clone", "--depth=1", pathToFileURL(source).href, shallow]);
    writeFileSync(
      join(shallow, ".commitveil.json"),
      readFileSync(join(source, ".commitveil.json")),
    );
    const result = run(shallow, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("Shallow");
  });
  it("detects old identities in a practical 500-commit history", () => {
    const root = repo();
    const input = Array.from(
      { length: 500 },
      (_, i) =>
        `commit refs/heads/main\nauthor Alias <${i === 0 ? "old@example.invalid" : "alias@users.noreply.github.com"}> ${1577836800 + i} +0000\ncommitter Alias <alias@users.noreply.github.com> ${1577836800 + i} +0000\ndata 4\nmany\n\n`,
    ).join("");
    const result = spawnSync("git", ["-C", root, "fast-import", "--quiet"], {
      env,
      input,
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const scan = run(root, ["--json"]);
    expect(scan.status).toBe(1);
    expect(JSON.parse(scan.stdout).scannedCommits).toBe(500);
    expect(JSON.parse(scan.stdout).findings).toContainEqual(
      expect.objectContaining({
        ruleId: "CV001",
        value: "o***@example.invalid",
      }),
    );
  });
  it("does not normalize confusable Unicode identities into approved names", () => {
    const root = repo();
    commit(root, "Unicode", { GIT_AUTHOR_NAME: "\u0410lias\u202e" });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("\\u202e");
    expect(result.stdout).not.toContain("\u202e");
  });
  it("fails with exit 2 when Git cannot be executed", () => {
    const root = repo();
    const result = spawnSync(process.execPath, [cli, "scan", root, "--json"], {
      env: { ...env, PATH: "", Path: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stderr).error).toContain("Git");
  });
  it("rejects oversized policy files before parsing", () => {
    const root = repo();
    writeFileSync(join(root, ".commitveil.json"), " ".repeat(1024 * 1024 + 1));
    expect(run(root).status).toBe(2);
  });
  it("does not skip credential remotes with unusual labels or whitespace", () => {
    const root = repo();
    git(root, [
      "config",
      "remote.unusual.label.url",
      " https://example.invalid/repo?normal=1;token=synthetic-sensitive-value ",
    ]);
    const result = run(root, ["--json", "--reveal"]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("synthetic-sensitive-value");
    expect(result.stdout).not.toContain("unusual");
  });
  it("fails closed on undecodable commit text instead of silently substituting bytes", () => {
    const root = repo();
    const parent = commit(root);
    const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
    const raw = Buffer.concat([
      Buffer.from(
        `tree ${tree}\nparent ${parent}\nauthor Alias <alias@users.noreply.github.com> 1577836800 +0000\ncommitter Alias <alias@users.noreply.github.com> 1577836800 +0000\n\n`,
      ),
      Buffer.from([255]),
    ]);
    const object = spawnSync(
      "git",
      [
        "-C",
        root,
        "hash-object",
        "-t",
        "commit",
        "-w",
        "--stdin",
        "--literally",
      ],
      { env, input: raw, encoding: "utf8" },
    );
    expect(object.status, object.stderr).toBe(0);
    git(root, [
      "update-ref",
      "refs/heads/invalid-encoding",
      object.stdout.trim(),
    ]);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("UTF-8");
  });
  it("never executes a repository-local Git lookalike, even from its cwd or PATH", () => {
    const root = repo();
    commit(root);
    const lookalike = join(
      root,
      process.platform === "win32" ? "git.exe" : "git",
    );
    copyFileSync(process.execPath, lookalike);
    chmodSync(lookalike, 0o755);
    const trustedPath =
      Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ??
      "";
    const childEnv = Object.fromEntries(
      Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
    );
    const result = spawnSync(process.execPath, [cli, "scan", root], {
      cwd: root,
      env: {
        ...childEnv,
        PATH: `${root}${delimiter}.${delimiter}${trustedPath}`,
      },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
  });
  it("refuses legacy grafts even when their warning is disabled and HEAD is clean", () => {
    const root = repo();
    commit(root, "old", { GIT_AUTHOR_EMAIL: "old@example.invalid" });
    const head = commit(root, "clean");
    git(root, ["config", "advice.graftFileDeprecated", "false"]);
    writeFileSync(join(root, ".git", "info", "grafts"), `${head}\n`);
    const result = run(root, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("grafts");
  });
  it("refuses corrupted identity objects even when Git reads them without an error", () => {
    const root = repo();
    const old = commit(root, "old", {
      GIT_AUTHOR_EMAIL: "old@example.invalid",
    });
    commit(root, "clean");
    const file = join(root, ".git", "objects", old.slice(0, 2), old.slice(2));
    const inflated = inflateSync(readFileSync(file));
    const body = inflated
      .subarray(inflated.indexOf(0) + 1)
      .toString()
      .replace("old@example.invalid", "alias@users.noreply.github.com");
    chmodSync(file, 0o644);
    writeFileSync(
      file,
      deflateSync(Buffer.from(`commit ${Buffer.byteLength(body)}\0${body}`)),
    );
    const result = run(root, ["--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toContain("checksum");
  });
});
