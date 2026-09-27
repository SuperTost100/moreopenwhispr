# Stale duplicate docs still name MoreOpenWhispr.app

Importance: Low importance

The working tree has untracked copies with ` 2` before the extension. They still describe the shipping app as MoreOpenWhispr, including install paths such as `MoreOpenWhispr.app`. The app name in `electron-builder.json` and `src/config/mowProfile.ts` is MoreOpenWhisperer. The tracked docs under `docs/` were updated. These copies were not.

They are not imported by the build. They show up if someone opens the extra file by mistake.

Files:

- `docs/antigravity 2.md`
- `docs/building 2.md`
- `docs/linux 2.md`
- `docs/macos 2.md`
- `docs/windows 2.md`
- `package 2.json`
- `scripts/refresh-antigravity-token 2.js`
- `test/helpers/urlAudioDownloader.test 2.js`

`docs/macos 2.md` says to drag MoreOpenWhispr into Applications and to delete `/Applications/MoreOpenWhispr.app`.
