# Forge — Sovereign CI/CD Platform

## מה זה הפרויקט הזה

Forge היא מערכת CI/CD self-hosted שבנויה על Next.js 16 + TypeScript + Prisma (SQLite).
המערכת מאפשרת: העלאת פרויקטים (ZIP/TAR/multi-file/folder), הרצת workflows, צפייה בלוגים חיים (SSE),
pipelines, triggers (webhook + cron), אינטגרציית GitHub מלאה (PRs, Actions, check-runs), ועוד.

## הקשר חשוב — קרא את זה לפני הכל

הפרויקט הזה עבר מסע ארוך ומורכב. הנה הנקודות הקריטיות שחשוב לדעת:

### מה כבר קיים ועובד
- **344 קבצי source** (TypeScript/TSX)
- **69 commits** ב-git
- **103 API routes** תחת `/api/forge/`
- **66 React components** תחת `src/components/forge/`
- **24 Prisma models**
- **tsc נקי, lint נקי, שרת רץ**
- העלאת פרויקטים (multi-file + folder upload עם streaming)
- הרצת workflows עם לוגים חיים (SSE)
- pipelines (multi-stage DAG)
- triggers (webhook + cron, כולל GitHub webhook routing)
- אינטגרציית GitHub מלאה (27 פונקציות API, 11 routes, check-runs feedback loop)
- GitHub App scaffold (JWT + installation tokens — מחכה ל-keys)
- next-auth scaffold (מחכה ל-OAuth registration)
- URL hash routing (deep-linking)
- Global dashboard
- PWA (manifest + service worker)
- Code search (ripgrep)
- Health endpoint
- i18n (he/en + es/fr/de fallback)

### מה עברנו — 9 סבבי ביקורת + שחזור
הפרויקט עבר 9 סבבי ביקורת עמוקים שמצאו ותיקנו **84+ באגים**. הקטגוריות:
- Race conditions ב-engine (appendLog seq, cancelRun, finishRun idempotency)
- SSRF protection (notifications, clone-repo, webhooks)
- Path traversal (agent, files/update)
- Silent bugs (env vars לא הוזרקו, notifications שלא נשלחו, seq כפולים)
- Mobile responsiveness (50+ תיקונים)
- Performance (SSE replay cap, log virtualization, upload streaming)
- Security (encryption key, .gitignore, mask secrets)

### מה קרה עם השחזור
הקוד נכתב מחדש פעמיים בגלל ש:
1. שינויים לא היו committed ונמחקו ב-rollback
2. גרסה v90 מ-27 ביולי שוחזרה מ-`/tmp/my-project` ומ-ZIP ב-upload
3. תיקוני הבאגים הוחזרו ידנית מעל גרסת v90

## ארכיטקטורה

### Tech Stack
- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript 5 (strict)
- **Database:** Prisma ORM + SQLite
- **Styling:** Tailwind CSS 4 + shadcn/ui (New York)
- **State:** TanStack Query (server) + useState (client)
- **Real-time:** SSE (EventSource) — לא WebSocket
- **GitHub SDK:** octokit (lazy loaded)
- **Icons:** lucide-react

### מבנה תיקיות
```
src/
  app/
    api/forge/          — 103 API routes
      projects/[id]/    — project CRUD + sub-resources
      runs/[id]/        — run execution + logs + SSE stream
      github/           — 11 GitHub API routes
      ...
    page.tsx            — main SPA (hash-based routing)
  components/forge/     — 66 React components
    tabs/               — sub-tabs (pipelines, triggers, github, etc.)
    use-forge-api.ts    — all React Query hooks (1400+ lines)
  lib/forge/            — backend logic
    engine.ts           — run execution (appendLog, startRun, finishRun, cancelRun)
    pipeline.ts         — pipeline DAG execution
    triggers.ts         — webhook + cron triggers
    github.ts           — GitHub API client (782 lines, 27 functions)
    github-feedback.ts  — check-runs feedback loop
    git.ts              — git CLI wrapper (read + write operations)
    notifications.ts    — webhook notifications (with SSRF protection)
    secrets.ts          — AES-256-GCM encryption at rest
    settings-key.ts     — shared encryption key (SHA-256 derivation)
    ...
  lib/axiomstate/       — project parser/bundler (phases 0-5)
```

