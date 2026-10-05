import type { Finding, ScanResult } from "../core/types.js";
export function sanitize(value: string): string {
  return value.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escape hostile terminal controls.
    /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
export function redact(value: string): string {
  return value.replace(
    /([^\s<>@]+)@([^\s<>@]+)/g,
    (_, local: string, domain: string) => `${local[0] ?? ""}***@${domain}`,
  );
}
function safeFinding(finding: Finding, reveal: boolean): Finding {
  let value = finding.value;
  if (finding.field === "url") value = "[credential-bearing URL redacted]";
  else if (!reveal) {
    value = redact(value);
    if (finding.field === "email" && !value.includes("@")) value = "[redacted]";
  }
  return {
    ...finding,
    source: sanitize(reveal ? finding.source : redact(finding.source)),
    value: sanitize(value),
  };
}
export function report(
  count: number,
  findings: Finding[],
  json: boolean,
  reveal: boolean,
  tagCount = 0,
): string {
  const result: ScanResult = {
    schemaVersion: 1,
    redacted: !reveal,
    scannedCommits: count,
    scannedTags: tagCount,
    findings: findings.map((finding) => safeFinding(finding, reveal)),
  };
  if (json) return JSON.stringify(result, null, 2);
  return [
    `CommitVeil: scanned ${count} commits and ${tagCount} annotated tags; ${findings.length} review findings.`,
    ...result.findings.map(
      (f) =>
        `${f.ruleId} ${f.commit || f.tag ? `${f.commit ?? f.tag} ` : ""}${f.source} ${f.field}: ${f.value}`,
    ),
    ...(findings.length
      ? ["Review identities against your publication policy before publishing."]
      : []),
  ].join("\n");
}
