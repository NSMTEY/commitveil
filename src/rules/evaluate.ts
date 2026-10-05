import type { Collection, Finding, Identity, Policy } from "../core/types.js";
import { matches } from "../policy/config.js";

const trailer =
  /^[ \t]*(Co-authored-by|Signed-off-by|Reviewed-by|Tested-by|Reported-by|Acked-by|Suggested-by):[ \t]*(.*)$/gim;
export function evaluate(data: Collection, policy: Policy): Finding[] {
  const findings: Finding[] = [];
  function check(
    identity: Identity,
    ruleId: Finding["ruleId"],
    source: string,
    commit?: string,
    tag?: string,
  ) {
    for (const field of ["name", "email"] as const) {
      if (
        !matches(
          identity[field],
          field === "name" ? policy.allowedNames : policy.allowedEmails,
          field === "email",
        )
      )
        findings.push({
          ruleId,
          source,
          field,
          value: identity[field],
          ...(commit ? { commit } : {}),
          ...(tag ? { tag } : {}),
        });
    }
  }
  for (const tag of data.tags)
    check(tag.tagger, "CV006", "tagger", undefined, tag.hash);
  for (const commit of data.commits) {
    check(commit.author, "CV001", "author", commit.hash);
    check(commit.committer, "CV002", "committer", commit.hash);
    for (const match of commit.message.matchAll(trailer)) {
      const value = match[2] ?? "";
      const parsed = /^(.*?)\s*<([^<>]*)>\s*$/.exec(value);
      // Recognized identity lines are checked anywhere in the message, conservatively.
      check(
        parsed
          ? { name: parsed[1]?.trim() ?? "", email: parsed[2] ?? "" }
          : { name: value, email: value },
        "CV003",
        (match[1] ?? "trailer").toLowerCase(),
        commit.hash,
      );
    }
  }
  for (const [key, value] of data.config) {
    if (key === "user.name" && !matches(value, policy.allowedNames))
      findings.push({ ruleId: "CV004", source: key, field: "name", value });
    if (key === "user.email" && !matches(value, policy.allowedEmails, true))
      findings.push({ ruleId: "CV004", source: key, field: "email", value });
    if (
      key.startsWith("remote.") &&
      (key.endsWith(".url") || key.endsWith(".pushurl")) &&
      /^https?:/i.test(value.trim().replace(/[\t\r\n]/g, ""))
    ) {
      if (hasCredentials(value))
        findings.push({
          ruleId: "CV005",
          source: key.endsWith(".pushurl") ? "remote.pushurl" : "remote.url",
          field: "url",
          value: "[credential-bearing URL redacted]",
        });
    }
  }
  return findings.sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

const credentialParameters = new Set([
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
  "client_secret",
  "auth_token",
  "private_token",
  "personal_access_token",
  "oauth_token",
  "x_api_key",
]);
export function hasCredentials(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Malformed HTTP/HTTPS remote URL; cannot audit safely.");
  }
  const authority =
    value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0] ?? "";
  return (
    authority.includes("@") ||
    Boolean(url.username || url.password) ||
    [
      ...new URLSearchParams(url.search.slice(1).replaceAll(";", "&")).keys(),
    ].some((key) =>
      credentialParameters.has(
        key.toLowerCase().replace(/\[\]$/, "").replaceAll("-", "_"),
      ),
    )
  );
}
