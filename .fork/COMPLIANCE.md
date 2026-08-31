# Compliance checklist (MoreOpenWhispr)

Use this before tagging a GitHub Release. Not legal advice.

## OpenWhispr source (MIT)

Upstream [LICENSE](../LICENSE) allows fork, modify, and distribute binaries if you **include the copyright notice and MIT license** in distributions.

This fork ships the repo `LICENSE` file and states unofficial-fork status in [README.md](../README.md).

Do **not** imply official OpenWhispr, Gizmo Labs, or Google endorsement. App name is **MoreOpenWhispr** with bundle id `com.moreopenwhispr.app` (side-by-side with official OpenWhispr).

## Antigravity / Google

STT and LLM traffic uses the end user's **`agy auth login`** session and Google Cloud Code endpoints. That is separate from OpenWhispr's MIT license.

- Users must bring their own Antigravity subscription and accept Google's terms.
- Do not market this as "free unlimited Google transcription" or a Google product.
- Public redistribution is a gray area under Google's ToS. Treat wide distribution as: you ship client software, the user runs their own subscription.

## Bundled native binaries

The build bundles third-party runtimes (whisper.cpp, sherpa-onnx, ffmpeg, qdrant, etc.). Each upstream has its own license (mostly permissive OSS). For a formal release, collect notices into one file. electron-builder may already include some attributions in the packaged app.

## Account / cloud features removed in UI

OpenWhispr Cloud sign-in, billing, and workspace UI are hidden (`src/config/mowProfile.ts`). IPC and backend code may still exist upstream-side. The fork does not sell or operate OpenWhispr Cloud.

## Release checklist

- [ ] `mowProfile.ts` repo URLs point at `SuperTost100/openwhispr`
- [ ] README says unofficial fork
- [ ] `LICENSE` included in the repo and linked from README
- [ ] `electron-builder.json` `publish.owner` is `SuperTost100` (not `OpenWhispr`)
- [ ] Builds are unsigned; macOS/Windows first-launch warnings are documented
- [ ] Test `agy auth login` on a clean machine with the artifact you actually ship
- [ ] Gatekeeper: right-click → Open. SmartScreen: More info → Run anyway
