# Security

CommitVeil scans are local. There is no telemetry, no network call during a scan, and repository contents are not uploaded. The runtime uses only Node.js built-ins and the installed Git executable. Dependency installation is a separate network operation.

Scanning is read-only and never runs repository scripts, hooks, filters, or external diff tools. Git commands use argument arrays without a shell. Global/system Git configuration, config includes and Git replacement objects are ignored. Lazy fetching and transport protocols are disabled, including for partial clones; missing required objects fail safely. Git 2.45+ is required for the `--no-lazy-fetch` guard. Use a trusted, maintained Node.js and Git installation. `init` is the explicit exception to read-only behavior: it creates a policy file without overwriting an existing one.

Git is resolved to an absolute executable from PATH. Empty/relative PATH entries and candidates inside the current working or scanned directories are rejected, preventing implicit current-directory executable lookup on Windows. The remaining installation directories must be trusted; the scanner cannot defend against a compromised system Git binary.

CommitVeil does not guarantee anonymity. Redacted reports retain names, email domains, commit/tag hashes and source labels; they may still identify people. `--reveal` exposes full identity values but never detected remote credential values. Credential-bearing URLs are replaced completely and their remote labels are omitted. Carefully review reports before sharing them.

Shallow repositories, legacy graft files, unavailable required commit/tag objects, malformed required metadata, unknown/unsupported Git versions and exceeded resource limits fail with exit 2 rather than producing a partial PASS. An empty repository with no configured identities can pass; any unapproved local identity is still reviewed. A passing result covers available refs and the configured identity policy, not unreachable history or every possible credential syntax. Do not modify refs or configuration during a scan.

Commit and annotated-tag object checksums are verified before identity evaluation. Unrelated blob/tree contents and full repository integrity are outside this identity audit.

Security reports must not include real credentials or personal data in public issues. For a vulnerability, use the repository's GitHub private vulnerability reporting feature if enabled. If it is unavailable, ask for a private reporting channel without publishing exploit details or sensitive data. Do not invent or use an unverified contact address.

Version 0.1.x is the initial supported line. The repository maintainer should enable private vulnerability reporting before the public release.
