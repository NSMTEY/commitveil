# Changelog

## [0.1.0] - Unreleased

- Added `commitveil scan [path]`, `--json`, `--reveal`, `init`, help and version commands.
- Collected raw author/committer and annotated tagger identities across locally reachable refs and HEAD, including nested annotated tags.
- Reviewed seven identity trailer types, repository-local Git identities, and credential-bearing HTTP/HTTPS fetch and push remotes.
- Added allowlist policy with whole-value wildcard matching and strict validation.
- Added stable CV001–CV006 findings, deterministic reports, default email redaction, permanent detected-credential suppression even with `--reveal`, and escaped terminal controls.
- Reviewed every unapproved name by default; empty name policies approve no names.
- Detected credential-like HTTP/HTTPS remote query keys alongside embedded user information.
- Refused shallow histories, legacy grafts and malformed/unavailable metadata, enforced Git 2.45+ with a clear startup error, and bounded metadata collection and policy input.
- Resolved Git to a trusted absolute executable to prevent repository-local executable shadowing, including Windows current-directory lookup.
- Verified collected commit/tag object checksums to refuse corrupted identity history even when Git reads it successfully.
- Defined exit codes 0, 1 and 2 with real Git integration coverage.
- Prepared the ESM CLI package, MIT license, contributor/security documentation and cross-platform CI.
