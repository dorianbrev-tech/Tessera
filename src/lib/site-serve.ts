// Serving generated sites (preview + published): URL rewriting so root-relative links
// work under a path prefix, the preview bridge script, and security headers.

const ATTR_RE = /(\s(?:href|src|action|poster|data-src|data-href|data-bg|data-background|formaction)\s*=\s*)(["'])\/(?!\/)/gi;
const SRCSET_RE = /(\s(?:srcset|data-srcset|imagesrcset)\s*=\s*)(["'])((?:(?!\2).)*)\2/gi;
const CSS_URL_RE = /url\(\s*(['"]?)\/(?!\/)/gi;
const CSS_IMPORT_RE = /@import\s+(['"])\/(?!\/)/gi;

export function rewriteCss(css: string, prefix: string) {
  return css.replace(CSS_URL_RE, (_m, q) => `url(${q}${prefix}/`).replace(CSS_IMPORT_RE, (_m, q) => `@import ${q}${prefix}/`);
}

export function rewriteHtml(html: string, prefix: string, opts: { inject?: string; noindex?: boolean } = {}) {
  let out = html
    .replace(ATTR_RE, (_m, a, q) => `${a}${q}${prefix}/`)
    .replace(SRCSET_RE, (_m, a, q, list: string) => {
      const rewritten = list
        .split(",")
        .map((part) => part.replace(/^(\s*)\/(?!\/)/, `$1${prefix}/`))
        .join(",");
      return `${a}${q}${rewritten}${q}`;
    })
    .replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => open + rewriteCss(css, prefix) + close)
    // Quote-aware: a double-quoted style may contain single quotes (url('/x.jpg')) and vice versa.
    .replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_m, a, dq, sq) =>
      dq !== undefined ? `${a}"${rewriteCss(dq, prefix)}"` : `${a}'${rewriteCss(sq, prefix)}'`,
    );
  const head = [opts.noindex ? '<meta name="robots" content="noindex, nofollow">' : "", opts.inject ?? ""].join("");
  if (head) {
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, (m) => m + head);
    else out = head + out;
  }
  return out;
}

/** Injected into previews: reports navigation and runtime errors to the workspace. */
export function previewBridge(prefix: string) {
  const p = JSON.stringify(prefix);
  return `<script>(function(){var PFX=${p};function send(t,d){try{d=d||{};d.source="tessera-preview";d.type=t;parent.postMessage(d,"*")}catch(e){}}
function loc(){send("location",{path:(location.pathname.indexOf(PFX)===0?location.pathname.slice(PFX.length):location.pathname)||"/",hash:location.hash,title:document.title})}
loc();addEventListener("hashchange",loc);addEventListener("DOMContentLoaded",loc);
addEventListener("error",function(e){if(e&&e.target&&e.target!==window&&e.target.tagName){send("error",{message:"Failed to load "+(e.target.src||e.target.href||e.target.tagName)});return}send("error",{message:String(e.message||e),file:e.filename,line:e.lineno})},true);
addEventListener("unhandledrejection",function(e){send("error",{message:"Unhandled promise rejection: "+(e.reason&&e.reason.message||e.reason)})});
var ce=console.error;console.error=function(){try{send("error",{message:Array.prototype.map.call(arguments,function(a){return a&&a.message?a.message:String(a)}).join(" ")})}catch(_){}return ce.apply(console,arguments)};
addEventListener("message",function(e){if(e.data&&e.data.source==="tessera-workspace"&&e.data.type==="scroll"){scrollTo(0,e.data.y||0)}});
})();</script>`;
}

/**
 * Generated code runs in an opaque origin (CSP sandbox without allow-same-origin), so it
 * can never read the platform's cookies or call its APIs as the signed-in user.
 */
export function sandboxHeaders(isHtml: boolean, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Referrer-Policy": "no-referrer",
    ...extra,
  };
  if (isHtml) h["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
  return h;
}

export function notFoundPage(path: string, pages: string[], prefix: string) {
  const list = pages.slice(0, 40).map((p) => `<li><a href="${prefix}/${p === "index.html" ? "" : p.replace(/\.html$/, "")}">/${p === "index.html" ? "" : p.replace(/\.html$/, "")}</a></li>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Not found</title><style>body{font:15px/1.6 system-ui,sans-serif;background:#0b0b0c;color:#e8e8ea;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:520px;padding:32px}a{color:#9ab4ff}code{background:#1b1b1f;padding:2px 6px;border-radius:4px}</style><main><h1 style="font-weight:500">No page at <code>${path.replace(/[<>&"]/g, "")}</code></h1>${list ? `<p>Pages in this site:</p><ul>${list}</ul>` : "<p>This project has no pages yet.</p>"}</main>`;
}
