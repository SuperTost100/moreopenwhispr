# Compliance checklist (Antigravity fork)

Use this before tagging a GitHub Release. Not legal advice.

## OpenWhispr source (MIT)

Upstream [LICENSE](../LICENSE) allows fork, modify, and distribute binaries if you **include the copyright notice and MIT license** in distributions.

This fork does that by shipping the repo `LICENSE` file and stating fork status in [README.md](../README.md).

Do **not** imply official OpenWhispr, Gizmo Labs, or Google endorsement. App name is **Whispr Antigravity** with bundle ID `com.openwhispr.antigravity.fork` (side-by-side with official OpenWhispr).

## Antigravity / Google

STT and LLM traffic uses the end user's **`agy auth login`** session and Google Cloud Code endpoints. That is separate from OpenWhispr's MIT license.

- Users must bring their own Antigravity subscription and accept Google's terms.
- Do not market this as "free unlimited Google transcription" or a Google product.
- Public redistribution is a gray area under Google's ToS; treat wide distribution as "user runs their own subscription, you ship client software only."

## Bundled native binaries

The build bundles third-party runtimes (whisper.cpp, sherpa-onnx, ffmpeg, qdrant, etc.). Each upstream has its own license (mostly permissive OSS). For a formal release, collect notices into one file; electron-builder may already include some attributions in the packaged app.

## Account / cloud features removed in UI

OpenWhispr Cloud sign-in, billing, and workspace UI are hidden in this fork (`src/config/forkProfile.ts`). IPC and backend code may still exist upstream-side; the fork does not sell or operate OpenWhispr Cloud.

## Release checklist

- [ ] `forkProfile.ts` repo URLs point at your fork
- [ ] README clearly says unofficial fork
- [ ] `LICENSE` included in release artifact or linked from README
- [ ] Test `agy auth login` on a clean machine with the `.dmg`
- [ ] Gatekeeper: document right-click → Open for unsigned builds
