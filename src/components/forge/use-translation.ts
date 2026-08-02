"use client";

import { useMemo, useState, useEffect } from "react";
import {
  translate,
  getClientLocale,
  isRTL,
  type Locale,
} from "@/lib/forge/i18n";

/**
 * React hook for translating UI strings.
 *
 *   const t = useTranslation();
 *   <h1>{t("projects.title")}</h1>
 *   <p>{t("projects.count", { count: 3 })}</p>
 *
 * The locale is detected once from navigator.language and cached.
 * Components that use this hook automatically render in Hebrew when
 * the browser is set to Hebrew, English otherwise.
 *
 * HYDRATION SAFETY: The initial render always uses 'en' (matching SSR).
 * The locale is updated in a useEffect after hydration, which triggers
 * a re-render with the correct locale. This prevents hydration mismatches
 * where the server renders English but the client renders Hebrew.
 */
export function useTranslation(): {
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
  rtl: boolean;
} {
  // Start with 'en' to match SSR. Update after mount.
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const detected = getClientLocale();
    // Use requestAnimationFrame to defer the state update out of the
    // effect body, avoiding the "setState synchronously within effect"
    // lint error and preventing cascading renders.
    if (detected !== "en") {
      const raf = requestAnimationFrame(() => setLocale(detected));
      return () => cancelAnimationFrame(raf);
    }
  }, []);

  const rtl = isRTL(locale);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars);
  }, [locale]);

  return { t, locale, rtl };
}
