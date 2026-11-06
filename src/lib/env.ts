// Centralised, typed access to configuration. Server-only.
function bool(v: string | undefined, d: boolean) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function int(v: string | undefined, d: number) {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
}

export const env = {
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "postgres://tessera:tessera@localhost:5432/tessera";
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get sessionSecret() {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (>= 32 chars)");
      return "dev-insecure-session-secret-change-me-please-0000";
    }
    return s;
  },
  get secureCookies() {
    return bool(process.env.SECURE_COOKIES, (process.env.APP_URL ?? "").startsWith("https://"));
  },
  // --- AI -------------------------------------------------------------------
  get anthropicConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  },
  get claudeModel() {
    return process.env.CLAUDE_MODEL || "claude-opus-5-5";
  },
  get effortGenerate() {
    return (process.env.CLAUDE_EFFORT_GENERATE || "high") as "low" | "medium" | "high" | "xhigh" | "max";
  },
  get effortChat() {
    return (process.env.CLAUDE_EFFORT_CHAT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
  },
  get maxAgentTurns() {
    return int(process.env.AGENT_MAX_TURNS, 80);
  },
  // --- Storage ----------------------------------------------------------------
  get storageDriver() {
    return (process.env.STORAGE_DRIVER || "local") as "local" | "s3";
  },
  get storageLocalDir() {
    return process.env.STORAGE_LOCAL_DIR || ".data/storage";
  },
  s3: {
    get bucket() { return process.env.S3_BUCKET || ""; },
    get region() { return process.env.S3_REGION || "auto"; },
    get endpoint() { return process.env.S3_ENDPOINT || undefined; },
    get accessKeyId() { return process.env.S3_ACCESS_KEY_ID || ""; },
    get secretAccessKey() { return process.env.S3_SECRET_ACCESS_KEY || ""; },
    get forcePathStyle() { return bool(process.env.S3_FORCE_PATH_STYLE, false); },
  },
  // --- Media providers --------------------------------------------------------
  get unsplashKey() { return process.env.UNSPLASH_ACCESS_KEY || ""; },
  get pexelsKey() { return process.env.PEXELS_API_KEY || ""; },
  get openaiKey() { return process.env.OPENAI_API_KEY || ""; },
  get replicateToken() { return process.env.REPLICATE_API_TOKEN || ""; },
  get imageGenProvider() {
    const p = process.env.IMAGE_GEN_PROVIDER;
    if (p === "openai" || p === "replicate") return p;
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.REPLICATE_API_TOKEN) return "replicate";
    return null;
  },
  // --- Crawler ----------------------------------------------------------------
  get crawlerUserAgentToken() { return process.env.CRAWLER_BOT_TOKEN || "TesseraBot"; },
  get crawlerUserAgent() { return process.env.CRAWLER_USER_AGENT || ""; },
  get respectRobots() { return bool(process.env.CRAWLER_RESPECT_ROBOTS, true); },
  get chromiumPath() { return process.env.CHROMIUM_EXECUTABLE_PATH || undefined; },
  get allowPrivateHosts() { return bool(process.env.CRAWLER_ALLOW_PRIVATE_HOSTS, process.env.NODE_ENV !== "production"); },
  get maxPagesCap() { return int(process.env.CRAWLER_MAX_PAGES_CAP, 20); },
  // --- Worker -----------------------------------------------------------------
  get workerConcurrency() { return int(process.env.WORKER_CONCURRENCY, 2); },
  // --- Publishing -------------------------------------------------------------
  get publicSitesOrigin() { return (process.env.PUBLIC_SITES_ORIGIN || "").replace(/\/$/, ""); },
};

export function capabilities() {
  return {
    ai: env.anthropicConfigured,
    model: env.claudeModel,
    stockImages: Boolean(env.unsplashKey || env.pexelsKey),
    imageGeneration: env.imageGenProvider,
    storage: env.storageDriver,
  };
}
