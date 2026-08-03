# Shoshana Runbook — העברת shoshana.app מ-Netlify ל-Forge

> מסמך פעולה מלא: איך להעביר את שושנה מ-Netlify (מוגבל בקרדיטים)
> לשרת משלך עם Forge — ללא מגבלות, ללא תלות באף ספק.

## מה נמצא בבדיקה (2026-08-03)

| ממצא | משמעות |
|---|---|
| קוד המקור נמצא ב-`rabotatony/rose` (עודכן לאחרונה) | אין צורך בחילוץ — המקור קיים ומלא |
| Next.js 16 App Router + hash routing (כל הניווט בקליינט, 96 מסכים) | האתר כולו עמוד אחד + assets |
| `output: "standalone"` כבר מוגדר (כשלא רצים על Netlify) | הסוכן כבר הכין את הקרקע ל-self-host |
| כל 9 ה-API routes מחושבים מקומית (מנוע קריאה + LLM פנימי) | אין צורך במפתחות API חיצוניים בריצה |
| Prisma + SQLite, שימוש מינימלי | קובץ DB קטן שנשמר על השרת |
| `shoshana.app` מוגדר ב-Netlify (robots.txt: Host) | יש דומיין — נעביר אותו אלינו |
| Netlify: `next build` + plugin | נגמר הקרדיט = האתר תקוע. אצלנו: deploy = העתקת קבצים |

### הערות אבטחה לטיפול
1. בריפו `rose` קיים `.env` עם `DATABASE_URL` — הריפו ציבורי. מומלץ: להפוך את `rose` ל-private ולוודא שאין שם מפתחות אמיתיים.
2. קיים `upload/or-project-full.zip` (12.8MB) בתוך הריפו — שקול למחוק מההיסטוריה אם הוא לא נחוץ.
3. טוקן הגיטהאב ששימש אותי נחשף — בצע revoke בסיום.

---

## שלב 1 — שרת

VPS קטן מספיק (שושנה קלה; Forge עצמו גם Next.js). דרישות מינימליות:

- Ubuntu 22.04+ / Debian 12, 2GB RAM (רצוי 4GB), 20GB דיסק
- פורטים 80/443 פתוחים
- DNS עם גישה ל-`shoshana.app`

```bash
# Bun
curl -fsSL https://bun.sh/install | bash

# Caddy (HTTPS אוטומטי)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Node (לריצת standalone; אפשר גם להחליף ב-bun בפקודת ההפעלה)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

## שלב 2 — Forge על השרת

```bash
git clone https://github.com/rabotatony/forge-copy.git forge   # או forge אחרי מיזוג
cd forge
bun install
bun run db:push

# הגדרות deploy — הכרחי:
export FORGE_DOMAIN=forge.example.com          # דומיין הבסיס שלך
export FORGE_SITES_ROOT=/srv/sites
export FORGE_CADDY_SITES_DIR=/etc/caddy/sites-enabled
export FORGE_CADDY_RELOAD_CMD="systemctl reload caddy"
# אופציונלי: FORGE_APP_PORT_BASE=4100, FORGE_DEPLOY_KEEP=10
```

ודא שה-Caddyfile הראשי מייבא את ה-snippets:

```caddy
import /etc/caddy/sites-enabled/*.caddy
```

## שלב 3 — ייבוא שושנה ל-Forge

בממשק Forge: Projects → New → Clone:

```
https://github.com/rabotatony/rose.git
```

### בנייה (כמו שהוגדר ב-package.json של rose)

```bash
bun install
bun run db:generate
bun run build
# build = next build + העתקת static/public לתוך .next/standalone
```

אפשר להריץ את זה כ-pipeline ב-Forge (workflows), או ידנית בפעם הראשונה.

## שלב 4 — Deploy דרך Forge

בטאב Deployments (או ישירות ב-API):

| שדה | ערך |
|---|---|
| Environment | `production` |
| סוג יעד | Node app |
| outputDir | `.next/standalone` |
| פקודת הפעלה | `node server.js` (או `bun server.js`) |
| דומיינים | `shoshana.app, www.shoshana.app` |

מה קורה מאחורי הקלעים:
1. Forge מעתיק את standalone ל-`/srv/sites/<slug>/releases/<version>/`
2. מחליף symlink בשם `current` אטומית (zero downtime)
3. מייצר unit של systemd בשם `forge-app-<slug>.service` עם `Restart=always`
4. מייצר Caddy snippet עם reverse_proxy + HTTPS אוטומטי
5. מפעיל מחדש את השירות

### אם ל-Forge אין הרשאות systemctl
התגובה מחזירה פקודות ידניות — הרץ אותן פעם אחת:

```bash
sudo install -m 644 /srv/sites/<slug>/systemd/forge-app-<slug>.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now forge-app-<slug>.service
```

## שלב 5 — DNS: מעבר מ-Netlify

1. אצל רשם הדומיין: שנה A record של `shoshana.app` ו-`www` ל-IP של השרת שלך
2. המתן ל-TTL (בדרך כלל דקות עד שעה)
3. Caddy ינפיק תעודת Lets Encrypt אוטומטית
4. ודא: `curl -I https://shoshana.app/` מחזיר 200
5. מחק את האתר מ-Netlify (אחרי שוידאת שהכול עובד) — כולל ביטול ה-custom domain שם

## צ'קליסט אימות

- [ ] `https://shoshana.app/` עולה עם HTTPS תקין
- [ ] הקריאה היומית: `curl https://shoshana.app/api/reading/today` מחזיר JSON
- [ ] שאילתה חופשית: POST אל `/api/ask` עם גוף JSON של שאלה מחזירה תשובה
- [ ] ניווט בין מסכים (כגון today, tarot/fool) עובד
- [ ] PWA/manifest נטען
- [ ] `systemctl status forge-app-<slug>` מראה active (running)
- [ ] reboot לשרת — האתר חוזר אוטומטית (systemd enable)

## מכאן והלאה — deploy ללא מגבלות

- ב-rose: שינוי, push, ואוטומציה ב-Forge: webhook, build, deploy
- או ידנית: בנייה + כפתור פרסום ב-Forge
- כל deploy = גרסה חדשה ב-releases + החלפת symlink. אין מונה, אין קרדיטים.
- תקלה? כפתור Rollback מחזיר לגרסה קודמת בשנייה.
- Preview לכל ענף: סביבה נפרדת + דומיין משנה — חינם, כמו Vercel, אבל אצלך.
