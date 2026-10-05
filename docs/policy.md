# Publication policy

The root `.commitveil.json` contains only `allowedNames` and `allowedEmails`, each an optional array of nonempty strings. A present file replaces defaults; omitted arrays become empty. Unknown keys fail rather than silently weakening policy. JSON comments and trailing commas are invalid.

Each pattern matches a complete field. `*` is the only wildcard and can match any number of characters. Regex syntax is literal. Names match case-sensitively; emails match case-insensitively. No whitespace trimming or Unicode normalization is applied to recorded commit fields. Trailer display names are trimmed around the `<email>` form.

Empty or omitted name lists approve no names. Every author, committer, trailer, tagger and configured local name must match an explicit allowlist pattern. No real-name heuristic is used: any unapproved name needs review, without claiming it is necessarily private. Email policy always applies; an empty list means every recorded email needs review. Missing local identity settings do not create findings. Every duplicate local setting is checked, not just the effective last value. Enabled worktree-specific settings are checked alongside common repository-local settings.

Default and initialized policy allow `*@users.noreply.github.com` and approve no names. For example, `Real Person <123+alias@users.noreply.github.com>` creates a name review finding even though its email matches the default. An explicit `allowedNames: ["Real Person"]` approves that name if you intend to make it public. Noreply approval is not an anonymity claim: these addresses can identify an account. Use exact email entries for collaborators rather than allowing an entire public email provider.

The seven recognized trailer labels are case-insensitive and checked on any line of the message, not only the final trailer block. This conservatively catches quoted identity lines too. Malformed recognized lines are treated as identity review values and cannot silently bypass email policy.

The scanner reports identities outside policy as review findings. It does not decide whether a person intended to disclose their address. Approving a value only changes policy evaluation; removing an exposure requires separate, carefully reviewed Git history work.

## Remote query policy

HTTP/HTTPS URLs are reviewed for embedded user information or these query keys: `token`, `access_token`, `auth`, `authorization`, `apikey`, `api_key`, `key`, `password`, `passwd`, `secret`, `client_secret`, `auth_token`, `private_token`, `personal_access_token`, `oauth_token`, and `x_api_key`. Keys are percent-decoded, compared case-insensitively, with hyphens treated as underscores and an optional `[]` suffix removed. Both `&` and literal `;` separate query fields. A recognized key triggers review even with an empty value. Other query keys do not automatically trigger a finding.

These keys indicate possible credentials, not proof that a particular value is secret. All detected URLs are suppressed in full even with `--reveal`; that flag reveals identity values only. Malformed HTTP/HTTPS URLs fail with exit 2 without printing the URL. This rule is confined to configured Git remotes and is not a generic secret scanner.
