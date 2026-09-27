# A refresh writes the Antigravity token file back after it is gone

Importance: Medium importance

`getAntigravityAccessToken` in `src/helpers/antigravityAuth.js` reads `~/.gemini/antigravity-cli/antigravity-oauth-token`, refreshes it, then writes that same object back with `writeTokenFile`. It does not read the file again after the network call. If the file is removed while the refresh is in flight, the write creates it again and the session is back.

## What the run showed

The token file was deleted inside the refresh request, before the new access token was returned. After `getAntigravityAccessToken` resolved, the file existed again and its access token was `new`.
