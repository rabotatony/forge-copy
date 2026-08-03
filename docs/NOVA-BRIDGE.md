# Nova - Forge Bridge

Nova generates apps from a prompt. Forge builds, deploys, distributes and
monitors them. The bridge connects both halves of the loop:

    prompt -> Nova (generate) -> Forge (analyze > blueprint > build > deploy > APK)

## Endpoint

    POST /api/forge/from-nova
    Content-Type: application/json

### Request

    {
      "name": "my-snake-game",
      "prompt": "build me a snake game with leaderboard",
      "files": [
        { "path": "index.html", "content": "<!doctype html>..." },
        { "path": "app.js", "content": "..." }
      ],
      "meta": { "model": "kimi-k3", "elapsedMs": 18400 }
    }

`files` also accepts a map form: `{ "index.html": "...", "app.js": "..." }`.

Limits: 500 files, 2MB per file, 20MB total, path traversal rejected.

### Response

    {
      "project": { "id": "proj_...", "name": "my-snake-game", "kind": "static" },
      "analysis": { "framework": "static", "capabilities": {} },
      "nextSteps": ["Open the project Overview tab ...", "..."]
    }

The project appears immediately in Forge with full capability analysis -
blueprint, build, deploy and artifact publishing are all available from the UI.

## Example (curl)

    curl -X POST http://localhost:3000/api/forge/from-nova \
      -H 'Content-Type: application/json' \
      -d '{ "name": "hello-nova", "prompt": "a hello world page",
            "files": [{ "path": "index.html", "content": "<h1>hello from nova</h1>" }] }'

## Nova-side publish button

Drop this helper into Nova (`src/lib/publish-to-forge.ts`):

    export async function publishToForge(opts: {
      forgeUrl: string;
      name: string;
      prompt: string;
      files: Record<string, string>;
      meta?: Record<string, unknown>;
    }) {
      const base = opts.forgeUrl.replace(/\/+$/, '');
      const res = await fetch(base + '/api/forge/from-nova', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: opts.name,
          prompt: opts.prompt,
          files: opts.files,
          meta: opts.meta,
        }),
      });
      if (!res.ok) throw new Error('Forge publish failed: ' + res.status);
      return res.json() as Promise<{ project: { id: string; name: string }; analysis: unknown; nextSteps: string[] }>;
    }

Wire it to a "Publish to Forge" button in the post-generation toolbar:

    const result = await publishToForge({
      forgeUrl: process.env.NEXT_PUBLIC_FORGE_URL ?? 'http://localhost:3000',
      name: generatedName,
      prompt: originalPrompt,
      files: generatedFiles,
      meta: { model, elapsedMs },
    });
    window.open(forgeUrl + '/projects/' + result.project.id, '_blank');

## Security notes

- Path validation: absolute paths, `..`, backslashes and empty segments are rejected.
- Size caps prevent payload abuse (500 files / 2MB each / 20MB total).
- The prompt is stored in the audit log (truncated to 2000 chars).
- When exposing Forge publicly, gate this route behind Forge API tokens
  (System > API Tokens) or a reverse-proxy allowlist.

## End-to-end sovereign loop

1. User types a prompt into Nova.
2. Nova generates files (works with TokenRouter/Kimi K3 free keys or DashScope).
3. Nova POSTs files to this endpoint.
4. Forge analyzes capabilities, offers one-click blueprint.
5. Build runs locally or via GitHub Actions (free on public repos).
6. Artifacts panel publishes APK/ZIP with QR + GitHub Release.
7. Deployments panel pushes to any mesh node / Caddy site.

No external PaaS, no credits, no approval queues.
