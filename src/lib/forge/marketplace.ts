// ============================================================
// Forge — workflow marketplace catalog
// ============================================================
// A browsable catalog of community workflow templates that users can
// import into their projects as CustomWorkflows. Each template is a
// self-contained { name, description, steps, env? } payload that maps
// 1:1 onto the import route at:
//   POST /api/forge/projects/[id]/custom-workflows/import
//   body: { workflow: { name, description?, steps, env? } }
//
// The catalog is purely static — there is no DB row per template — so
// listing is cheap and predictable. Templates are grouped by
// `category` (Build, Test, Deploy, Security, Utility) and tagged with
// a `language` for filtering.
//
// Accent color convention across the marketplace UI is emerald
// (matches the rest of Forge); never indigo or blue.
// ============================================================

/** Marketplace workflow categories. */
export type MarketplaceCategory =
  | 'Build'
  | 'Test'
  | 'Deploy'
  | 'Security'
  | 'Utility';

/** A single shell step inside a marketplace template. */
export interface MarketplaceStep {
  name: string;
  run: string;
}

/** A community workflow template. */
export interface MarketplaceWorkflow {
  id: string;
  name: string;
  emoji: string;
  description: string;
  category: MarketplaceCategory;
  language: string;
  steps: MarketplaceStep[];
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Catalog — 40 templates across 5 categories
// ---------------------------------------------------------------------------

export const MARKETPLACE_WORKFLOWS: readonly MarketplaceWorkflow[] = [
  // --- Build ---
  {
    id: 'nextjs-build',
    name: 'Next.js Build',
    emoji: '▲',
    description:
      'Install dependencies and produce a production build of a Next.js app. Caches npm to speed up repeat builds.',
    category: 'Build',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'npm run build' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'react-build',
    name: 'React Build',
    emoji: '⚛️',
    description:
      'Vite-powered production build for a React SPA. Outputs static assets to dist/ ready to serve.',
    category: 'Build',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'npm run build' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'vue-build',
    name: 'Vue Build',
    emoji: '💚',
    description:
      'Compile a Vue 3 project with Vite into optimized static assets.',
    category: 'Build',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'npm run build' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'python-package',
    name: 'Python Package',
    emoji: '🐍',
    description:
      'Build a Python package wheel and sdist using build. Validates the resulting artifact with twine check.',
    category: 'Build',
    language: 'Python',
    steps: [
      { name: 'Install build tools', run: 'pip install --upgrade build twine' },
      { name: 'Build distributions', run: 'python -m build' },
      { name: 'Check distributions', run: 'twine check dist/*' },
    ],
  },

  // --- Test ---
  {
    id: 'jest-tests',
    name: 'Jest Tests',
    emoji: '🃏',
    description:
      'Run the Jest test suite with CI mode enabled (no watch, coverage optional).',
    category: 'Test',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run tests', run: 'npx jest --ci --colors' },
    ],
    env: { CI: 'true' },
  },
  {
    id: 'pytest',
    name: 'Pytest',
    emoji: '🧪',
    description:
      'Install requirements then run the pytest suite with verbose output and a short test trace.',
    category: 'Test',
    language: 'Python',
    steps: [
      { name: 'Install requirements', run: 'pip install -r requirements.txt' },
      { name: 'Install pytest', run: 'pip install pytest' },
      { name: 'Run tests', run: 'pytest -v' },
    ],
  },
  {
    id: 'go-tests',
    name: 'Go Tests',
    emoji: '🐹',
    description:
      'Run the Go test suite with the race detector enabled and print verbose output.',
    category: 'Test',
    language: 'Go',
    steps: [
      { name: 'Tidy modules', run: 'go mod tidy' },
      { name: 'Vet', run: 'go vet ./...' },
      { name: 'Test with race detector', run: 'go test -race -v ./...' },
    ],
  },

