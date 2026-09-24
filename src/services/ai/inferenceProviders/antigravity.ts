import type { InferenceProvider } from "./types";
import { wrapCleanupTranscript } from "../../../config/prompts";
import logger from "../../../utils/logger";
import { getSettings } from "../../../stores/settingsStore";

export const antigravityProvider: InferenceProvider = {
  id: "antigravity",
  supportsImages: true,
  async call({ text, model, agentName, config, ctx }) {
    if (typeof window === "undefined" || !window.electronAPI?.processAntigravityReasoning) {
      throw new Error("Antigravity reasoning is not available in this environment");
    }

    logger.logReasoning("ANTIGRAVITY_START", { model, agentName, environment: "browser" });
    const startTime = Date.now();

    const systemPrompt = config.systemPrompt || ctx.getSystemPrompt(agentName);
    const userContent = config.systemPrompt ? text : wrapCleanupTranscript(text);
    const settings = getSettings();
    const result = await window.electronAPI.processAntigravityReasoning(
      userContent,
      model,
      agentName,
      {
        ...config,
        systemPrompt,
        antigravityCleanupModel: settings.antigravityCleanupModel || "auto",
        requestId: config.requestId,
      }
    );

    const processingTimeMs = Date.now() - startTime;

    if (!result.success) {
      logger.logReasoning("ANTIGRAVITY_ERROR", {
        model,
        processingTimeMs,
        error: result.error,
      });
      throw new Error(result.error || "Antigravity reasoning failed");
    }

    logger.logReasoning("ANTIGRAVITY_SUCCESS", {
      model,
      processingTimeMs,
      resultLength: result.text?.length ?? 0,
    });
    return result.text || "";
  },
};
