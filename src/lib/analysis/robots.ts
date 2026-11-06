// robots.txt support (RFC 9309): user-agent groups, Allow/Disallow with * and $ wildcards,
// longest-match precedence, crawl-delay and sitemaps.
import { safeFetch } from "./net";

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}
interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

export interface Robots {
  checked: boolean;
  isAllowed(url: string): boolean;
  crawlDelay?: number;
  sitemaps: string[];
}

function toRegex(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const esc = p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + esc + (anchored ? "$" : ""));
}

export function parseRobots(text: string, agentToken: string): Omit<Robots, "checked"> {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (!value) continue; // empty Disallow = allow everything
      current.rules.push({ allow: key === "allow", pattern: value, regex: toRegex(value) });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  const token = agentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const crawlDelay = chosen.find((g) => g.crawlDelay !== undefined)?.crawlDelay;
  return {
    sitemaps,
    crawlDelay,
    isAllowed(url: string) {
      let path: string;
      try {
        const u = new URL(url);
        path = u.pathname + u.search;
      } catch {
        return false;
      }
      if (path === "/robots.txt") return true;
      let best: Rule | null = null;
      for (const r of rules) {
        if (r.regex.test(path)) {
          if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export async function fetchRobots(origin: string, agentToken: string): Promise<Robots> {
  try {
    const res = await safeFetch(new URL("/robots.txt", origin).toString(), {
      headers: { "user-agent": `${agentToken}/1.0` },
      maxBytes: 500_000,
      timeoutMs: 10_000,
    });
    if (res.status >= 500) {
      // RFC 9309: unreachable robots.txt (5xx) means assume complete disallow.
      return { checked: true, sitemaps: [], isAllowed: () => false };
    }
    if (res.status >= 400) return { checked: true, sitemaps: [], isAllowed: () => true };
    return { checked: true, ...parseRobots(res.body.toString("utf8"), agentToken) };
  } catch {
    // Network failure fetching robots.txt: proceed, the page load itself will surface errors.
    return { checked: false, sitemaps: [], isAllowed: () => true };
  }
}
