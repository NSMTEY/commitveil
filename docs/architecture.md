# Architecture

`git/collect.ts` locates the repository and collects reachable raw commit/tag objects and literal local Git configuration. `git/version.ts` validates the installed Git version before accessing the target repository. `policy/config.ts` validates JSON and matches allowlists. `rules/evaluate.ts` turns collected facts into findings and discards detected remote credential values. `reporters/report.ts` masks identities, always suppresses credential URLs, and sanitizes output. Commands coordinate those layers; `cli.ts` handles arguments and exit codes.

Git runs through `spawnSync` with an argument array, bounded output and a timeout. `rev-list --all` includes refs and HEAD, then sorted hashes are sent to `cat-file --batch`. Batch records use Git's byte lengths, so NULs, newlines or fake delimiters in messages cannot desynchronize records. No working-tree file content is evaluated. The only repository file read directly is the policy JSON.

Annotated tag roots are enumerated from all local refs and HEAD, then nested tag targets are followed by object ID. Lightweight tags do not add taggers. Missing/duplicate required identity headers, undecodable UTF-8 metadata and missing required objects fail closed. Enabled worktree configuration is collected separately. Shallow repositories and legacy info/grafts files are refused before history evaluation; grafts can truncate raw history even when replacement objects are disabled and graft warnings are suppressed.

Collected commit/tag bytes are checked against their SHA-1 or SHA-256 object IDs before evaluation. This detects identity objects that Git can read successfully despite a corrupted checksum; it does not run fsck or validate unrelated file/tree contents.

The package has no runtime dependencies. Scans never fetch, rewrite, invoke hooks, execute repository code, or upload anything. Test fixtures use temporary directories under the workspace. The integration suite exercises the compiled executable, not a separate test-only entry point.

`git/executable.ts` selects an absolute Git program from trusted absolute PATH entries, excluding the working/scanned directories and resolving symbolic links. Both startup and repository commands use this explicit path. This prevents Windows' default cwd-before-PATH search from executing a repository-local `git.exe`; no shell or `which`/`where` subprocess is used.

Git 2.45+ is required: every repository invocation uses `--no-lazy-fetch` and disables transports, preventing implicit downloads in partial clones. This keeps a simple, documented safeguard rather than relying only on protocols or undocumented behavior in older versions. Git warnings also fail closed rather than claiming complete coverage of potentially broken refs. Startup rejects old, prerelease or unrecognized Git versions with a clear exit-2 error. See [Git's documented option](https://git-scm.com/docs/git/2.45.0).

Collection remains buffered to keep the first release small. It is bounded by 100,000 unique commit/tag objects and 128 MiB of combined raw object metadata. Every repository Git command additionally caps stdout/stderr at 128 MiB and times out after 60 seconds; version detection uses 4 KiB and 10 seconds. Policy input is bounded to 1 MiB and decoded strictly as UTF-8. Decoded objects and findings add memory overhead beyond raw bytes. No limit failure produces a partial success report. A 500-commit integration fixture exercises traversal without invoking one Git process per commit.

Build output is generated, ignored by Git, and packaged through the package.json files allowlist. Prepack compiles the CLI even when dist is absent. There are no workspaces; pnpm's esbuild install-script permission lives in package.json.