### Prisma Models
Project, Run, LogLine, Artifact, Secret, EnvVar, CacheEntry, Trigger,
WebhookDelivery, Notification, Pipeline, PipelineRun, StageRun,
TestReport, Approval, RunSummary, Annotation, ProjectSettings,
Environment, Deployment, ApiToken, AuditLog, Experiment, ExperimentRun,
ScheduledRun

## נקודות חשובות שחייב לדעת

### 1. ה-engine.ts מורכב
- `appendLog` משתמש ב-per-runId promise queue (למנוע duplicate seq)
- `finishRun` הוא idempotent (לא דורס סטטוס סופי)
- `onRunStart` רץ לפני `executeRun` עם timeout של 5s
- `onRunFinish` מעדכן check-runs ב-GitHub עם annotations
- `cancelInprogressRuns` מבטל running + queued + waiting_approval
- Plugin workflows (parse/bundle) עוקפים את בדיקת "no steps"

### 2. אבטחה
- SSRF validation ב-notifications + clone-repo (private IPs חסומים)
- Path traversal fix: `root + path.sep` (לא `startsWith(root)`)
- Webhook signature: `x-hub-signature-256` ל-GitHub, `x-forge-signature` ל-generic
- `.forge-settings.json` מוצפן עם AES-256-GCM (SHA-256 key derivation)
- `.forge-settings.json` ב-.gitignore

### 3. GitHub Integration
- `github.ts` — לקוח מלא עם octokit (lazy loaded)
- 11 API routes תחת `/api/forge/projects/[id]/github/`
- Check-runs feedback: כל run יוצר check-run ב-GitHub
- GitHub tab ב-project workspace
- GitHub App scaffold (`github-app.ts`) — מחכה ל-FORGE_GITHUB_APP_ID + PEM key
- Auth scaffold (`auth-config.ts`) — מחכה ל-GITHUB_OAUTH_CLIENT_ID/SECRET

### 4. מה חסר / מה צריך להיעשות
- **GitHub App:** קוד מוכן, צריך רישום חיצוני (https://github.com/settings/apps/new)
- **Auth:** קוד מוכן, צריך OAuth App registration
- **E2E tests:** לא קיימים
- **DB migrations:** משתמש ב-`db:push` (לא `prisma migrate`)
- **WebSocket:** לא קיים (רק SSE)
- **Full i18n:** es/fr/de משתמשים ב-en fallback
- **Sentry/monitoring:** לא קיים (יש רק health endpoint)
- **Virtualization:** LogTerminal משתמש ב-react-virtual, אבל file-explorer לא

### 5. דברים שכדאי לשים לב אליהם
- השרת נופל כשמשתמשים ב-`next dev` ישירות במקום `.zscripts/dev.sh`
- `bun run dev` משתמש ב-`next dev -p 3000 2>&1 | tee dev.log`
- ה-`middleware.ts` עושה rate limiting (100 req/min ל-API, 10 ל-upload)
- `proxy.ts` ב-Next.js 16 מחליף את middleware (יש warning אבל עובד)
- ה-`worklog.md` מכיל את כל היסטוריית העבודה (4946 שורות) — לא נכלל ב-ZIP

## איך להרים את הפרויקט

```bash
bun install
bun run db:push    # יוצר את מסד הנתונים
bun run dev        # מפעיל את השרת ב-port 3000
```

## מה המשתמש מצפה שיהיה

המשתמש מצפה למערכת CI/CD מלאה שעובדת end-to-end:
1. העלאת פרויקט (ZIP/multi-file/folder) → זיהוי אוטומטי → workflows מוצעים
2. הרצת workflow → לוגים חיים → artifacts → test reports
3. Pipelines (multi-stage) → matrix builds → approvals
4. GitHub integration → PRs, Actions, check-runs, webhooks
5. Triggers → webhook (GitHub-aware) + cron
6. Mobile responsive → 390px viewport
7. URL routing → deep-linking, refresh-safe
8. Dashboard → stats, activity, top workflows

המערכת צריכה להיות יציבה, בלי שהשרת נופל, בלי קבצים שנעלמים.
כל שינוי חייב להיות committed ל-git מיד.
