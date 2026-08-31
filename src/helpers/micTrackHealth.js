const TRACK_READY_TIMEOUT_MS = 600;

// True when the capture track is still open. Ended tracks need re-acquire; live tracks
// are accepted even when muted — Electron/macOS often keeps muted=true on inputs that
// still capture audio. Silence is discarded by the post-recording speech gate instead.
export const waitForTrackReady = (track, _timeoutMs = TRACK_READY_TIMEOUT_MS) =>
  Promise.resolve(!!track && track.readyState !== "ended");

// Re-acquires the mic once if the first track never delivers audio (dead/muted after idle).
// getFreshConstraints must drop any pinned device id so the retry re-resolves the device.
// Returns a live stream — the original when it was healthy or the retry failed.
// Optional fallback = { getConstraints, onDeviceRejected, onFallbackUnusable } adds a second
// hop to the system default when the retry reopens the same device and it is still silent.
export const reacquireIfDead = async (stream, getFreshConstraints, logger, fallback = null) => {
  const track = stream.getAudioTracks()[0];
  if (!track || (await waitForTrackReady(track, TRACK_READY_TIMEOUT_MS))) {
    return stream;
  }

  // The stream we still own and must stop if a later hop replaces it.
  let current = stream;
  let retryStream = null;
  try {
    retryStream = await navigator.mediaDevices.getUserMedia(await getFreshConstraints());
    stream.getTracks().forEach((t) => t.stop());
    logger.info("Re-acquired microphone after dead/muted track", {}, "audio");
    current = retryStream;
  } catch (error) {
    logger.warn(
      fallback
        ? "Microphone re-acquire failed, trying the default mic"
        : "Microphone re-acquire failed, using original stream",
      { error: error.message },
      "audio"
    );
    // A retry that cannot even open the device counts as proof it is unusable.
    if (!fallback) return stream;
  }

  if (!fallback) return retryStream;

  // The retry usually resolves back to the same device; a healthy track means it just woke up.
  if (retryStream) {
    const retryTrack = retryStream.getAudioTracks()[0];
    if (retryTrack && (await waitForTrackReady(retryTrack, TRACK_READY_TIMEOUT_MS))) {
      return retryStream;
    }
  }

  fallback.onDeviceRejected();

  let fallbackStream;
  try {
    fallbackStream = await navigator.mediaDevices.getUserMedia(await fallback.getConstraints());
  } catch (error) {
    logger.warn("Microphone fallback failed, no usable input", { error: error.message }, "audio");
    fallback.onFallbackUnusable();
    return current;
  }

  current.getTracks().forEach((t) => t.stop());
  logger.info("Fell back to the default microphone after a silent device", {}, "audio");

  const fallbackTrack = fallbackStream.getAudioTracks()[0];
  if (!fallbackTrack || !(await waitForTrackReady(fallbackTrack, TRACK_READY_TIMEOUT_MS))) {
    fallback.onFallbackUnusable();
  }
  return fallbackStream;
};
