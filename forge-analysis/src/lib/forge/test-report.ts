// ============================================================
// Forge — test report parsing (Phase 5)
// ============================================================
// Parses test reports in three formats:
//   • JUnit XML          (regex-based parser, no external deps)
//   • Mocha/Jest JSON    (stats + nested suites)
//   • TAP (version 13)   (ok / not ok lines)
// All parsers return a normalised ParsedTestReport.
// ============================================================

import { db } from '@/lib/db';
import type { TestReport } from '@prisma/client';
import type { ParsedTestReport, TestCase, TestSuite } from './types';

// ---------------------------------------------------------------------------
// JUnit XML
// ---------------------------------------------------------------------------

/**
 * Parse JUnit XML. Tolerates a `<testsuites>` wrapper or bare `<testsuite>`
 * elements. Handles self-closing testcases (`<testcase .../>`) and testcases
 * with `<failure>`, `<error>`, or `<skipped>` children.
 *
 * Time attributes are in (float) seconds and are converted to integer ms.
 */
export function parseJUnit(xml: string): ParsedTestReport {
  const suites: TestSuite[] = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let duration = 0;

  // Match <testsuite ...>body</testsuite> OR <testsuite .../>.
  const suiteRegex = /<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g;
  let m: RegExpExecArray | null;
  while ((m = suiteRegex.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    const suite = parseJUnitSuite(attrs, body);
    suites.push(suite);
    for (const c of suite.cases) {
      if (c.status === 'passed') passed++;
      else if (c.status === 'failed' || c.status === 'error') failed++;
      else if (c.status === 'skipped') skipped++;
    }
    total += suite.cases.length;
    if (suite.duration) duration += suite.duration;
  }

  return {
    format: 'junit',
    total,
    passed,
    failed,
    skipped,
    duration: duration > 0 ? duration : undefined,
    suites,
  };
}

function parseJUnitSuite(attrs: string, body: string): TestSuite {
  const name = getXmlAttr(attrs, 'name') ?? 'suite';
  const timeAttr = getXmlAttr(attrs, 'time');
  const duration = timeAttr ? Math.round(parseFloat(timeAttr) * 1000) : undefined;
  const cases: TestCase[] = [];

  // Match <testcase ...>body</testcase> OR <testcase .../>.
  const caseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = caseRegex.exec(body)) !== null) {
    const caseAttrs = m[1] ?? '';
    const caseBody = m[2] ?? '';
    const caseName = getXmlAttr(caseAttrs, 'name') ?? 'unknown';
    const className = getXmlAttr(caseAttrs, 'classname');
    const caseTime = getXmlAttr(caseAttrs, 'time');
    const caseDuration = caseTime ? Math.round(parseFloat(caseTime) * 1000) : undefined;

    let status: TestCase['status'] = 'passed';
    let message: string | undefined;
    if (/<failure\b/i.test(caseBody)) {
      status = 'failed';
      message = getXmlAttr(caseBody.slice(0, 256), 'failure', 'message') ?? extractXmlText(caseBody, 'failure');
    } else if (/<error\b/i.test(caseBody)) {
      status = 'error';
      message = getXmlAttr(caseBody.slice(0, 256), 'error', 'message') ?? extractXmlText(caseBody, 'error');
    } else if (/<skipped\b/i.test(caseBody)) {
      status = 'skipped';
    }

    cases.push({
      name: caseName,
      status,
      duration: caseDuration,
      message,
      className,
    });
  }

  return { name, cases, duration };
}

function getXmlAttr(attrs: string, tag: string, attr: string = ''): string | undefined {
  // If attr is empty, we look for any attribute on the given tag.
  // Otherwise we look for `attr="..."` on the given tag.
  const attrPattern = attr
    ? new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i')
    : new RegExp(`\\b${tag}\\s*=\\s*"([^"]*)"`, 'i');
  const m = attrs.match(attrPattern);
  return m ? decodeXml(m[1]!) : undefined;
}

