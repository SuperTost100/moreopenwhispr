import { useState } from "react";
import { X } from "../../icons";
import { useTranslation } from "react-i18next";
import {
  CONTAINER_OVERVIEW_INTRO,
  markIntroSeen,
  shouldShowIntro,
} from "../../../lib/versionedIntro";

interface OverviewExplainerBannerProps {
  kind: "team" | "private";
}

export function OverviewExplainerBanner({ kind }: OverviewExplainerBannerProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() =>
    shouldShowIntro(localStorage, CONTAINER_OVERVIEW_INTRO)
  );

  if (!visible) return null;

  return (
    <div className="cp-notes__banner">
      <button
        onClick={() => {
          markIntroSeen(localStorage, CONTAINER_OVERVIEW_INTRO);
          setVisible(false);
        }}
        aria-label={t("notes.overview.banner.dismiss")}
        className="cp-notes__banner-dismiss focus:outline-none focus-visible:ring-1 focus-visible:ring-ring/30"
      >
        <X size={12} />
      </button>
      <p className="cp-notes__banner-title">{t(`notes.overview.banner.title.${kind}`)}</p>
      <p className="cp-notes__banner-description max-w-lg">
        {t(`notes.overview.banner.body.${kind}`)}
      </p>
    </div>
  );
}
