Status: ALREADY FIXED (and already tested on HEAD)

Root cause (as audited): `getAntigravityAccessToken` read the token file,
refreshed it over the network, then wrote the same object back with
`writeTokenFile` without re-reading the file first. If the file was deleted
while the refresh request was in flight, the blind write recreated it,
silently undoing a sign-out.

What fixed it: `performDirectRefresh` in src/helpers/antigravityAuth.js now
re-reads the token file immediately before writing
(`const latest = readTokenFileUncached();`) and refuses to persist if it is
gone or has no `token` field:

    if (!latest || !latest.token) {
      invalidateTokenFileCache();
      return { ok: false, reason: "token_file_missing" };
    }

It also refuses to clobber a token that changed underneath it (e.g. a
concurrent re-auth rotating the refresh token) rather than blindly merging.
This covers the only write path this module has to the token file
(`writeTokenFileAtomic`, used solely inside `performDirectRefresh`).

Other paths checked per the brief:
  - agy CLI fallback (`spawnAgyModelsRefresh` / `refreshViaAgy`): this module
    never writes the file itself here — it shells out to `agy models`, which
    is agy's own process and the file's actual owner/writer. This module only
    re-reads afterward (`invalidateTokenFileCache(); data = readTokenFile();`)
    and never re-creates anything if agy itself declines to write.
  - In-memory cache (`cachedTokenData`/`cachedMtimeMs`): `readTokenFile()`
    stats the file first; on ENOENT it clears the cache and returns null, so a
    deleted file is never served from a stale cache as if it still existed.
  - Persisted client-id fingerprint cache (`antigravity-oauth-client.json`,
    userData dir): unrelated to the OAuth token file; never recreates it.

Files changed: none (already fixed on HEAD, commit b9ac5337 "Close the gaps an
independent review found in the Antigravity transport"). No new test needed —
test/helpers/antigravityAuth.test.js already has the exact regression test:
"a direct refresh never recreates the token file if it was deleted mid-refresh"
(deletes the file inside the mocked fetch call, i.e. mid-flight, then asserts
`getAntigravityAccessToken` rejects with AGY_AUTH_REQUIRED and the file still
does not exist). A related test right after it, "a direct refresh refuses to
persist when the refresh token changed underneath it", covers the
concurrent-rotation variant of the same re-read-before-write race.

Test command: `node --test test/helpers/antigravityAuth.test.js`
(20 tests, all pass — see after.txt)

Commit that fixed it: b9ac5337 (already on HEAD 47356a06, no new fix commit
needed for this finding).
