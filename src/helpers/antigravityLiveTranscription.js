const { pcm16ToWav } = require("../utils/audioUtils");
const { getAntigravityAccessToken } = require("./antigravityAuth");
const { transcribeAudioViaGateway } = require("./antigravityGateway");

const SAMPLE_RATE = 16000;
const MIN_CHUNK_BYTES = SAMPLE_RATE * 2 * 2; // ~2s mono PCM16

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transcribePcmBuffer({ pcmBuffer, language, keyterms, mode, fetchImpl }) {
  const wav = pcm16ToWav(pcmBuffer);
  const accessToken = await getAntigravityAccessToken({ fetchImpl });
  const { text } = await transcribeAudioViaGateway({
    accessToken,
    audioBase64: wav.toString("base64"),
    mimeType: "audio/wav",
    language,
    keyterms,
    mode,
    fetchImpl,
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
}) {
  let pcmChunks = [];
  let pcmBytes = 0;
  let bytesSinceLastTranscribe = 0;
  let latestText = "";
  let inFlight = null;
  let aborted = false;
  let debounceTimer = null;

  const totalPcm = () => Buffer.concat(pcmChunks);

  const runTranscribe = async ({ final = false } = {}) => {
    if (aborted) return null;
    if (inFlight) {
      if (!final) return inFlight;
      await inFlight.catch(() => {});
    }
    const pcm = totalPcm();
    if (!pcm.length) return { text: latestText, truncated: !latestText };

    const task = (async () => {
      try {
        const text = await transcribeFn({
          pcmBuffer: pcm,
          language,
          keyterms,
          mode,
          fetchImpl,
        });
        if (aborted) return null;
        latestText = text.trim();
        if (latestText && onUpdate) {
          onUpdate(latestText);
        }
        bytesSinceLastTranscribe = 0;
        return { text: latestText, truncated: false };
      } catch (error) {
        if (!aborted && onError) {
          onError(error);
        }
        throw error;
      } finally {
        inFlight = null;
      }
    })();

    inFlight = task;
    return task;
  };

  const scheduleTranscribe = () => {
    if (aborted || debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!aborted && bytesSinceLastTranscribe >= minChunkBytes) {
        runTranscribe().catch(() => {});
      }
    }, 250);
  };

  return {
    sendPcm16(pcm) {
      if (aborted) return;
      const chunk = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
      if (!chunk.length) return;
      pcmChunks.push(chunk);
      pcmBytes += chunk.length;
      bytesSinceLastTranscribe += chunk.length;
      scheduleTranscribe();
    },
    sendFloat32() {
      // ponytail: dictation worklet emits PCM16; float32 unused for Antigravity live.
    },
    async finish() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (aborted) {
        return { text: latestText, truncated: true };
      }
      const result = await runTranscribe({ final: true }).catch(() => null);
      return result || { text: latestText, truncated: !latestText };
    },
    abort() {
      aborted = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pcmChunks = [];
      pcmBytes = 0;
    },
  };
}

module.exports = {
  MIN_CHUNK_BYTES,
  createAntigravityLiveStream,
  transcribePcmBuffer,
};
