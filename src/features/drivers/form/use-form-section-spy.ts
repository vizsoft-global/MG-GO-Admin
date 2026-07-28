"use client";

import { useEffect, useState } from "react";
import type { DriverFormStepId } from "./driver-form-stepper";

const SECTION_IDS: DriverFormStepId[] = ["identity", "assignment", "documents"];

export function useFormSectionSpy({ enabled }: { enabled: boolean }) {
  const [activeStep, setActiveStep] = useState<DriverFormStepId>("identity");

  useEffect(() => {
    if (!enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const topVisible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!topVisible) return;
        const id = topVisible.target.getAttribute("data-driver-section-id");
        if (!id) return;
        if (SECTION_IDS.includes(id as DriverFormStepId)) {
          setActiveStep(id as DriverFormStepId);
        }
      },
      {
        threshold: [0.3, 0.5, 0.7],
        rootMargin: "-10% 0px -55% 0px",
      },
    );

    for (const id of SECTION_IDS) {
      const el = document.getElementById(`driver-section-${id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [enabled]);

  const scrollToStep = (step: DriverFormStepId) => {
    const target = document.getElementById(`driver-section-${step}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return { activeStep, scrollToStep };
}

