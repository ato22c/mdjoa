import type { Lang } from "./i18n";
import { translate } from "./i18n";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, MONTH = 30 * DAY, YEAR = 365 * DAY;

// Relative display of the modified time. Under 1 minute shows "방금 전 / just now";
// otherwise Intl.RelativeTimeFormat handles English plurals automatically. ko only
// needs suffixes, but goes through the same API for consistency.
// Pure function (takes lang as an argument) — uses translate(lang, ...) so it does
// not depend on store state (t() uses the store's current language, which could
// disagree with the lang argument).
export function relativeTime(diffMs: number, lang: Lang): string {
  if (diffMs < MIN) return translate(lang, "time.justNow");
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
  const [unit, div]: [Intl.RelativeTimeFormatUnit, number] =
    diffMs < HOUR ? ["minute", MIN] :
    diffMs < DAY ? ["hour", HOUR] :
    diffMs < MONTH ? ["day", DAY] :
    diffMs < YEAR ? ["month", MONTH] : ["year", YEAR];
  return rtf.format(-Math.floor(diffMs / div), unit);
}
