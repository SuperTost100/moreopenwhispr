import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { selectPolicyEffectiveSettings, useSettingsStore } from "../../stores/settingsStore";
import { usePolicySnapshot } from "../../hooks/usePolicy";
import {
  buildConfiguredProcessingRouteViewModel,
  type ProcessingRouteBoundary,
  type ProcessingRouteStageViewModel,
} from "./configuredProcessingRouteModel";

const BOUNDARY_CLASS: Record<ProcessingRouteBoundary, string> = {
  onDevice: "cp-processing-route__stage--on-device",
  audioLeavesDevice: "cp-processing-route__stage--audio-leaves-device",
  apiKey: "cp-processing-route__stage--api-key",
  customRoute: "cp-processing-route__stage--custom-route",
  providerRequest: "cp-processing-route__stage--provider-request",
};

function RouteStage({
  stage,
  stageTitle,
  boundaryLabel,
  detail,
}: {
  stage: ProcessingRouteStageViewModel;
  stageTitle: string;
  boundaryLabel: string;
  detail: string;
}) {
  return (
    <div
      className={`cp-processing-route__stage ${BOUNDARY_CLASS[stage.boundary]}${
        stage.skipped ? " cp-processing-route__stage--skipped" : ""
      }`}
    >
      <span className="cp-processing-route__boundary">{boundaryLabel}</span>
      <strong className="cp-processing-route__stage-title">{stageTitle}</strong>
      <small className="cp-processing-route__detail">{detail}</small>
    </div>
  );
}

export default function ConfiguredProcessingRoute() {
  const { t } = useTranslation();
  const policyState = usePolicySnapshot();
  const effectiveSettings = useSettingsStore(
    useShallow((settings) => selectPolicyEffectiveSettings(settings, policyState))
  );
  const viewModel = useMemo(
    () =>
      buildConfiguredProcessingRouteViewModel({
        settings: effectiveSettings,
        policy: policyState,
      }),
    [effectiveSettings, policyState]
  );

  const stageAriaLabel = t("controlPanel.processingRoute.ariaLabel");

  return (
    <section className="cp-processing-route" aria-labelledby="cp-processing-route-title">
      <div className="cp-processing-route__head">
        <div>
          <h2 id="cp-processing-route-title" className="cp-processing-route__title">
            {t("controlPanel.processingRoute.title")}
          </h2>
          <p className="cp-processing-route__subtitle">
            {viewModel.policyManaged
              ? t("controlPanel.processingRoute.subtitlePolicy")
              : t("controlPanel.processingRoute.subtitle")}
          </p>
        </div>
      </div>
      <div className="cp-processing-route__stages" role="group" aria-label={stageAriaLabel}>
        {viewModel.stages.map((stage) => (
          <RouteStage
            key={stage.id}
            stage={stage}
            stageTitle={t(`controlPanel.processingRoute.stages.${stage.id}`)}
            boundaryLabel={t(`controlPanel.processingRoute.boundaries.${stage.boundary}`)}
            detail={t(stage.detailKey, stage.detailParams)}
          />
        ))}
      </div>
    </section>
  );
}
