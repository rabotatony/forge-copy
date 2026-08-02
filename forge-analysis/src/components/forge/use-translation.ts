"use client";

import { useMemo } from "react";
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
 */
export function useTranslation(): {
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
  rtl: boolean;
} {
  const locale = getClientLocale();
  const rtl = isRTL(locale);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars);
  }, [locale]);

  return { t, locale, rtl };
}
