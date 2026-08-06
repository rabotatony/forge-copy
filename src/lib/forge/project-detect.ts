// ============================================================
// Forge — content-based project detection (no fs required)
// ============================================================
// Two modes:
//   detectFromEntries  — full in-memory entries (small uploads)
//   detectFromManifest — paths list + a few key files (large
//                        archives ingested in batches)
// ============================================================

export interface EntryLike {
  path: string;
  data: Uint8Array;
}

export interface DetectionOutput {
  kind: string;
  detection: Record<string, unknown>;
}

interface Manifest {
  paths: string[];
  files: Record<string, string>; // path -> text content
}

function analyzeManifest(m: Manifest): Record<string, unknown> {
  const paths = m.paths;
  const hasFile = (p: string) => paths.includes(p);
  const parseJson = (p: string): Record<string, unknown> | null => {
    const t = m.files[p];
    if (!t) return null;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const pkg = parseJson("package.json");
  const deps = {
    ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  const hasPackageJson = !!pkg;
  const hasLockfile = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"].some(hasFile);
  const hasTsConfig = hasFile("tsconfig.json");
  const hasSrcDir = paths.some((p) => p.startsWith("src/"));
  const hasHtmlEntry = hasFile("index.html");
  const hasPrisma = hasFile("prisma/schema.prisma") || !!deps.prisma || !!deps["@prisma/client"];
  const hasDockerfile = hasFile("Dockerfile");
  const hasPyproject = hasFile("pyproject.toml");
  const hasRequirements = hasFile("requirements.txt");

  let framework: string | null = null;
  if (deps.next) framework = "next";
  else if (deps.vite) framework = "vite";
  else if (deps.react && hasHtmlEntry) framework = "react-spa";
  else if (hasPyproject || hasRequirements) framework = "python";

  const hasNextAppApi = paths.some((p) => /^(src\/)?app\/.+\/route\.(ts|js)x?$/.test(p));
  const hasNextPagesApi = paths.some((p) => /^(src\/)?pages\/api\//.test(p));
  const api = hasNextAppApi || hasNextPagesApi;
  const ssr = framework === "next";
  const ssg = framework === "next";
  const spa = !!framework && framework !== "next" && framework !== "python";
  const isStatic = !framework && (hasHtmlEntry || paths.some((p) => p.endsWith(".html")));

  const language =
    hasTsConfig || paths.some((p) => /\.(tsx?|mts|cts)$/.test(p))
      ? "ts"
      : paths.some((p) => /\.(jsx?|mjs|cjs)$/.test(p))
        ? "js"
        : hasPyproject || hasRequirements || paths.some((p) => p.endsWith(".py"))
          ? "python"
          : "unknown";

  return {
    framework,
    frameworkVersion: framework === "next" ? (deps.next as string | undefined) ?? null : null,
    hasPackageJson,
    hasLockfile,
    hasSrcDir,
    hasHtmlEntry,
    hasTsConfig,
    hasPrisma,
    hasDockerfile,
    capabilities: { static: isStatic || ssg, ssr, api, spa, ssg },
    warnings: [] as string[],
    language,
  };
}

function kindFrom(detection: Record<string, unknown>, m: Manifest): string {
  if (detection.language === "python") return "python";
  if (m.paths.includes("Cargo.toml")) return "rust";
  if (m.paths.includes("go.mod")) return "go";
  if (detection.hasPackageJson) return "node";
  return "unknown";
}

export function detectFromManifest(paths: string[], files: Record<string, string>): DetectionOutput {
  const m: Manifest = { paths, files };
  const detection = analyzeManifest(m);
  return { kind: kindFrom(detection, m), detection };
}

export function detectFromEntries(entries: EntryLike[]): DetectionOutput {
  const paths = entries.map((e) => e.path);
  const files: Record<string, string> = {};
  const wanted = [
    "package.json", "tsconfig.json", "prisma/schema.prisma", "index.html",
    "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
    "next.config.mjs", "next.config.js", "next.config.ts",
  ];
  for (const e of entries) {
    if (wanted.includes(e.path)) {
      try {
        files[e.path] = Buffer.from(e.data).toString("utf8").slice(0, 300_000);
      } catch {
        // skip unreadable
      }
    }
  }
  return detectFromManifest(paths, files);
}
