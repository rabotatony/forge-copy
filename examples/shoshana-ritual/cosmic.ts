// cosmic.ts - lunar and seasonal awareness for the ritual homepage.
// Makes the website feel ALIVE and connected to the cosmos.

/** Calculate the current lunar phase (0-1, where 0=new moon, 0.5=full moon). */
export function getLunarPhase(date: Date = new Date()): number {
  // Synodic month is ~29.53 days
  // Reference new moon: January 6, 2000
  const ref = new Date(2000, 0, 6, 18, 14).getTime();
  const days = (date.getTime() - ref) / (1000 * 60 * 60 * 24);
  return (days % 29.53) / 29.53;
}

/** Get the Hebrew name of the lunar phase. */
export function getLunarPhaseName(phase: number): string {
  if (phase < 0.0625) return "מולד";
  if (phase < 0.1875) return "סהר מתמלא";
  if (phase < 0.3125) return "רבע ראשון";
  if (phase < 0.4375) return "סהר מתמלא";
  if (phase < 0.5625) return "מלא";
  if (phase < 0.6875) return "סהר מתמעט";
  if (phase < 0.8125) return "רבע אחרון";
  return "סהר מתמעט";
}

/** Get the ritual theme for the lunar phase. */
export function getLunarTheme(phase: number): string {
  if (phase < 0.25) return "זמן לזרוע. מה אתה רוצה שיתחיל?";
  if (phase < 0.5) return "הדבר גדל. תן לו מקום.";
  if (phase < 0.75) return "השיא. מה אתה רואה עכשיו?";
  return "זמן לשחרר. מה כבר לא צריך?";
}

/** Get the current season. */
export function getSeason(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return "אביב";
  if (month >= 6 && month <= 8) return "קיץ";
  if (month >= 9 && month <= 11) return "סתיו";
  return "חורף";
}

/** Get the seasonal theme. */
export function getSeasonalTheme(season: string): string {
  const themes: Record<string, string> = {
    "אביב": "משהו חדש מתחיל. מה נולד?",
    "קיץ": "הכל פורח. מה אתה עושה עם השפע?",
    "סתיו": "זמן לאסוף. מה הבשיל?",
    "חורף": "זמן לנוח. מה מחכה מתחת לפני השטח?",
  };
  return themes[season] || themes["קיץ"];
}