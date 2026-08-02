// ============================================================
// Forge — internationalization (i18n)
// ============================================================
// Lightweight translation system supporting Hebrew (he) and English (en).
// The UI detects the browser language and falls back to English.
//
// Usage in a client component:
//   const t = useTranslation();
//   <h1>{t('projects.title')}</h1>
//
// Usage in a server component / API route:
//   import { translate } from '@/lib/forge/i18n';
//   const msg = translate('he', 'projects.title');
// ============================================================

export type Locale = 'he' | 'en';

// ---------------------------------------------------------------------------
// Translation dictionaries
// ---------------------------------------------------------------------------

type Dict = Record<string, string>;

const en: Dict = {
  // App-level
  'app.name': 'Forge',
  'app.tagline': 'Sovereign CI',
  'app.description': 'Self-hosted CI for file uploads',

  // Header
  'header.home': 'Forge home',
  'header.docs': 'Docs',

  // Projects list
  'projects.title': 'Projects',
  'projects.subtitle': 'Drop a file to upload a new project. Forge will detect the kind and suggest workflows automatically.',
  'projects.count': '{count} projects',
  'projects.count_one': '{count} project',
  'projects.count_zero': 'No projects yet',
  'projects.delete': 'Delete project',
  'projects.delete_confirm': 'Delete project?',
  'projects.delete_desc': 'This permanently removes {name}, its extracted source, all runs, logs, and artifacts. This cannot be undone.',
  'projects.empty_title': 'No projects yet',
  'projects.empty_desc': 'Upload your first file above and Forge will detect its kind and suggest workflows you can run.',
  'projects.runs': 'runs',
  'projects.run_one': 'run',
  'projects.files': 'files',

  // Dropzone
  'dropzone.label': 'Upload a project file',
  'dropzone.title': 'Drop a file here, or click to browse',
  'dropzone.hint': '.zip .tar.gz .html .js or any other file · up to 200 MB · auto-detected',
  'dropzone.uploading': 'Uploading…',
  'dropzone.extracting': 'Extracting & detecting…',
  'dropzone.failed': 'Upload failed',
  'dropzone.try_again': 'Try again',

  // Intent panel
  'intent.analyzing': 'Analyzing project to detect your intent…',
  'intent.confidence': '{pct}% confidence',
  'intent.recommended': 'Recommended:',
  'intent.show_details': 'Show detection details',
  'intent.hide_details': 'Hide detection details',
  'intent.signals': '{count} signals',
  'intent.auto_run': 'Auto-run',
  'intent.starting': 'Starting…',
  'intent.how': 'How Forge reached this conclusion',

  // Project detail
  'detail.back': 'Back to project list',
  'detail.detection_title': 'Detection summary',
  'detail.detection_desc': 'Auto-detected project metadata. Forge uses this to pick suggested workflows.',
  'detail.workflows_title': 'Workflows',
  'detail.workflows_desc': 'Run any workflow against this project. Results appear in the Runs tab.',
  'detail.runs_title': 'Recent runs',
  'detail.files_title': 'Project files',
  'detail.no_runs': 'No runs yet. Pick a workflow above to start your first run.',
  'detail.no_detection': 'No detection info available.',

  // Tabs
  'tab.overview': 'Overview',
  'tab.pipelines': 'Pipelines',
  'tab.analytics': 'Analytics',
  'tab.secrets': 'Secrets',
  'tab.cache': 'Cache',
  'tab.triggers': 'Triggers',
  'tab.notifications': 'Notifications',
  'tab.custom': 'Custom',
  'tab.settings': 'Settings',

  // Run view
  'run.back': 'Back to project',
  'run.logs': 'Logs',
  'run.artifacts': 'Artifacts',
  'run.no_logs': 'No logs yet.',
  'run.no_artifacts': 'No artifacts produced.',
  'run.cancel': 'Cancel run',
  'run.download': 'Download',
  'run.search_logs': 'Search logs…',

  // Footer
  'footer.built_with': 'Built with',
};

