import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ENCRYPTION_KEY = (process.env.FORGE_ENCRYPTION_KEY ?? 'forge-default-encryption-key-change-me-32b').padEnd(32, '0').slice(0, 32);
const SETTINGS_FILE = path.join(process.cwd(), '.forge-settings.json');
const SECRET_KEYS = ['GITHUB_TOKEN'];
const PLAIN_KEYS = ['GITHUB_OWNER', 'GITHUB_REPO'];

function encrypt(plaintext: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return { ciphertext: encrypted, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decrypt(s: {ciphertext:string;iv:string;tag:string}): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), Buffer.from(s.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
  return decipher.update(s.ciphertext, 'base64', 'utf8') + decipher.final('utf8');
}

function mask(v: string) { return v.length <= 4 ? "••••" : "••••••••" + v.slice(-4); }
let settingsMutex: Promise<void> = Promise.resolve();
function withSettingsLock<T>(fn: () => T | Promise<T>): Promise<T> { const r = settingsMutex.then(fn); settingsMutex = r.then(() => undefined, () => undefined); return r; }

function load() { try { return fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE,'utf-8')) : {secrets:{},plain:{}}; } catch { return {secrets:{},plain:{}}; } }
function save(s: any) { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s,null,2), {mode:0o600}); }

function getVal(key: string): string | null {
  const s = load();
  if (SECRET_KEYS.includes(key) && s.secrets[key]) { try { return decrypt(s.secrets[key]); } catch { return null; } }
  if (PLAIN_KEYS.includes(key) && s.plain[key]) return s.plain[key];
  return process.env[key] ?? null;
}

export async function GET() {
  const result: Record<string, {set:boolean;preview:string}> = {};
  for (const key of [...SECRET_KEYS, ...PLAIN_KEYS]) {
    const v = getVal(key);
    result[key] = { set: v !== null, preview: v ? mask(v) : '' };
  }
  const gh = getVal('GITHUB_TOKEN') && getVal('GITHUB_OWNER') && getVal('GITHUB_REPO');
  result['_githubReady'] = { set: !!gh, preview: gh ? getVal('GITHUB_OWNER') + '/' + getVal('GITHUB_REPO') : '' };
  return Response.json({ settings: result });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const s = load();
  for (const key of SECRET_KEYS) { if (body[key]) { s.secrets[key] = encrypt(body[key]); process.env[key] = body[key]; } }
  for (const key of PLAIN_KEYS) { if (body[key] !== undefined) { s.plain[key] = body[key]; process.env[key] = body[key]; } }
  save(s);
  return Response.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return Response.json({ error: 'Missing key' }, { status: 400 });
  const s = load();
  delete s.secrets[key]; delete s.plain[key];
  save(s);
  return Response.json({ success: true });
}
