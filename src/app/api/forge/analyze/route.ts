import type { NextRequest } from 'next/server';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.code) return Response.json({ error: 'Missing code' }, { status: 400 });
  const action = body.action || 'review';
  const lang = body.language || 'javascript';
  
  if (action === 'security-audit') {
    // Scan + fix
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const scan = await zai.chat.completions.create({ messages: [{ role: 'user', content: `Scan for vulnerabilities:\n\n${body.code.slice(0, 3000)}\n\nList each: type, severity, line.` }], thinking: { type: 'disabled' } });
    const fix = await zai.chat.completions.create({ messages: [{ role: 'user', content: `Fix vulnerabilities:\n\n${body.code.slice(0, 3000)}\n\nIssues:\n${scan.choices[0]?.message?.content}\n\nOutput ONLY fixed code.` }], thinking: { type: 'disabled' } });
    let fixedCode = (fix.choices[0]?.message?.content ?? '').replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    let valid = false;
    if (lang === 'javascript' || lang === 'js') { const tmp = '/tmp/forge-analyze-' + Date.now(); fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(tmp + '/check.js', fixedCode); try { execSync(`node --check ${tmp}/check.js`, { timeout: 5000 }); valid = true; } catch {} fs.rmSync(tmp, { recursive: true, force: true }); }
    else if (lang === 'python') { const tmp = '/tmp/forge-analyze-' + Date.now(); fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(tmp + '/check.py', fixedCode); try { execSync(`python3 -c "import ast; ast.parse(open('${tmp}/check.py').read())"`, { timeout: 5000 }); valid = true; } catch {} fs.rmSync(tmp, { recursive: true, force: true }); }
    return Response.json({ action, verdict: valid ? 'BREAKTHROUGH' : 'NO_CHANGE', analysis: scan.choices[0]?.message?.content, fixedCode: valid ? fixedCode : null, metrics: { valid } });
  }
  
  if (action === 'review') {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const review = await zai.chat.completions.create({ messages: [{ role: 'user', content: `Review this ${lang} code:\n\n${body.code.slice(0, 3000)}\n\nList issues: severity, line, suggestion.` }], thinking: { type: 'disabled' } });
    return Response.json({ action, verdict: 'completed', review: review.choices[0]?.message?.content });
  }
  
  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