const he: Dict = {
  // App-level
  'app.name': 'Forge',
  'app.tagline': 'CI ריבוני',
  'app.description': 'מערכת CI מקומית להעלאת קבצים',

  // Header
  'header.home': 'Forge דף הבית',
  'header.docs': 'תיעוד',

  // Projects list
  'projects.title': 'פרויקטים',
  'projects.subtitle': 'גרור קובץ להעלאת פרויקט חדש. Forge יזהה את סוג הפרויקט ויציע תהליכי עבודה אוטומטית.',
  'projects.count': '{count} פרויקטים',
  'projects.count_one': 'פרויקט {count}',
  'projects.count_zero': 'אין פרויקטים עדיין',
  'projects.delete': 'מחק פרויקט',
  'projects.delete_confirm': 'למחוק פרויקט?',
  'projects.delete_desc': 'פעולה זו תסיר לצמיתות את {name}, את קוד המקור שחולץ, את כל ההרצות, הלוגים והחפצים. לא ניתן לבטל.',
  'projects.empty_title': 'אין פרויקטים עדיין',
  'projects.empty_desc': 'העלה את הקובץ הראשון שלך למעלה ו-Forge יזהה את סוגו ויציע תהליכי עבודה.',
  'projects.runs': 'הרצות',
  'projects.run_one': 'הרצה',
  'projects.files': 'קבצים',

  // Dropzone
  'dropzone.label': 'העלאת קובץ פרויקט',
  'dropzone.title': 'גרור קובץ לכאן, או לחץ לבחירה',
  'dropzone.hint': '.zip .tar.gz .html .js או כל קובץ אחר · עד 200 MB · זיהוי אוטומטי',
  'dropzone.uploading': 'מעלה…',
  'dropzone.extracting': 'חילוץ וזיהוי…',
  'dropzone.failed': 'ההעלאה נכשלה',
  'dropzone.try_again': 'נסה שוב',

  // Intent panel
  'intent.analyzing': 'מנתח את הפרויקט כדי לזהות את הכוונה שלך…',
  'intent.confidence': '{pct}% ביטחון',
  'intent.recommended': 'מומלץ:',
  'intent.show_details': 'הצג פרטי זיהוי',
  'intent.hide_details': 'הסתר פרטי זיהוי',
  'intent.signals': '{count} אותות',
  'intent.auto_run': 'הרצה אוטומטית',
  'intent.starting': 'מתחיל…',
  'intent.how': 'איך Forge הגיע למסקנה הזו',

  // Project detail
  'detail.back': 'חזרה לרשימת פרויקטים',
  'detail.detection_title': 'סיכום זיהוי',
  'detail.detection_desc': 'מטא-דאטה שזוהתה אוטומטית. Forge משתמש בזה כדי לבחור תהליכי עבודה.',
  'detail.workflows_title': 'תהליכי עבודה',
  'detail.workflows_desc': 'הרץ כל תהליך עבודה על הפרויקט הזה. התוצאות יופיעו בלשונית ההרצות.',
  'detail.runs_title': 'הרצות אחרונות',
  'detail.files_title': 'קבצי הפרויקט',
  'detail.no_runs': 'אין הרצות עדיין. בחר תהליך עבודה למעלה כדי להתחיל.',
  'detail.no_detection': 'אין מידע זיהוי זמין.',

  // Tabs
  'tab.overview': 'סקירה',
  'tab.pipelines': 'צינורות',
  'tab.analytics': 'ניתוח',
  'tab.secrets': 'סודות',
  'tab.cache': 'מטמון',
  'tab.triggers': 'טריגרים',
  'tab.notifications': 'התראות',
  'tab.custom': 'מותאם',
  'tab.settings': 'הגדרות',

  // Run view
  'run.back': 'חזרה לפרויקט',
  'run.logs': 'לוגים',
  'run.artifacts': 'חפצים',
  'run.no_logs': 'אין לוגים עדיין.',
  'run.no_artifacts': 'לא הופקו חפצים.',
  'run.cancel': 'בטל הרצה',
  'run.download': 'הורד',
  'run.search_logs': 'חיפוש בלוגים…',

  // Footer
  'footer.built_with': 'נבנה עם',
};

const DICTS: Record<Locale, Dict> = { en, he };

// ---------------------------------------------------------------------------
// Server-side / non-React translation
// ---------------------------------------------------------------------------

/**
 * Translate a key for the given locale, with optional interpolation.
 * Falls back to English if the key is missing in the requested locale,
 * then to the key itself if missing everywhere.
 */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let text = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/**
 * Detect the preferred locale from a request's Accept-Language header
 * or any other locale string. Returns 'he' for Hebrew, 'en' otherwise.
 */
export function detectLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return 'en';
  const lower = acceptLanguage.toLowerCase();
  if (lower.startsWith('he') || lower.startsWith('iw') || lower.includes('he-') || lower.includes('iw-')) {
    return 'he';
  }
  return 'en';
}

export const RTL_LOCALES: Locale[] = ['he'];

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

// ---------------------------------------------------------------------------
// Client-side React hook
// ---------------------------------------------------------------------------

// We avoid pulling in a heavy i18n library. The hook reads the locale
// once from the browser's navigator.language and caches it.
let cachedClientLocale: Locale | null = null;

export function getClientLocale(): Locale {
  if (cachedClientLocale) return cachedClientLocale;
  if (typeof navigator === 'undefined') return 'en';
  const lang = navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage || 'en';
  cachedClientLocale = detectLocale(lang);
  return cachedClientLocale;
}
