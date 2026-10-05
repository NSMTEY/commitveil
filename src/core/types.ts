export interface Identity {
  name: string;
  email: string;
}
export interface Commit {
  hash: string;
  author: Identity;
  committer: Identity;
  message: string;
}
export interface Policy {
  allowedNames: string[];
  allowedEmails: string[];
}
export interface Collection {
  commits: Commit[];
  tags: AnnotatedTag[];
  config: [string, string][];
}
export interface AnnotatedTag {
  hash: string;
  tagger: Identity;
  target: string;
  targetType: "commit" | "tag" | "tree" | "blob";
}
export interface Finding {
  ruleId: "CV001" | "CV002" | "CV003" | "CV004" | "CV005" | "CV006";
  source: string;
  field: "name" | "email" | "url";
  value: string;
  commit?: string;
  tag?: string;
}
export interface ScanResult {
  schemaVersion: 1;
  redacted: boolean;
  scannedCommits: number;
  scannedTags: number;
  findings: Finding[];
}
