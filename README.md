# CommitVeil

Audit Git history for identity and email leaks before publishing a repository.

An old commit, annotated tag, collaborator trailer, or local Git setting can expose an identity even when the latest commit looks clean. CommitVeil compares those identities with your publication policy and reports what needs review.

## Install

Requires Node.js 22+, Git 2.45+ on PATH, and pnpm 10.18.3 for development. Version 0.1.0 is prepared locally and has not been published to npm.

```sh
pnpm install --frozen-lockfile
pnpm build
npm install --global .
```

## Quick start

Inside your repository:

```sh
commitveil init
# Edit .commitveil.json to list approved identities.
commitveil scan
```

## Example output

```text
CommitVeil: scanned 12 commits and 0 annotated tags; 1 review findings.
CV001 0123456789abcdef0123456789abcdef01234567 author email: p***@example.invalid
Review identities against your publication policy before publishing.
```

Findings mean identities fall outside your policy; an ordinary email is not necessarily private. Every finding blocks a passing exit code until you resolve it or approve the identity.

## Features

- Local, read-only scans with no telemetry or network requests.
- All locally reachable refs and detached HEAD, with stable rule IDs and commit hashes.
- Terminal and JSON reports with email redaction by default.
- Small dependency-free runtime; Windows, Linux, and macOS support.

## What it checks

| Rule | Source |
| --- | --- |
| CV001 | Commit author name and email |
| CV002 | Commit committer name and email |
| CV003 | Co-authored-by, Signed-off-by, Reviewed-by, Tested-by, Reported-by, Acked-by, Suggested-by identities |
| CV004 | Repository-local user.name and user.email |
| CV005 | HTTP/HTTPS remote and push URLs with user information or credential-like query keys |
| CV006 | Reachable annotated tagger name and email, including nested tags |

Names and emails are assessed separately; lightweight tags have no tagger metadata. A normal `git@github.com:NSMTEY/commitveil.git` SSH remote passes. Query keys including `token`, `access_token`, `auth`, `authorization`, `apikey`, `api_key`, `key`, `password`, `passwd` and `secret` trigger review; ordinary keys such as `branch` do not. See [policy details](docs/policy.md) for the full matching rules. Recognized trailer lines are checked anywhere in a commit message, case-insensitively, including malformed identity lines.

## What it does not check

CommitVeil is not a generic secret, vulnerability, .env, EXIF, or dependency scanner. It does not rewrite history or guarantee anonymity.

## Configuration

Place `.commitveil.json` at the worktree root (or Git directory for a bare repository):

```json
{
  "allowedNames": ["NSMTEY"],
  "allowedEmails": ["*@users.noreply.github.com"]
}
```

Patterns match the entire value. `*` matches zero or more characters; all other characters are literal. Names are case-sensitive; emails are case-insensitive. Empty or omitted lists in a configuration file approve no values. Every recorded name is reviewed unless explicitly allowed; the scanner does not infer whether a name is real, pseudonymous or public.

Without a configuration file, no names are approved and only `*@users.noreply.github.com` emails pass. Thus `Real Person <123+alias@users.noreply.github.com>` still needs name review. `init` writes those defaults without approving an identity and refuses to overwrite an existing file. A configuration file replaces defaults. Unknown keys, wrong types, empty patterns, control characters, malformed JSON and policies larger than 1 MiB fail with exit code 2. See the [collaborator example](examples/collaborators.commitveil.json).

## CLI reference

```text
commitveil scan [path] [--json] [--reveal]
commitveil init
commitveil --help
commitveil --version
```

The default path is the current directory. Subdirectories resolve to the repository root. Use `--` before a path beginning with `-`. `init` writes configuration for the current repository; scanning never writes repository files.

## JSON output

`commitveil scan --json` prints one JSON object to stdout:

```json
{
  "schemaVersion": 1,
  "redacted": true,
  "scannedCommits": 1,
  "scannedTags": 0,
  "findings": [
    {
      "ruleId": "CV001",
      "source": "author",
      "field": "email",
      "value": "p***@example.invalid",
      "commit": "0123456789abcdef0123456789abcdef01234567"
    }
  ]
}
```

JSON and terminal output both redact email local parts while keeping domains; names remain visible. Credential-bearing URLs are always replaced entirely, including with `--reveal`. Remote labels are generic to avoid disclosing credentials embedded in a label. Redaction also covers email-shaped text in name fields. `--reveal` shows full identity values only; avoid it in public logs. Terminal control characters and bidirectional formatting controls are displayed as literal escape text even with `--reveal`. Redaction reduces disclosure but is not anonymization.

Findings are sorted deterministically for an unchanged repository and policy. Errors with `--json` produce a JSON error object on stderr, no success object on stdout, and exit code 2. [Output contract](docs/output.md) describes fields.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Scan succeeded with no blocking findings |
| 1 | Review findings detected |
| 2 | Invalid configuration/repository, Git failure, invalid invocation, or internal error |

## CI usage

Install the CLI from a reviewed local package, fetch full history, and run:

```sh
commitveil scan --json
```

Use `actions/checkout` with `fetch-depth: 0` so locally available branches and tags are included. The scan never fetches missing refs itself. Keep the allowlist under review: a policy committed by an untrusted contributor can approve their own identity. This project's [CI workflow](.github/workflows/ci.yml) runs lint, typecheck, tests, and build across all three operating systems.

## Limitations

Only locally reachable commit and annotated-tag identities, recognized identity lines, literal repository-local identity settings (including enabled worktree settings), and credential-like HTTP/HTTPS remotes are inspected. Unreachable objects, reflogs, arbitrary prose, file contents, SSH credentials, unknown query credential names, fragment/path tokens, submodules, and other repositories are outside scope. A clean result is relative to your policy and locally available refs. Shallow repositories and legacy graft files are refused with exit 2 because they can hide parent history; the scanner never fetches missing history.

Global/system Git configuration, included/conditional configuration, mailmap substitutions, and replacement objects are deliberately ignored. Scans evaluate raw recorded identities without Unicode normalization. Allowlist approval is your decision, including whether a GitHub noreply address is acceptable. Metadata must be UTF-8; malformed or undecodable required metadata fails closed. Histories are buffered, with a 100,000 commit/tag-object limit, a combined 128 MiB raw metadata limit, and a 128 MiB output cap/60-second timeout per Git command. Exceeding a limit exits 2 with no partial success report. Keep refs and configuration unchanged while scanning; collection is not atomic.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks. Use synthetic identities in tests.

## Security

Scans stay local and do not upload repository contents. Read [SECURITY.md](SECURITY.md) before reporting an issue; omit personal data and credentials from public reports.

## License

[MIT](LICENSE), copyright NSMTEY.
