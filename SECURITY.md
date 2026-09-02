# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| MoreOpenWhisperer on `antigravity-fork` (currently 1.9.3) | yes |
| Official OpenWhispr releases | Report to [OpenWhispr/openwhispr](https://github.com/OpenWhispr/openwhispr/security/advisories/new) |

## Reporting a vulnerability

**Do not open a public issue.**

Use [GitHub's private vulnerability reporting](https://github.com/SuperTost100/moreopenwhispr/security/advisories/new) on this fork.

There is no `security@openwhispr.com` inbox for MoreOpenWhisperer. That address is upstream's.

Expect an acknowledgement when someone is actually looking at the report. There is no 48-hour SLA on a one-person fork.

## Scope

In scope:

- Remote code execution via crafted audio or transcription output
- Privilege escalation through native binaries (key listeners, paste helpers)
- Credential exposure (API keys, Antigravity OAuth tokens, calendar tokens)
- XSS in the Electron renderer
- Insecure IPC between main and renderer
- Supply chain attacks via dependencies or native compilation

Out of scope:

- Issues that need physical access to an unlocked machine
- Denial of service against the local app
- Social engineering
- "Antigravity ToS lets me do this" product questions
- Bugs that only exist in OpenWhispr Cloud (this fork does not run that service)

## Security model

- **Local-first audio.** Whisper and Parakeet stay on-device. Antigravity and BYOK send audio or text because you chose those providers.
- **Credential storage.** BYOK keys and enterprise cloud creds use Electron `safeStorage` (Keychain / DPAPI / libsecret) under `userData/secure-keys/`. Linux without a keyring falls back to plaintext. Antigravity tokens live in `~/.gemini/antigravity-cli/` as the `agy` CLI wrote them.
- **Native binaries.** Platform helpers are compiled or downloaded during build.
- **Context isolation.** Renderer is isolated; preload is a fixed IPC bridge.
- **No OpenWhispr Cloud.** Account, billing, and hosted MCP are disabled. Leftover IPC from upstream is not a supported API.

## Disclosure

Coordinated disclosure. Fixes land on `antigravity-fork`. Credit in the changelog if you want it.