  // --- Deploy ---
  {
    id: 'docker-push',
    name: 'Docker Push',
    emoji: '🐳',
    description:
      'Build a Docker image, tag it, and push it to a registry. Requires DOCKER_USERNAME and DOCKER_PASSWORD secrets.',
    category: 'Deploy',
    language: 'Docker',
    steps: [
      { name: 'Build image', run: 'docker build -t $DOCKER_USERNAME/app:latest .' },
      { name: 'Login to registry', run: 'echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin' },
      { name: 'Push image', run: 'docker push $DOCKER_USERNAME/app:latest' },
    ],
  },
  {
    id: 'vercel-deploy',
    name: 'Vercel Deploy',
    emoji: '▲',
    description:
      'Deploy the current project to Vercel using the Vercel CLI. Requires VERCEL_TOKEN secret.',
    category: 'Deploy',
    language: 'JavaScript',
    steps: [
      { name: 'Install Vercel CLI', run: 'npm i -g vercel' },
      { name: 'Deploy', run: 'vercel --prod --yes --token "$VERCEL_TOKEN"' },
    ],
  },
  {
    id: 'netlify-deploy',
    name: 'Netlify Deploy',
    emoji: '🌐',
    description:
      'Deploy the dist/ directory to Netlify via the Netlify CLI. Requires NETLIFY_AUTH_TOKEN secret.',
    category: 'Deploy',
    language: 'JavaScript',
    steps: [
      { name: 'Install Netlify CLI', run: 'npm i -g netlify-cli' },
      { name: 'Deploy', run: 'netlify deploy --prod --dir=dist' },
    ],
  },

