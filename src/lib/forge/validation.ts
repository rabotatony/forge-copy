// ============================================================
// Forge — Build Intelligence: validation guards
// ============================================================
// Catches the exact failure classes the Shoshana exercise exposed,
// BEFORE a build is attempted: APK wrapper asset-path mismatch (the
// d37fab0 bug), Next.js export readiness, Capacitor config sanity.
// ============================================================

import type { ProjectAnalysis } from './analyzer';

export interface ValidationIssue {
  level: 'error' | 'warning';
  area: 'apk-wrapper' | 'next-config' | 'capacitor' | 'workflow';
  message: string;
  fix?: string;
}

/** Regression guard for the WebView wrapper script. */
export function validateApkWrapperScript(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const copyDest = content.match(/\$ASSETS\/([A-Za-z0-9_.-]+)|assets\/([A-Za-z0-9_.-]+)\s*(?=["'])/g);
  const loadUrl = content.match(/android_asset\/([A-Za-z0-9_.-]+)/);
  if (loadUrl && copyDest && copyDest.length > 0) {
    const loaded = loadUrl[1];
    const lastCopy = copyDest[copyDest.length - 1].replace(/\$ASSETS\//, '').replace(/assets\//, '').replace(/[\s"']/g, '');
    if (lastCopy && loaded && lastCopy !== loaded && !lastCopy.startsWith(loaded + '/') && !loaded.startsWith(lastCopy + '/')) {
      issues.push({
        level: 'error', area: 'apk-wrapper',
        message: `Asset path mismatch: files copied to '${lastCopy}' but WebView loads 'android_asset/${loaded}' — the APK would boot to a blank screen`,
        fix: `Align both sides on '${loaded}' (copy into "$ASSETS/${loaded}")`,
      });
    }
  }
  if (!loadUrl) {
    issues.push({ level: 'warning', area: 'apk-wrapper', message: 'No android_asset load URL found — cannot verify wrapper paths' });
  }
  return issues;
}

/** Validates Next.js config readiness for a static export build. */
export function validateNextForExport(analysis: ProjectAnalysis): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (analysis.framework !== 'next') return issues;
  for (const b of analysis.capabilities.staticExport.blockers) issues.push({ level: 'error', area: 'next-config', message: b });
  for (const w of analysis.capabilities.staticExport.warnings) issues.push({ level: 'warning', area: 'next-config', message: w });
  if (!analysis.nextConfig.exists) {
    issues.push({ level: 'warning', area: 'next-config', message: 'No next.config.* found — export mode cannot be toggled', fix: 'Run blueprint action "export-mode" to create one' });
  } else if (!analysis.nextConfig.hasEnvToggle) {
    issues.push({ level: 'warning', area: 'next-config', message: 'next.config has no BUILD_APK toggle — export builds would affect the server build too', fix: 'Run blueprint action "export-mode"' });
  }
  return issues;
}

/** Validates capacitor.config.* content. */
export function validateCapacitorConfig(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const appId = content.match(/appId\s*:\s*['"]([^'"]+)['"]/);
  const webDir = content.match(/webDir\s*:\s*['"]([^'"]+)['"]/);
  if (!appId || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(appId[1])) {
    issues.push({ level: 'error', area: 'capacitor', message: 'capacitor appId missing or not in reverse-domain form (e.g. app.name.android)' });
  }
  if (!webDir) {
    issues.push({ level: 'error', area: 'capacitor', message: 'capacitor webDir missing — the wrapper would have nothing to load' });
  } else if (webDir[1] !== 'out') {
    issues.push({ level: 'warning', area: 'capacitor', message: `webDir is '${webDir[1]}' — Next.js static exports land in 'out'`, fix: "Set webDir: 'out'" });
  }
  return issues;
}

/** Full pre-flight for the APK path. */
export function preflightApk(analysis: ProjectAnalysis, files?: Record<string, string>): ValidationIssue[] {
  const issues = [...validateNextForExport(analysis)];
  if (files?.['capacitor.config.ts']) issues.push(...validateCapacitorConfig(files['capacitor.config.ts']));
  if (files?.['src/lib/forge/templates/build-apk.sh']) issues.push(...validateApkWrapperScript(files['src/lib/forge/templates/build-apk.sh']));
  if (!analysis.capabilities.apkWrap.ok) {
    issues.push({ level: 'error', area: 'workflow', message: 'APK wrap not feasible — resolve blockers first', fix: analysis.capabilities.apkWrap.blockers.join('; ') });
  }
  return issues;
}
