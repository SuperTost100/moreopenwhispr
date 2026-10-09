const { pcm16ToWav } = require("../utils/audioUtils");
const { createAntigravityOperation } = require("./antigravityOperation");
const { getAntigravityAccessToken } = require("./antigravityAuth");
const { transcribeAudioViaGateway, getAntigravityProjectId } = require("./antigravityGateway");
const { getCatalog, resolveAntigravityModels } = require("./antigravityModelCatalog");

const SAMPLE_RATE = 16000;
const MIN_CHUNK_BYTES = SAMPLE_RATE * 2 * 2; // ~2s mono PCM16
const PREVIEW_STAGE_MS = 6_000;
const PREVIEW_BUDGET_MS = 8_000;

async function transcribePcmBuffer({
  pcmBuffer,
  language,
  keyterms,
  mode,
  fetchImpl,
  antigravityPrefs,
  op,
  stageMs,
}) {
  const wav = pcm16ToWav(pcmBuffer);
  const previewOp =
    op ||
    createAntigravityOperation({ budgetMs: PREVIEW_BUDGET_MS, label: "antigravity-live-preview" });
  const stageOp = stageMs
    ? {
        ...previewOp,
        signal: previewOp.stageSignal(stageMs),
        stageSignal: (max) => previewOp.stageSignal(Math.min(max, stageMs)),
      }
    : previewOp;

  const { accessToken, accountKey } = await getAntigravityAccessToken({ signal: stageOp.signal });
  const prefs = {
    stt:
      typeof antigravityPrefs?.stt === "string" && antigravityPrefs.stt.trim()
        ? antigravityPrefs.stt.trim()
        : "auto",
  };
  const { stt: backendModel } = resolveAntigravityModels(getCatalog(), prefs);
  const projectId = await getAntigravityProjectId({
    accessToken,
    accountKey,
    fetchImpl,
    op: stageOp,
  });
  const { text } = await transcribeAudioViaGateway({
    accessToken,
    accountKey,
    projectId,
    model: backendModel,
    audioBase64: wav.toString("base64"),
    mimeType: "audio/wav",
    language,
    keyterms,
    mode,
    fetchImpl,
    op: stageOp,
  });
  return text;
}

function createAntigravityLiveStream({
  language,
  keyterms,
  mode = "SMART",
  onUpdate,
  onError,
  fetchImpl = fetch,
  minChunkBytes = MIN_CHUNK_BYTES,
  transcribeFn = transcribePcmBuffer,
  antigravityPrefs,
  finishOp,
}) {
  let pcmChunks = [];
  let bytesSinceLastTranscribe = 0;
  let latestText = "";
  let previewInFlight = null;
  let previewAbort = null;
  let finishInFlight = null;
  let finishAbort = null;
  let aborted = false;
  let debounceTimer = null;

  const totalPcm = () => Buffer.concat(pcmChunks);

  const cancelPreview = () => {
    if (previewAbort) {
      previewAbort.abort();
      previewAbort = null;
    }
    previewInFlight = null;
  };

  const runPreview = async () => {
    if (aborted) return null;
    if (previewInFlight) return previewInFlight;
    const pcm = totalPcm();
    if (!pcm.length) return null;

    const controller = new AbortController();
    previewAbort = controller;
    const task = (async () => {
      try {
        const text = await transcribeFn({
          pcmBuffer: pcm,
          language,
          keyterms,
          mode,
          fetchImpl,
          antigravityPrefs,
          stageMs: PREVIEW_STAGE_MS,
          op: createAntigravityOperation({
            budgetMs: PREVIEW_BUDGET_MS,
            signal: controller.signal,
            label: "antigravity-live-preview",
          }),
        });
        if (aborted || controller.signal.aborted) return null;
        latestText = String(text || "").trim();
        if (latestText && onUpdate) onUpdate(latestText);
        bytesSinceLastTranscribe = 0;
        return latestText;
      } catch (error) {
        if (!aborted && !controller.signal.aborted && onError) onError(error);
        return null;
      } finally {
        if (previewAbort === controller) previewAbort = null;
        previewInFlight = null;
      }
    })();
    previewInFlight = task;
    return task;
  };

  const schedulePreview = () => {
    if (aborted || debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!aborted && bytesSinceLastTranscribe >= minChunkBytes) {
        runPreview().catch(() => {});
      }
    }, 250);
  };

  return {
    sendPcm16(pcm) {
      if (aborted) return;
      const chunk = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
      if (!chunk.length) return;
      pcmChunks.push(chunk);
      bytesSinceLastTranscribe += chunk.length;
      schedulePreview();
    },
    sendFloat32() {
      // ponytail: dictation worklet emits PCM16; float32 unused for Antigravity live.
    },
    async finish() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      cancelPreview();
      if (previewInFlight) {
        await previewInFlight.catch(() => {});
      }
      if (aborted) {
        return { text: latestText, final: false };
      }
      if (finishInFlight) return finishInFlight;

      const pcm = totalPcm();
      if (!pcm.length) {
        return { text: latestText, final: false };
      }

      // abort() during the final pass stops the request instead of letting
      // it run out its budget for a result nobody will use.
      const controller = new AbortController();
      finishAbort = controller;
      finishInFlight = (async () => {
        try {
          const text = await transcribeFn({
            pcmBuffer: pcm,
            language,
            keyterms,
            mode,
            fetchImpl,
            antigravityPrefs,
            op:
              finishOp ||
              createAntigravityOperation({
                budgetMs: 60_000,
                signal: controller.signal,
                label: "antigravity-live-final",
              }),
          });
          if (aborted) return { text: latestText, final: false };
          const trimmed = String(text || "").trim();
          if (trimmed) {
            latestText = trimmed;
            return { text: trimmed, final: true };
          }
          return { text: latestText, final: false };
        } catch {
          return { text: latestText, final: false };
        } finally {
          finishInFlight = null;
          if (finishAbort === controller) finishAbort = null;
        }
      })();
      return finishInFlight;
    },
    abort() {
      aborted = true;
      cancelPreview();
      if (finishAbort) {
        finishAbort.abort();
        finishAbort = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pcmChunks = [];
      bytesSinceLastTranscribe = 0;
    },
  };
}

module.exports = {
  MIN_CHUNK_BYTES,
  PREVIEW_STAGE_MS,
  createAntigravityLiveStream,
  transcribePcmBuffer,
};
