# Retired Gemini 3.5 Flash rows are still choices

Importance: Medium importance

Settings still lists three Antigravity cleanup models that the CLI mapping immediately replaces:

- `gemini-3.5-flash-low` is sent as `gemini-3.7-flash-low`
- `gemini-3.5-flash-medium` is sent as `gemini-3.7-flash-medium`
- `gemini-3.5-flash-high` is sent as `gemini-3.7-flash-high`

The rows live in `src/models/modelRegistryData.json` under the `antigravity` cloud provider. `resolveAgyCliModel` in `src/helpers/antigravityModels.ts` performs the replacement. The 3.7 rows are listed as well, so the 3.5 rows are a second set of labels for the same three models.

## What the run showed

Each listed 3.5 id was passed through `resolveAgyCliModel`. Each one came back as the matching 3.7 id.
