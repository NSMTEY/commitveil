import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AnnotatedTag,
  Collection,
  Commit,
  Identity,
} from "../core/types.js";
import { resolveGitExecutable } from "./executable.js";
import { requireSupportedGit } from "./version.js";

export const MAX_OBJECT_BYTES = 128 * 1024 * 1024;
export const MAX_OBJECTS = 100000;

function decode(data: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new Error(
      "Unsupported non-UTF-8 Git metadata; cannot audit reliably.",
    );
  }
}
function verifyObject(
  hash: string,
  type: "commit" | "tag",
  data: Buffer,
): void {
  if (![40, 64].includes(hash.length))
    throw new Error("Unsupported Git object ID format.");
  const actual = createHash(hash.length === 40 ? "sha1" : "sha256")
    .update(`${type} ${data.length}\0`)
    .update(data)
    .digest("hex");
  if (actual !== hash)
    throw new Error(
      "Git identity object checksum mismatch; cannot audit corrupted history reliably.",
    );
}

// Ignore caller Git overrides, global config, replacements and optional writes.
export function git(
  path: string,
  args: string[],
  input?: string,
  allowMissing = false,
): Buffer {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "",
  });
  const result = spawnSync(
    resolveGitExecutable([process.cwd(), path]),
    [
      "--no-pager",
      "--no-lazy-fetch",
      "-c",
      "core.fsmonitor=false",
      "-C",
      resolve(path),
      ...args,
    ],
    {
      env,
      input,
      timeout: 60000,
      maxBuffer: MAX_OBJECT_BYTES,
      windowsHide: true,
    },
  );
  if (
    allowMissing &&
    !result.error &&
    result.status === 1 &&
    !result.stderr.length
  )
    return Buffer.alloc(0);
  if (result.error || result.status !== 0 || result.stderr.length > 0)
    throw new Error("Git execution failed or path is not a valid repository.");
  return result.stdout;
}
function identity(value: string): Identity {
  const match = /^(.*) <([^<>]*)> -?\d+ [+-]\d{4}$/.exec(value);
  if (!match) throw new Error("Malformed Git commit identity.");
  return { name: match[1] ?? "", email: match[2] ?? "" };
}
function oneHeader(headers: string[], key: string): string {
  const values = headers.filter((line) => line.startsWith(`${key} `));
  if (values.length !== 1)
    throw new Error("Missing or duplicate Git identity/object header.");
  return values[0]?.slice(key.length + 1) ?? "";
}
export function parseCommit(hash: string, raw: string): Commit {
  const split = raw.indexOf("\n\n");
  if (split < 0) throw new Error("Malformed Git commit object.");
  const headers = raw.slice(0, split).split("\n");
  return {
    hash,
    author: identity(oneHeader(headers, "author")),
    committer: identity(oneHeader(headers, "committer")),
    message: raw.slice(split + 2),
  };
}
export function parseTag(hash: string, raw: string): AnnotatedTag {
  const split = raw.indexOf("\n\n");
  if (split < 0) throw new Error("Malformed Git annotated tag.");
  const headers = raw.slice(0, split).split("\n");
  const target = oneHeader(headers, "object");
  const targetType = oneHeader(headers, "type");
  if (
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(target) ||
    !["commit", "tag", "tree", "blob"].includes(targetType)
  )
    throw new Error("Malformed Git tag target.");
  oneHeader(headers, "tag");
  return {
    hash,
    target,
    targetType: targetType as AnnotatedTag["targetType"],
    tagger: identity(oneHeader(headers, "tagger")),
  };
}
export function repositoryRoot(path: string): string {
  requireSupportedGit(path);
  const bare = git(path, ["rev-parse", "--is-bare-repository"])
    .toString()
    .trim();
  return git(path, [
    "rev-parse",
    bare === "true" ? "--absolute-git-dir" : "--show-toplevel",
  ])
    .toString()
    .replace(/\r?\n$/, "");
}
export function collect(root: string): Collection {
  const graftPath = decode(
    git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "info/grafts",
    ]),
  ).replace(/\r?\n$/, "");
  let grafts = false;
  try {
    lstatSync(graftPath);
    grafts = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Cannot inspect legacy Git grafts safely.");
  }
  if (grafts)
    throw new Error(
      "Legacy Git grafts can hide raw parent history; remove them separately before scanning.",
    );
  if (
    git(root, ["rev-parse", "--is-shallow-repository"]).toString().trim() !==
    "false"
  )
    throw new Error(
      "Shallow repository: complete locally reachable history is required. Fetch full history separately before scanning.",
    );
  const hashes = git(root, ["rev-list", "--all"])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  if (hashes.length > MAX_OBJECTS)
    throw new Error("Scan exceeds the 100000-object metadata limit.");
  const commits: Commit[] = [];
  let bytes = 0;
  if (hashes.length) {
    const data = git(root, ["cat-file", "--batch"], `${hashes.join("\n")}\n`);
    let offset = 0;
    for (const hash of hashes) {
      const end = data.indexOf(10, offset);
      const header = data.subarray(offset, end).toString();
      const match = /^([a-f0-9]+) commit (\d+)$/.exec(header);
      if (!match || match[1] !== hash)
        throw new Error("Unexpected Git object response.");
      const size = Number(match[2]);
      bytes += size;
      offset = end + 1;
      if (offset + size >= data.length)
        throw new Error("Truncated Git object response.");
      verifyObject(hash, "commit", data.subarray(offset, offset + size));
      commits.push(
        parseCommit(hash, decode(data.subarray(offset, offset + size))),
      );
      offset += size + 1;
    }
  }
  const refs = git(root, [
    "for-each-ref",
    "--format=%(objectname) %(objecttype)",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
  const tags: AnnotatedTag[] = [];
  const pending = refs
    .filter((ref) => ref.endsWith(" tag"))
    .map((ref) => ref.split(" ")[0] ?? "")
    .sort();
  // HEAD can itself refer to an annotated tag object in unusual repositories.
  const head = git(
    root,
    ["rev-parse", "--verify", "--quiet", "HEAD"],
    undefined,
    true,
  );
  if (head.length) {
    const hash = head.toString().trim();
    if (git(root, ["cat-file", "-t", hash]).toString().trim() === "tag")
      pending.push(hash);
  }
  const seen = new Set<string>();
  for (let i = 0; i < pending.length; i++) {
    const hash = pending[i] ?? "";
    if (seen.has(hash)) continue;
    if (hashes.length + seen.size >= MAX_OBJECTS)
      throw new Error("Scan exceeds the 100000-object metadata limit.");
    seen.add(hash);
    const raw = git(root, ["cat-file", "tag", hash]);
    bytes += raw.length;
    if (bytes > MAX_OBJECT_BYTES)
      throw new Error("Scan exceeds the 128 MiB metadata limit.");
    verifyObject(hash, "tag", raw);
    const tag = parseTag(hash, decode(raw));
    tags.push(tag);
    if (tag.targetType === "tag") pending.push(tag.target);
    else if (
      git(root, ["cat-file", "-t", tag.target]).toString().trim() !==
      tag.targetType
    )
      throw new Error("Missing or inconsistent Git tag target.");
  }
  const entries = decode(
    git(root, ["config", "--local", "--no-includes", "--null", "--list"]),
  )
    .split("\0")
    .filter(Boolean);
  const config: [string, string][] = entries.map((entry) => {
    const i = entry.indexOf("\n");
    return [i < 0 ? entry : entry.slice(0, i), i < 0 ? "" : entry.slice(i + 1)];
  });
  if (
    config.some(
      ([key, value]) =>
        key === "extensions.worktreeconfig" &&
        ["", "true", "1", "yes", "on"].includes(value.toLowerCase()),
    )
  ) {
    const entries = decode(
      git(root, ["config", "--worktree", "--no-includes", "--null", "--list"]),
    )
      .split("\0")
      .filter(Boolean);
    for (const entry of entries) {
      const i = entry.indexOf("\n");
      config.push([
        i < 0 ? entry : entry.slice(0, i),
        i < 0 ? "" : entry.slice(i + 1),
      ]);
    }
  }
  return {
    commits,
    tags: tags.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)),
    config,
  };
}
