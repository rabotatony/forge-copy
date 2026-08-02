// ============================================================
// Forge — public surface (barrel)
// ============================================================
// Re-exports the modules that callers need to import from
// `@/lib/forge`. Internal modules (engine, pipeline, custom-workflow,
// triggers, cleanup, scheduler, bootstrap) are imported directly from
// their own files to avoid pulling their side-effects into callers
// that only need the static utilities.
// ============================================================
export * from "./storage";
export * from "./detector";
export * from "./workflows";
export * from "./zip";
export * from "./secrets";
export * from "./cache";
export * from "./types";
export * from "./categories";
export * from "./presets";
export * from "./templates-projects";
export * from "./marketplace";
export * from "./analytics";
export * from "./auth";
export * from "./i18n";
export * from "./intelligence";
export * from "./router";
export * from "./test-report";
export * from "./notifications";
export * from "./fs-utils";
export * from "./matrix";
export * from "./child-runner";
export * from "./response";

// `./git` and `./security` both export `containsShellMetacharacters`.
// Import them with explicit named exports to avoid the collision.
export {
  runGit,
  pullRepo,
  fetchRepo,
  checkoutBranch,
  cloneRepo,
  listBranches,
  gitLog,
  gitStatus,
  isGitRepo,
  detectProvider,
  validateGitUrl,
  validateGitBranch,
  type GitResult,
  type GitProvider,
  type FileChange,
  type GitStatus,
  type BranchInfo,
  type GitLogEntry,
  type CloneOptions,
  type GitOperationOptions,
  type GitLogOptions,
} from "./git";
export {
  isForbiddenUrl,
  FORBIDDEN_URL_PATTERNS,
  containsShellMetacharacters,
} from "./security";

// Unified public surfaces (Task R-1):
//   • `./templates`         — one type layer + query API for all four
//                              catalog kinds (workflows, presets,
//                              marketplace, project templates).
//   • `./intent`            — one entry point for the full detect →
//                              infer → recommend pipeline, including
//                              the `analyzeProject(rootDir)` convenience.
//   • `./workflow-plugins`  — plugin registry for non-shell workflows
//                              (parse / bundle are registered by
//                              `./axiomstate-plugin`).
export * from "./templates";
export * from "./intent";
export * from "./workflow-plugins";

// Engine + lifecycle (side-effect-free on import — bootstrap is
// responsible for starting timers).
export {
  subscribe,
  emit,
  appendLog,
  startRun,
  startRunExtended,
  cancelRun,
  approveRun,
  rejectRun,
  finishRun,
  expandMatrix,
  type RunStatus,
  type RunEvent,
  type RunOptions,
} from "./engine";

// Pipeline + custom-workflow (kept lazy by callers that need them).
export {
  validatePipelineDefinition,
  createPipeline,
  listPipelines,
  getPipeline,
  deletePipeline,
  listPipelineRuns,
  executePipeline,
  startPipelineRun,
  getPipelineRun,
  cancelPipelineRun,
} from "./pipeline";

export {
  parseCustomWorkflow,
  validateCustomWorkflow,
  saveCustomWorkflow,
  runCustomWorkflow,
} from "./custom-workflow";

// Triggers (webhook + cron). The cron scheduler is started by
// `bootstrap.ts` — importing this module does NOT auto-start it.
export {
  createWebhookTrigger,
  verifyWebhookSignature,
  fireWebhookTrigger,
  createCronTrigger,
  validateCronExpression,
  isCronDue,
  listTriggers,
  deleteTrigger,
  listWebhookDeliveries,
  getCronTriggers,
  startCronScheduler,
} from "./triggers";