function extractXmlText(body: string, tag: string): string | undefined {
  const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return undefined;
  return decodeXml(m[1]!.trim());
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Mocha / Jest JSON
// ---------------------------------------------------------------------------

interface JSONTest {
  title?: string;
  name?: string;
  state?: string;
  duration?: number;
  durationMs?: number;
  err?: { message?: string; stack?: string };
}

interface JSONSuite {
  title?: string;
  name?: string;
  tests?: JSONTest[];
  suites?: JSONSuite[];
}

interface JSONReport {
  stats?: {
    tests?: number;
    passes?: number;
    failures?: number;
    pending?: number;
    duration?: number;
    durationMs?: number;
  };
  suites?: JSONSuite[];
  suite?: JSONSuite;
}

/**
 * Parse a Mocha/Jest-style JSON report:
 *   { stats: {...}, suites: [...] }
 * Suites can be nested recursively.
 */
export function parseJSONReport(json: string): ParsedTestReport {
  let data: JSONReport;
  try {
    data = JSON.parse(json) as JSONReport;
  } catch {
    return { format: 'json', total: 0, passed: 0, failed: 0, skipped: 0, suites: [] };
  }

  if (typeof data !== 'object' || data === null) {
    return { format: 'json', total: 0, passed: 0, failed: 0, skipped: 0, suites: [] };
  }

  const suites: TestSuite[] = [];
  let walkedTotal = 0;
  let walkedPassed = 0;
  let walkedFailed = 0;
  let walkedSkipped = 0;

  function walkSuite(suite: JSONSuite): TestSuite {
    const title = suite.title || suite.name || 'suite';
    const cases: TestCase[] = [];
    let suiteDuration = 0;

    if (Array.isArray(suite.tests)) {
      for (const test of suite.tests) {
        const testTitle = test.title || test.name || 'test';
        const state = (test.state || '').toLowerCase();
        const dur = test.duration ?? test.durationMs ?? 0;
        if (dur) suiteDuration += dur;

        let status: TestCase['status'];
        let message: string | undefined;
        if (state === 'passed' || state === 'pass') {
          status = 'passed';
          walkedPassed++;
        } else if (state === 'failed' || state === 'fail') {
          status = 'failed';
          walkedFailed++;
          message = test.err?.message ?? test.err?.stack;
        } else {
          // 'pending' or unspecified → skipped
          status = 'skipped';
          walkedSkipped++;
        }
        cases.push({
          name: testTitle,
          status,
          duration: dur || undefined,
          message,
        });
        walkedTotal++;
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        const childSuite = walkSuite(child);
        // Flatten child cases into parent for ease of display.
        cases.push(...childSuite.cases);
        if (childSuite.duration) suiteDuration += childSuite.duration;
      }
    }

    return { name: title, cases, duration: suiteDuration || undefined };
  }

  if (Array.isArray(data.suites)) {
    for (const s of data.suites) {
      suites.push(walkSuite(s));
    }
  } else if (data.suite) {
    suites.push(walkSuite(data.suite));
  }

  // Authoritative totals come from stats if provided; otherwise use walked counts.
  const stats = data.stats ?? {};
  const total = stats.tests ?? walkedTotal;
  const passed = stats.passes ?? walkedPassed;
  const failed = stats.failures ?? walkedFailed;
  const skipped = stats.pending ?? walkedSkipped;
  const duration = stats.duration ?? stats.durationMs;

  return {
    format: 'json',
    total,
    passed,
    failed,
    skipped,
    duration: typeof duration === 'number' ? duration : undefined,
    suites,
  };
}

// ---------------------------------------------------------------------------
// TAP (Test Anything Protocol)
// ---------------------------------------------------------------------------

/**
 * Parse TAP version 13 output:
 *   TAP version 13
 *   1..N
 *   ok 1 - description
 *   not ok 2 - description
 *   ok 3 - description # SKIP
 */
export function parseTAP(text: string): ParsedTestReport {
  const lines = text.split(/\r?\n/);
  const cases: TestCase[] = [];
  let plan: number | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // TAP version line
    if (/^TAP version \d+/.test(line)) continue;

    // Plan line: 1..N
    const planMatch = line.match(/^1\.\.(\d+)/);
    if (planMatch) {
      plan = parseInt(planMatch[1]!, 10);
      continue;
    }

    // Comments / pragmas
    if (line.startsWith('#')) continue;

    // ok / not ok
    const okMatch = line.match(/^(not ok|ok)\s+(\d+)(?:\s+-?\s*)?(.*)$/);
    if (okMatch) {
      const isOk = okMatch[1] === 'ok';
      const seq = okMatch[2]!;
      const rest = (okMatch[3] ?? '').trim();
      const isSkip = /#\s*SKIP\b/i.test(rest);
      const isTodo = /#\s*TODO\b/i.test(rest);
      const name = rest.replace(/#\s*(SKIP|TODO)\b.*$/i, '').trim() || `test ${seq}`;

      let status: TestCase['status'];
      if (isSkip) {
        status = 'skipped';
      } else if (isOk && !isTodo) {
        status = 'passed';
      } else if (!isOk && isTodo) {
        // TAP TODO failures are not real failures — treat as skipped (expected-to-fail).
        status = 'skipped';
      } else if (!isOk) {
        status = 'failed';
      } else {
        status = 'passed';
      }

      cases.push({ name, status });
    }
  }

  const total = plan ?? cases.length;
  const passed = cases.filter(c => c.status === 'passed').length;
  const failed = cases.filter(c => c.status === 'failed').length;
  const skipped = cases.filter(c => c.status === 'skipped').length;

  return {
    format: 'tap',
    total,
    passed,
    failed,
    skipped,
    duration: undefined,
    suites: [{ name: 'TAP', cases }],
  };
}

// ---------------------------------------------------------------------------
// DB persistence
// ---------------------------------------------------------------------------

/**
 * Save a parsed test report to the database.
 */
export async function storeTestReport(runId: string, report: ParsedTestReport): Promise<void> {
  await db.testReport.create({
    data: {
      runId,
      format: report.format,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      duration: report.duration ?? null,
      suites: JSON.stringify(report.suites),
    },
  });
}

/**
 * Result row type returned by getTestReport — same as the Prisma model but
 * with `suites` parsed back into a TestSuite[] array (instead of a JSON string).
 */
export type TestReportWithSuites = Omit<TestReport, 'suites'> & { suites: TestSuite[] };

/**
 * Load the most recent test report for a run, with `suites` parsed back into
 * a TestSuite[] array.
 */
export async function getTestReport(runId: string): Promise<TestReportWithSuites | null> {
  const row = await db.testReport.findFirst({
    where: { runId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;

  let suites: TestSuite[] = [];
  try {
    const parsed: unknown = JSON.parse(row.suites);
    if (Array.isArray(parsed)) suites = parsed as TestSuite[];
  } catch {
    suites = [];
  }

  // Strip the original (string) suites field and replace with the parsed array.
  const { suites: _omit, ...rest } = row;
  void _omit;
  return { ...rest, suites };
}

/**
 * Just the summary numbers for a run's most recent test report.
 */
export async function getTestReportSummary(
  runId: string,
): Promise<{ total: number; passed: number; failed: number; skipped: number; duration: number | null } | null> {
  const row = await db.testReport.findFirst({
    where: { runId },
    orderBy: { createdAt: 'desc' },
    select: {
      total: true,
      passed: true,
      failed: true,
      skipped: true,
      duration: true,
    },
  });
  if (!row) return null;
  return {
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    duration: row.duration,
  };
}
