// ============================================================
// Forge — Development Templates
// ============================================================
import type { ProjectTemplate } from "./templates-projects";

export const DEV_TEMPLATES: ProjectTemplate[] = [
  {
    id: "dev-nextjs-fullstack",
    name: "Next.js Full-Stack",
    emoji: "🚀",
    description: "Production-ready Next.js 16 + Prisma + Tailwind + shadcn/ui + ESLint + tests.",
    kind: "node",
    files: {
      "package.json": JSON.stringify({
        name: "fullstack-app", version: "0.1.0", private: true,
        scripts: { dev: "next dev -p 3000", build: "next build", start: "next start", lint: "eslint .", test: "vitest run", "db:push": "prisma db push", "db:generate": "prisma generate" },
        dependencies: { next: "^16.1.0", react: "^19.0.0", "react-dom": "^19.0.0", "@prisma/client": "^6.11.0", zod: "^4.0.0" },
        devDependencies: { prisma: "^6.11.0", typescript: "^5.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", eslint: "^9.0.0", "eslint-config-next": "^16.1.0", tailwindcss: "^4.0.0", vitest: "^3.0.0" },
      }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2020", strict: true, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] }, noEmit: true }, include: ["**/*.ts", "**/*.tsx"] }, null, 2),
      "next.config.ts": `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { reactStrictMode: true };\nexport default nextConfig;\n`,
      "prisma/schema.prisma": `generator client { provider = "prisma-client-js" }\ndatasource db { provider = "sqlite"; url = env("DATABASE_URL") }\nmodel User { id String @id @default(cuid()) email String @unique name String? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt }\n`,
      ".env": `DATABASE_URL=file:./dev.db\n`,
      ".gitignore": `node_modules/\n.next/\n*.db\n.env.local\ndist/\n`,
      "src/app/layout.tsx": `export const metadata = { title: "Full-Stack App" };\nexport default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n`,
      "src/app/page.tsx": `export default function Home() { return <main className="flex min-h-screen items-center justify-center"><h1 className="text-4xl font-bold">🚀 Full-Stack App</h1></main>; }\n`,
      "src/app/global-error.tsx": `'use client'\nexport default function GlobalError({ error, reset }: { error: Error; reset: () => void }) { return <html><body><h2>Something went wrong!</h2><button onClick={() => reset()}>Try again</button></body></html>; }\n`,
      "src/lib/db.ts": `import { PrismaClient } from "@prisma/client";\nconst g = globalThis as unknown as { prisma: PrismaClient | undefined };\nexport const db = g.prisma ?? new PrismaClient({ log: ["error"] });\nif (process.env.NODE_ENV !== "production") g.prisma = db;\n`,
      "src/app/api/users/route.ts": `import { db } from "@/lib/db";\nexport async function GET() { const users = await db.user.findMany(); return Response.json(users); }\n`,
      "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { environment: "jsdom" } });\n`,
      "src/__tests__/example.test.ts": `import { describe, it, expect } from "vitest";\ndescribe("example", () => { it("works", () => { expect(1 + 1).toBe(2); }); });\n`,
    },
  },
  {
    id: "dev-api-server", name: "API Server", emoji: "🔌", description: "Express + Prisma + Zod + JWT + tests.", kind: "node",
    files: {
      "package.json": JSON.stringify({ name: "api-server", version: "1.0.0", scripts: { dev: "tsx watch src/index.ts", build: "tsc", start: "node dist/index.js", test: "vitest run" }, dependencies: { express: "^5.0.0", "@prisma/client": "^6.11.0", zod: "^4.0.0", jsonwebtoken: "^9.0.0", cors: "^2.8.5" }, devDependencies: { prisma: "^6.11.0", tsx: "^4.0.0", typescript: "^5.0.0", "@types/express": "^5.0.0", vitest: "^3.0.0" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", strict: true, module: "esnext", moduleResolution: "bundler", outDir: "./dist", rootDir: "./src", esModuleInterop: true }, include: ["src/**/*"] }, null, 2),
      "src/index.ts": `import express from "express";\nimport cors from "cors";\nconst app = express();\napp.use(cors()); app.use(express.json());\napp.get("/health", (_req, res) => res.json({ status: "ok" }));\napp.listen(3001, () => console.log("API on :3001"));\n`,
      "prisma/schema.prisma": `generator client { provider = "prisma-client-js" }\ndatasource db { provider = "sqlite"; url = env("DATABASE_URL") }\nmodel User { id Int @id @default(autoincrement()) email String @unique name String? }\n`,
      ".env": `DATABASE_URL=file:./api.db\nJWT_SECRET=change-me\n`,
      ".gitignore": `node_modules/\ndist/\n*.db\n`,
    },
  },
  {
    id: "dev-monorepo", name: "Monorepo", emoji: "📦", description: "Turborepo + pnpm workspaces.", kind: "node",
    files: {
      "package.json": JSON.stringify({ name: "monorepo", private: true, scripts: { build: "turbo build", dev: "turbo dev", lint: "turbo lint", test: "turbo test" }, devDependencies: { turbo: "^2.0.0", typescript: "^5.0.0" }, packageManager: "pnpm@9.0.0" }, null, 2),
      "turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**", ".next/**"] }, dev: { cache: false, persistent: true }, lint: {}, test: {} } }, null, 2),
      "pnpm-workspace.yaml": `packages:\n  - "apps/*"\n  - "packages/*"\n`,
      "apps/web/package.json": JSON.stringify({ name: "@monorepo/web", version: "0.0.0", scripts: { dev: "next dev", build: "next build" }, dependencies: { next: "^16.0.0", react: "^19.0.0", "@monorepo/ui": "workspace:*" } }, null, 2),
      "apps/web/src/app/page.tsx": `import { Button } from "@monorepo/ui";\nexport default function Home() { return <Button>Hello</Button>; }\n`,
      "packages/ui/package.json": JSON.stringify({ name: "@monorepo/ui", version: "0.0.0", main: "./src/index.ts" }, null, 2),
      "packages/ui/src/index.ts": `export function Button({ children }: { children: React.ReactNode }) { return <button className="rounded bg-emerald-600 px-4 py-2 text-white">{children}</button>; }\n`,
      ".gitignore": `node_modules/\n.next/\n.turbo/\n`,
    },
  },
  {
    id: "dev-cli-tool", name: "CLI Tool", emoji: "⚡", description: "TypeScript CLI with Commander + tests.", kind: "node",
    files: {
      "package.json": JSON.stringify({ name: "my-cli", version: "1.0.0", bin: { "my-cli": "./dist/index.js" }, scripts: { dev: "tsx src/index.ts", build: "tsc && chmod +x dist/index.js", test: "vitest run" }, dependencies: { commander: "^12.0.0", chalk: "^5.3.0" }, devDependencies: { tsx: "^4.0.0", typescript: "^5.0.0", vitest: "^3.0.0" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", strict: true, module: "esnext", moduleResolution: "bundler", outDir: "./dist", rootDir: "./src" }, include: ["src/**/*"] }, null, 2),
      "src/index.ts": `#!/usr/bin/env node\nimport { Command } from "commander";\nimport chalk from "chalk";\nconst program = new Command();\nprogram.name("my-cli").version("1.0.0");\nprogram.command("hello").argument("<name>").action((name: string) => console.log(chalk.green(\`Hello, \${name}!\`)));\nprogram.parse();\n`,
      ".gitignore": `node_modules/\ndist/\n`,
    },
  },
  {
    id: "dev-agent-workspace", name: "Agent Workspace", emoji: "🤖", description: "Pre-configured for AI agent development. AGENT_LOG.md + TASKS.md + multi-session.", kind: "node",
    files: {
      "package.json": JSON.stringify({ name: "agent-workspace", version: "0.1.0", private: true, scripts: { dev: "next dev -p 3000", build: "next build", lint: "eslint .", test: "vitest run" }, dependencies: { next: "^16.1.0", react: "^19.0.0", "react-dom": "^19.0.0" }, devDependencies: { typescript: "^5.0.0", "@types/react": "^19.0.0", eslint: "^9.0.0", "eslint-config-next": "^16.1.0", vitest: "^3.0.0" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2020", strict: true, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", paths: { "@/*": ["./src/*"] }, noEmit: true }, include: ["**/*.ts", "**/*.tsx"] }, null, 2),
      "next.config.ts": `import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { reactStrictMode: false };\nexport default nextConfig;\n`,
      ".env": `# Agent workspace configuration\n`,
      ".gitignore": `node_modules/\n.next/\ndist/\n*.db\n`,
      "AGENT_LOG.md": `# Agent Session Log\n\n### Session: init\n- Task: Initialize agent workspace\n- Status: completed\n`,
      "TASKS.md": `# Task Queue\n\n- [ ] Set up database schema\n- [ ] Add authentication\n- [ ] Create API routes\n- [ ] Write tests\n`,
      "src/app/layout.tsx": `export const metadata = { title: "Agent Workspace" };\nexport default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n`,
      "src/app/page.tsx": `export default function Home() { return <main className="flex min-h-screen items-center justify-center p-8"><div className="max-w-2xl space-y-4"><h1 className="text-3xl font-bold">🤖 Agent Workspace</h1><p className="text-gray-600">Pre-configured for AI-assisted development.</p></div></main>; }\n`,
      "src/app/global-error.tsx": `'use client'\nexport default function GlobalError({ error, reset }: { error: Error; reset: () => void }) { return <html><body><h2>Something went wrong!</h2><button onClick={() => reset()}>Try again</button></body></html>; }\n`,
      "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { environment: "jsdom" } });\n`,
    },
  },
  {
    id: "dev-component-lib", name: "Component Library", emoji: "🎨", description: "React component library with Tailwind + tests.", kind: "node",
    files: {
      "package.json": JSON.stringify({ name: "my-ui-lib", version: "0.1.0", main: "./dist/index.js", types: "./dist/index.d.ts", scripts: { build: "tsc", test: "vitest run" }, peerDependencies: { react: "^19.0.0" }, devDependencies: { react: "^19.0.0", typescript: "^5.0.0", vitest: "^3.0.0" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2020", strict: true, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", outDir: "./dist", declaration: true }, include: ["src/**/*"] }, null, 2),
      "src/index.ts": `export { Button } from "./button";\nexport { Card } from "./card";\n`,
      "src/button.tsx": `export function Button({ children }: { children: React.ReactNode }) { return <button className="rounded-md bg-emerald-600 px-4 py-2 text-white">{children}</button>; }\n`,
      "src/card.tsx": `export function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-lg border p-6">{children}</div>; }\n`,
      ".gitignore": `node_modules/\ndist/\n`,
    },
  },
];
