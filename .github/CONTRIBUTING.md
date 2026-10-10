# Contributing to MoreOpenWhisperer

Unofficial fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr). `main` is the shipping branch.

Upstream's contributing guide still applies for how the Electron app is structured: [docs.openwhispr.com/contributing](https://docs.openwhispr.com/contributing). File MoreOpenWhisperer PRs here, not there, unless the fix belongs upstream.

## Filing issues

- Bugs and feature requests: [SuperTost100/moreopenwhisperer/issues](https://github.com/SuperTost100/moreopenwhisperer/issues)
- Use the issue templates (`bug_report`, `feature_request`)
- Transcription or audio problems: attach debug logs. [DEBUG.md](../DEBUG.md) and [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)

Do not send Antigravity OAuth tokens, API keys, or `.env` contents.

## Reporting security issues

**Do not open a public issue.** Follow [SECURITY.md](../SECURITY.md). Use [private vulnerability reporting](https://github.com/SuperTost100/moreopenwhisperer/security/advisories/new).

## Contributing code

1. Branch off `main`.
2. Keep the diff focused.
3. `nvm use` (Node 24), then `npm ci`, `npm run lint`, `npm test`.
4. Open a pull request against `main` on `SuperTost100/moreopenwhisperer`.

### Local setup

| Requirement | Notes |
| --- | --- |
| Node.js | Pinned in [`.nvmrc`](../.nvmrc) (24) |
| Install | `npm ci` |
| Run | `npm run dev` |
| Lint / format | `npm run lint` / `npm run format` |
| Tests | `npm test` |
| Build | [docs/building.md](../docs/building.md) (`build:mac` / `build:win` / `build:linux`) |

Platform install: [docs/macos.md](../docs/macos.md), [docs/windows.md](../docs/windows.md), [docs/linux.md](../docs/linux.md). Local Whisper: [LOCAL_WHISPER_SETUP.md](../LOCAL_WHISPER_SETUP.md). Antigravity: [docs/antigravity.md](../docs/antigravity.md).

Changes to account, billing, or OpenWhispr Cloud should go upstream. This fork keeps those surfaces disabled.

The Expo mobile application is maintained separately in
[`openwhispr-mobile`](../openwhispr-mobile/) with its own dependencies, lockfile, and
development commands. Follow its
[`CONTRIBUTING.md`](../openwhispr-mobile/CONTRIBUTING.md) when changing mobile code.

### CI scope and required checks

PR checks follow the files changed:

| Changed files                                                                          | Application checks |
| -------------------------------------------------------------------------------------- | ------------------ |
| `openwhispr-mobile/**` or the mobile CI workflow                                       | Mobile only        |
| Desktop files at the repository root, including its dependencies and workflows         | Desktop only       |
| Files from both applications                                                           | Both               |
| Shared CI routing, CodeQL configuration, Dependabot configuration, or `.gitattributes` | Both               |

Small routing and status jobs run on every PR. They let required checks finish
successfully when an application is unaffected, without installing or building it.
CodeQL analyzes only the affected application; its weekly scan covers both.
Desktop documentation changes run quality checks but do not trigger packaging.

Mobile validation uses Node 24 and its own lockfile. It checks dependency sources,
integrity, and high/critical advisories before installation, then runs formatting, lint, types, Expo Doctor,
tests, and an iOS JavaScript bundle. Android build validation is deferred until
Android becomes an active release target. Native compilation, signing, EAS builds,
and App Store submissions remain separate release checks. Fork PR jobs receive no
Expo or Apple credentials and cannot deploy.

Repository maintainers should require **Desktop CI**, **Mobile CI**, **CodeQL CI**,
and **lockfile-lint** in the GitHub ruleset, replacing individual build/matrix checks.
Also require GitHub's **CodeQL** code-scanning results check (or a CodeQL code-scanning
merge-protection rule). **CodeQL CI** only confirms that the selected scans completed;
it does not enforce alert severity. Retain the security-results check to block new
high/critical findings. The lockfile job is skipped successfully for mobile
changes, whose lockfile is covered by Mobile CI. Require review before merging,
including explicit review of workflow and dependency changes, and enable approval
for workflows from outside contributors. Ruleset settings are managed on GitHub;
adding these workflow files does not configure them automatically.

## Keeping up with upstream

`main` is OpenWhispr's history plus the fork's commits, so upstream changes come in as an ordinary merge:

```bash
scripts/sync-upstream.sh
```

The script adds an `upstream` remote that skips tags, fetches OpenWhispr's `main`, and merges it on a new `sync/upstream-<date>` branch. Resolve any conflicts, run the checks, then open a PR against `main`.

- **Merge sync PRs with a merge commit, never squash or rebase.** The merge commit is what records OpenWhispr's `main` as an ancestor. Squashed, the next sync would re-conflict on everything already brought in.
- Tags are skipped because the fork's release tags (`v1.10.2`) reuse upstream's version numbers for different commits.
- A weekly [upstream-behind](workflows/upstream-behind.yml) run fails when `main` is behind OpenWhispr, so GitHub emails a reminder. GitHub's built-in token can't push upstream commits that change workflow files, so the job only reports.
- Fork-only code is listed in [.fork/ANTIGRAVITY.md](../.fork/ANTIGRAVITY.md#owned-files-safe-to-keep-on-rebase). Upstream tests for account-only features are skipped in fork builds with a reason, not deleted, which keeps merges clean.

## Thanks

Issues, logs, and small diffs are useful.
