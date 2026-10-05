# Output contract (v0.1.0)

Successful scans emit one terminal report or JSON object to stdout. Exit 1 is still a successful scan with findings. Errors go to stderr and exit 2. JSON errors contain `schemaVersion: 1` and `error`; no success report is emitted.

JSON success fields:

| Field | Meaning |
| --- | --- |
| schemaVersion | Integer 1 |
| redacted | Identity masking enabled; false with `--reveal`. Credential URLs are always hidden |
| scannedCommits | Number of unique reachable commits read |
| scannedTags | Number of unique reachable annotated tag objects read |
| findings | Deterministically sorted array; empty on a passing scan |

Every finding has `ruleId`, `source`, `field`, and `value`. Commit findings also have `commit`, the full object ID (SHA-1 or SHA-256); CV006 findings have `tag`, the annotated tag object ID, and source `tagger`. Tag object IDs are used instead of tagger-controlled tag names and distinguish nested tag objects. `field` is `name`, `email`, or `url`. CV001/2 sources are `author`/`committer`; CV003 sources are lowercase trailer labels; CV004 sources are `user.name`/`user.email`; CV005 sources are generic `remote.url` or `remote.pushurl`, so remote labels cannot disclose a detected credential. No repository absolute path or full message is included.

All findings are blocking review findings; no severity ranking is implied. Reports retain separate findings for separate occurrences. Values are presentation data, not raw evidence: default reports mask email local parts and replace credential URLs in full. Names, domains and source labels remain visible; email-shaped text in names and labels is masked. Invalid email-shaped trailer values are hidden in the email field by default.

Controls including ANSI ESC, C0/C1 and bidirectional overrides/isolate marks are rendered as literal `\uXXXX` strings. JSON serialization additionally applies JSON escaping. `--reveal` removes identity masking but keeps control escaping and credential suppression. Finding order uses a locale-independent lexical comparison of the finding serialization; repeated scans of an unchanged repository and policy produce identical reports.
