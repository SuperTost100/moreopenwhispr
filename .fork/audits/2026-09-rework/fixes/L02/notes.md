# L02 stale duplicate docs

Status: FIXED NOW (no code change, file cleanup).

Root cause: iCloud Drive sync conflicts created untracked "name 2.ext" copies in the main checkout. Each was an older version of a tracked file (old MoreOpenWhispr name, old release URL, a test without the hang guard, package.json without --test-timeout). None had content missing from the tracked originals.

Fix: moved all 8 copies to ~/.Trash/openwhispr-stale-copies-2026-09-26 (restorable). The sync worktree never had them.

Proof: before.txt lists the 8 files and their diff size against the tracked originals; after.txt shows git status clean apart from rework-audit/ and zero "* 2.*" files in either tree.

Prevention: the repo lives in an iCloud-synced ~/Documents. Moving it out stops new copies.
