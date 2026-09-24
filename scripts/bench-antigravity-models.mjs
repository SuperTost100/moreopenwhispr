#!/usr/bin/env node
/**
 * Benchmark Antigravity gateway STT models (audio-capable catalog entries).
 * Reads the token file and project id locally; never prints secrets.
 *
 * Usage:
 *   node scripts/bench-antigravity-models.mjs [--runs 2] [--clip path.wav]
 */
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function parseArgs(argv) {
  let runs = 2;
  let clip = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runs" && argv[i + 1]) runs = Number(argv[++i]);
    if (argv[i] === "--clip" && argv[i + 1]) clip = argv[++i];
  }
  return { runs: Number.isFinite(runs) && runs > 0 ? runs : 2, clip };
}

function ensureClip(clipPath) {
  if (clipPath && fs.existsSync(clipPath)) return clipPath;
  const out = path.join(os.tmpdir(), "openwhispr-antigravity-bench.wav");
  if (fs.existsSync(out)) return out;
  const text = "OpenWhispr Antigravity model benchmark clip.";
  const say = spawnSync("say", ["-o", out.replace(/\.wav$/, ".aiff"), text], { encoding: "utf8" });
  if (say.status !== 0) {
    throw new Error("Could not generate clip with macOS say; pass --clip path.wav");
  }
  const ffmpeg = spawnSync(
    "ffmpeg",
    ["-y", "-i", out.replace(/\.wav$/, ".aiff"), "-ar", "16000", "-ac", "1", out],
    { encoding: "utf8" }
  );
  if (ffmpeg.status !== 0) {
    throw new Error("ffmpeg required to convert benchmark clip to wav");
  }
  return out;
}

async function main() {
  const { runs, clip } = parseArgs(process.argv.slice(2));
  process.chdir(repoRoot);
  const wavPath = ensureClip(clip);
  const audioBuffer = fs.readFileSync(wavPath);

  const { getCatalog, listSelectableModels } = require("../src/helpers/antigravityModelCatalog");
  const {
    transcribeWithAntigravity,
    computeSttBudgetMs,
  } = require("../src/helpers/antigravityTranscription");
  const { createAntigravityOperation } = require("../src/helpers/antigravityOperation");

  const models = listSelectableModels(getCatalog()).filter((m) => m.supportsAudio);
  console.log(`Model benchmark (${runs} run(s) each, clip ${path.basename(wavPath)})`);
  console.log("model\tmedian_ms\tp95_ms");

  for (const model of models) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const started = Date.now();
      const op = createAntigravityOperation({
        budgetMs: computeSttBudgetMs({ audioDurationSec: 4 }),
        label: "bench",
      });
      try {
        await transcribeWithAntigravity({
          audioBuffer,
          contentType: "audio/wav",
          language: "en",
          antigravityPrefs: { stt: model.id },
          op,
        });
        samples.push(Date.now() - started);
      } catch (error) {
        samples.push(Date.now() - started);
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? median;
    console.log(`${model.id}\t${median}\t${p95}`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