  // --- Security ---
  {
    id: 'npm-audit-fix',
    name: 'npm Audit + Fix',
    emoji: '🛡️',
    description:
      'Run npm audit and automatically apply safe fixes. Reports remaining vulnerabilities.',
    category: 'Security',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Audit', run: 'npm audit' },
      { name: 'Apply safe fixes', run: 'npm audit --fix' },
    ],
  },
  {
    id: 'pip-audit',
    name: 'pip Audit',
    emoji: '🔍',
    description:
      'Install pip-audit and scan installed dependencies against the PyPI advisory database.',
    category: 'Security',
    language: 'Python',
    steps: [
      { name: 'Install pip-audit', run: 'pip install pip-audit' },
      { name: 'Install requirements', run: 'pip install -r requirements.txt' },
      { name: 'Audit dependencies', run: 'pip-audit' },
    ],
  },

  // --- Utility ---
  {
    id: 'generate-docs',
    name: 'Generate Docs',
    emoji: '📚',
    description:
      'Generate static documentation from source comments and place the output in the docs/ directory.',
    category: 'Utility',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Generate docs', run: 'npm run docs' },
    ],
  },
  {
    id: 'clean-cache',
    name: 'Clean Cache',
    emoji: '🧹',
    description:
      'Remove build artifacts and dependency caches to free disk space and force a clean rebuild.',
    category: 'Utility',
    language: 'Shell',
    steps: [
      { name: 'Remove node_modules', run: 'rm -rf node_modules' },
      { name: 'Remove build output', run: 'rm -rf dist build .next out' },
      { name: 'Clear npm cache', run: 'npm cache clean --force' },
    ],
  },
  // --- Build (extended) ---
  {
    id: 'svelte-build',
    name: 'SvelteKit Build',
    emoji: '🧡',
    description: 'Production build for a SvelteKit app with adapter-node.',
    category: 'Build',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'npm run build' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'angular-build',
    name: 'Angular Build',
    emoji: '🅰️',
    description: 'Production build for an Angular project.',
    category: 'Build',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'ng build --configuration production' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'rust-build',
    name: 'Rust Build',
    emoji: '🦀',
    description: 'Compile a Rust project in release mode.',
    category: 'Build',
    language: 'Rust',
    steps: [
      { name: 'Build release', run: 'cargo build --release' },
    ],
  },
  {
    id: 'go-build',
    name: 'Go Build',
    emoji: '🐹',
    description: 'Compile a Go binary for Linux amd64.',
    category: 'Build',
    language: 'Go',
    steps: [
      { name: 'Build binary', run: 'CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app ./cmd/server' },
    ],
  },
  {
    id: 'swift-build',
    name: 'Swift Build',
    emoji: '🐦',
    description: 'Build a Swift Package executable in release configuration.',
    category: 'Build',
    language: 'Swift',
    steps: [
      { name: 'Build release', run: 'swift build -c release' },
    ],
  },
  // --- Test (extended) ---
  {
    id: 'vitest',
    name: 'Vitest',
    emoji: '⚡',
    description: 'Run Vitest unit tests with coverage reporting.',
    category: 'Test',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run tests with coverage', run: 'npx vitest run --coverage' },
    ],
  },
  {
    id: 'mocha-tests',
    name: 'Mocha Tests',
    emoji: '☕',
    description: 'Run Mocha test suite with Chai assertions.',
    category: 'Test',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run tests', run: 'npx mocha --reporter spec' },
    ],
  },
  {
    id: 'cypress-e2e',
    name: 'Cypress E2E',
    emoji: '🌊',
    description: 'End-to-end browser testing with Cypress.',
    category: 'Test',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run Cypress', run: 'npx cypress run --headless' },
    ],
  },
  {
    id: 'playwright-tests',
    name: 'Playwright Tests',
    emoji: '🎭',
    description: 'Cross-browser E2E testing with Playwright.',
    category: 'Test',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Install browsers', run: 'npx playwright install --with-deps' },
      { name: 'Run tests', run: 'npx playwright test' },
    ],
  },
  {
    id: 'rspec-tests',
    name: 'RSpec Tests',
    emoji: '💎',
    description: 'Run Ruby RSpec test suite.',
    category: 'Test',
    language: 'Ruby',
    steps: [
      { name: 'Install dependencies', run: 'bundle install' },
      { name: 'Run tests', run: 'bundle exec rspec --format documentation' },
    ],
  },
  {
    id: 'junit-tests',
    name: 'JUnit Tests',
    emoji: '☕',
    description: 'Run Java JUnit tests with Maven.',
    category: 'Test',
    language: 'Java',
    steps: [
      { name: 'Run tests', run: 'mvn test' },
    ],
  },
  // --- Deploy (extended) ---
  {
    id: 'cloudflare-pages',
    name: 'Cloudflare Pages',
    emoji: '☁️',
    description: 'Deploy a static site to Cloudflare Pages using Wrangler CLI.',
    category: 'Deploy',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Build', run: 'npm run build' },
      { name: 'Deploy', run: 'npx wrangler pages deploy dist' },
    ],
    env: { NODE_ENV: 'production' },
  },
  {
    id: 'fly-deploy',
    name: 'Fly.io Deploy',
    emoji: '✈️',
    description: 'Deploy a containerized app to Fly.io.',
    category: 'Deploy',
    language: 'Shell',
    steps: [
      { name: 'Deploy', run: 'flyctl deploy --remote-only' },
    ],
  },
  {
    id: 'railway-deploy',
    name: 'Railway Deploy',
    emoji: '🚂',
    description: 'Deploy to Railway.app using the Railway CLI.',
    category: 'Deploy',
    language: 'Shell',
    steps: [
      { name: 'Deploy', run: 'railway up' },
    ],
  },
  {
    id: 'aws-s3-deploy',
    name: 'AWS S3 Deploy',
    emoji: '🪣',
    description: 'Sync static files to an S3 bucket for static hosting.',
    category: 'Deploy',
    language: 'Shell',
    steps: [
      { name: 'Build', run: 'npm run build' },
      { name: 'Sync to S3', run: 'aws s3 sync dist/ s3://$S3_BUCKET --delete' },
    ],
  },
  {
    id: 'gcp-cloud-run',
    name: 'GCP Cloud Run',
    emoji: '☁️',
    description: 'Build and deploy a container to Google Cloud Run.',
    category: 'Deploy',
    language: 'Shell',
    steps: [
      { name: 'Build container', run: 'gcloud builds submit --tag gcr.io/$PROJECT_ID/app' },
      { name: 'Deploy', run: 'gcloud run deploy app --image gcr.io/$PROJECT_ID/app --platform managed' },
    ],
  },
  // --- Security (extended) ---
  {
    id: 'snyk-scan',
    name: 'Snyk Scan',
    emoji: '🛡️',
    description: 'Run Snyk vulnerability scan on dependencies.',
    category: 'Security',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run Snyk', run: 'npx snyk test --severity-threshold=high' },
    ],
  },
  {
    id: 'trivy-scan',
    name: 'Trivy Scan',
    emoji: '🔍',
    description: 'Scan container images and filesystems for vulnerabilities with Trivy.',
    category: 'Security',
    language: 'Shell',
    steps: [
      { name: 'Run Trivy', run: 'trivy fs --severity HIGH,CRITICAL .' },
    ],
  },
  {
    id: 'secret-scan',
    name: 'Secret Scan',
    emoji: '🔐',
    description: 'Scan for hardcoded secrets and API keys using truffleHog.',
    category: 'Security',
    language: 'Shell',
    steps: [
      { name: 'Run truffleHog', run: 'trufflehog filesystem --directory . --fail' },
    ],
  },
  {
    id: 'eslint-security',
    name: 'ESLint Security',
    emoji: '🔒',
    description: 'Run eslint-plugin-security to detect unsafe patterns.',
    category: 'Security',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Run ESLint security', run: 'npx eslint . --ext .js,.ts --plugin security' },
    ],
  },
  {
    id: 'bandit-scan',
    name: 'Bandit Scan',
    emoji: '🐍',
    description: 'Run Bandit security linter on Python code.',
    category: 'Security',
    language: 'Python',
    steps: [
      { name: 'Install Bandit', run: 'pip install bandit' },
      { name: 'Run scan', run: 'bandit -r . -f json -o bandit-report.json' },
    ],
  },
  // --- Utility (extended) ---
  {
    id: 'minify-assets',
    name: 'Minify Assets',
    emoji: '📦',
    description: 'Minify JavaScript and CSS files for production.',
    category: 'Utility',
    language: 'JavaScript',
    steps: [
      { name: 'Install terser', run: 'npm install -g terser clean-css-cli' },
      { name: 'Minify JS', run: 'terser src/*.js --compress --mangle --output dist/minified/app.js' },
      { name: 'Minify CSS', run: 'cleancss -o dist/minified/style.css src/*.css' },
    ],
  },
  {
    id: 'bundle-analyze',
    name: 'Bundle Analyze',
    emoji: '📊',
    description: 'Analyze webpack bundle size and composition.',
    category: 'Utility',
    language: 'JavaScript',
    steps: [
      { name: 'Install dependencies', run: 'npm ci' },
      { name: 'Analyze bundle', run: 'npx webpack-bundle-analyzer dist/stats.json' },
    ],
  },
  {
    id: 'lighthouse-audit',
    name: 'Lighthouse Audit',
    emoji: '🏗️',
    description: 'Run Google Lighthouse performance audit on a deployed URL.',
    category: 'Utility',
    language: 'JavaScript',
    steps: [
      { name: 'Run Lighthouse', run: 'npx lighthouse $AUDIT_URL --output html --output-path lighthouse-report.html --only-categories performance' },
    ],
  },
  {
    id: 'sitemap-gen',
    name: 'Sitemap Generator',
    emoji: '🗺️',
    description: 'Generate a sitemap.xml from a deployed website URL for SEO.',
    category: 'Utility',
    language: 'JavaScript',
    steps: [
      { name: 'Generate sitemap', run: 'npx sitemap-generator $SITE_URL --filename sitemap.xml --verbose' },
    ],
  },
  {
    id: 'db-backup',
    name: 'Database Backup',
    emoji: '💾',
    description: 'Create a timestamped PostgreSQL database backup and compress it.',
    category: 'Utility',
    language: 'Shell',
    steps: [
      { name: 'Create backup', run: 'pg_dump $DATABASE_URL | gzip > backup-$(date +%Y%m%d).sql.gz' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the unique categories present in the marketplace catalog,
 * in the canonical order: Build → Test → Deploy → Security → Utility.
 */
export function categories(): MarketplaceCategory[] {
  const seen = new Set<MarketplaceCategory>();
  const order: MarketplaceCategory[] = ['Build', 'Test', 'Deploy', 'Security', 'Utility'];
  for (const wf of MARKETPLACE_WORKFLOWS) seen.add(wf.category);
  // Preserve canonical ordering; only include categories that actually appear.
  return order.filter((c) => seen.has(c));
}
