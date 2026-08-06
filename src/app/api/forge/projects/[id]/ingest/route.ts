// ============================================================
// Forge — runner-powered ingestion for large archives
// ============================================================
// POST /api/forge/projects/{id}/ingest
//   { sourceUrl? }  (defaults to detection.sourceUrl saved at create)
//
// Dispatches forge-remote-build.yml on a FREE GitHub runner:
//   runner downloads the archive -> extracts in memory ->
//   POSTs files back in small batches (/files) -> finalizes.
// Zero local compute: the worker only signs tokens + dispatches.
// ============================================================
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, serverError } from "@/lib/forge/response";
import { signSourceToken } from "@/lib/forge/gha-build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PY_SCRIPT = String.raw`
import json, base64, io, os, subprocess, sys, tarfile, time, urllib.request, zipfile

SRC = os.environ["SRC_URL"]
PID = os.environ["PROJECT_ID"]
TOKEN = os.environ["INGEST_TOKEN"]
BASE = "https://forge.rabotatony.workers.dev/api/forge/projects/" + PID + "/files"

def post(payload, attempt=0):
    with open("/tmp/batch.json", "w") as f:
        json.dump(payload, f)
    p = subprocess.run(
        ["curl", "-sS", "-m", "240", "-X", "POST", BASE,
         "-H", "Content-Type: application/json",
         "-H", "x-forge-token: " + TOKEN,
         "--data-binary", "@/tmp/batch.json",
         "-w", "
HTTPCODE:%{http_code}"],
        capture_output=True, text=True)
    out = p.stdout or ""
    code, body = 0, out + (p.stderr or "")
    if "HTTPCODE:" in out:
        body, code_s = out.rsplit("HTTPCODE:", 1)
        try:
            code = int(code_s.strip())
        except Exception:
            code = 0
    if code == 200:
        try:
            return json.loads(body)
        except Exception:
            return {"ok": True}
    print("POST FAILED code:", code, "attempt:", attempt, flush=True)
    print("response-body:", body[:700], flush=True)
    if attempt < 3:
        time.sleep(4 * (attempt + 1))
        return post(payload, attempt + 1)
    raise SystemExit("batch failed with HTTP %s" % code)

print("downloading", SRC, flush=True)
data = urllib.request.urlopen(SRC, timeout=600).read()
print("archive bytes:", len(data), flush=True)

entries = []
if SRC.lower().endswith(".zip"):
    zf = zipfile.ZipFile(io.BytesIO(data))
    for n in zf.namelist():
        if n.endswith("/"):
            continue
        entries.append((n, zf.read(n)))
else:
    tf = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
    for m in tf.getmembers():
        if not m.isfile():
            continue
        f = tf.extractfile(m)
        if f is not None:
            entries.append((m.name, f.read()))

def clean_path(p):
    p = p.replace(chr(92), "/").lstrip("/")
    if ".." in p.split("/"):
        return None
    return p

entries = [(clean_path(p), d) for p, d in entries]
entries = [(p, d) for p, d in entries if p]
roots = set(p.split("/")[0] for p, _ in entries)
if len(roots) == 1 and all("/" in p for p, _ in entries):
    root = next(iter(roots)) + "/"
    entries = [(p[len(root):], d) for p, d in entries if p.startswith(root) and len(p) > len(root)]
print("files:", len(entries), flush=True)

batch, batch_bytes = [], 0
sent = 0
def flush_batch():
    global batch, batch_bytes, sent
    if not batch:
        return
    r = post({"files": batch})
    sent += len(batch)
    print("batch:", sent, "/", len(entries), "ok:", r.get("ok"), flush=True)
    batch, batch_bytes = [], 0

for p, d in entries:
    b64 = base64.b64encode(d).decode()
    if len(batch) >= 25 or batch_bytes + len(b64) > 4000000:
        flush_batch()
    batch.append({"path": p, "b64": b64})
    batch_bytes += len(b64)
flush_batch()

def text_of(p):
    for pp, d in entries:
        if pp == p:
            try:
                return d.decode("utf-8", errors="ignore")[:300000]
            except Exception:
                return None
    return None

key = {}
for cand in ["package.json", "tsconfig.json", "prisma/schema.prisma", "index.html",
             "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
             "next.config.mjs", "next.config.js", "next.config.ts"]:
    t = text_of(cand)
    if t:
        key[cand] = t

r = post({"done": True, "paths": [p for p, _ in entries], "keyFiles": key, "fileSize": len(data)})
print("finalize:", json.dumps(r)[:400], flush=True)
`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const project = await db.project.findUnique({ where: { id } });
    if (!project) return fail("project not found");

    const body = (await request.json().catch(() => ({}))) as { sourceUrl?: string };
    let detection: { sourceUrl?: string } = {};
    try {
      detection = JSON.parse(project.detection);
    } catch {
      // keep defaults
    }
    const sourceUrl =
      typeof body.sourceUrl === "string" && body.sourceUrl.trim()
        ? body.sourceUrl.trim()
        : detection.sourceUrl;
    if (!sourceUrl) return fail("sourceUrl required (body or saved detection.sourceUrl)");

    const ghToken = process.env.FORGE_GHA_TOKEN || process.env.GITHUB_TOKEN;
    if (!ghToken) return fail("no GitHub token configured on Forge (GITHUB_TOKEN)");
    const repo = process.env.FORGE_GHA_REPO || "rabotatony/forge-copy";

    const ingestToken = await signSourceToken(id);
    const buildCmd =
      `export SRC_URL=${JSON.stringify(sourceUrl)}\n` +
      `export PROJECT_ID=${JSON.stringify(id)}\n` +
      `export INGEST_TOKEN=${JSON.stringify(ingestToken)}\n` +
      `python3 - <<'PYEOF'${PY_SCRIPT}\nPYEOF`;

    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/forge-remote-build.yml/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${ghToken}`,
        "User-Agent": "forge-ingest",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          run_id: `ingest-${id}`,
          source_url: "https://codeload.github.com/rabotatony/forge-copy/tar.gz/refs/heads/main",
          source_kind: "tar",
          build_cmd: buildCmd,
          callback_url: "",
          callback_token: "",
        },
      }),
    });
    if (res.status !== 204) {
      const t = await res.text();
      return serverError(new Error(`dispatch failed (${res.status}): ${t.slice(0, 200)}`));
    }

    return ok({ dispatched: true, projectId: id, sourceUrl });
  } catch (e) {
    return serverError(e);
  }
}
