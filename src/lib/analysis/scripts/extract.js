// Runs inside the analysed page (plain JS, injected as a string). Measures the rendered
// DOM and returns a JSON-serialisable PageExtraction (minus viewport/url, added server-side).
(() => {
  const MAX_ELEMENTS = 7000;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollY = window.scrollY;
  const docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const origin = location.origin;

  // ---------- helpers ----------
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function parseColor(c) {
    if (!c) return null;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    if ([r, g, b].some((x) => !Number.isFinite(x))) return null;
    return { r, g, b, a };
  }
  const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  function toHex(c) {
    const p = parseColor(c);
    if (!p || p.a < 0.06) return null;
    if (p.a < 0.98) {
      // Flatten translucent colors over white for a stable token.
      const r = p.r * p.a + 255 * (1 - p.a), g = p.g * p.a + 255 * (1 - p.a), b = p.b * p.a + 255 * (1 - p.a);
      return "#" + hex2(r) + hex2(g) + hex2(b);
    }
    return "#" + hex2(p.r) + hex2(p.g) + hex2(p.b);
  }
  function saturation(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }
  function shortSel(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id && /^[a-zA-Z][\w-]{0,40}$/.test(el.id)) return s + "#" + el.id;
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "")
      .split(/\s+/)
      .filter((c) => c && c.length < 40 && !/^(js-|is-|has-)|\d{3,}|[:[\]/]/.test(c))
      .slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  }
  // Source text (textContent keeps authored casing; CSS text-transform is captured separately).
  function textOf(el, n) {
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, n || 120);
  }
  // Rendered text with block separation, for excerpts.
  function visibleText(el, n) {
    return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, n || 120);
  }
  function directText(el) {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, " ").trim();
  }
  function bump(map, key, w, sample) {
    if (!key) return;
    const e = map.get(key) || { count: 0, weight: 0, samples: [] };
    e.count += 1;
    e.weight += w;
    if (sample && e.samples.length < 3 && !e.samples.includes(sample)) e.samples.push(sample);
    map.set(key, e);
  }
  function topN(map, n, total) {
    return [...map.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, n)
      .map(([k, v]) => ({ hex: k, weight: total ? +(v.weight / total).toFixed(4) : v.weight, count: v.count, samples: v.samples }));
  }
  function freq(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));
  }
  const inc = (map, k, by) => k && map.set(k, (map.get(k) || 0) + (by || 1));
  const absUrl = (u) => {
    try { return new URL(u, location.href).href; } catch { return ""; }
  };
  const firstFamily = (ff) => (ff || "").split(",")[0].replace(/["']/g, "").trim();

  // ---------- walk ----------
  const all = Array.from(document.body ? document.body.querySelectorAll("*") : []).slice(0, MAX_ELEMENTS);
  const textColors = new Map(), bgColors = new Map(), borderColors = new Map(), accentColors = new Map();
  const gradients = new Map(), radii = new Map(), shadows = new Map(), borders = new Map();
  const containerWidths = new Map(), sectionPaddings = new Map(), gaps = new Map();
  const typeMap = new Map(), familyMap = new Map(), buttonMap = new Map(), transitionMap = new Map();
  const cssAnimations = [], sticky = [], bgImages = [];
  let textTotal = 0, bgTotal = 0, scrollSnap = false, marquees = 0;
  // Base canvas: the html/body background covers the whole document underneath everything.
  {
    const base = toHex(getComputedStyle(document.body).backgroundColor) || toHex(getComputedStyle(document.documentElement).backgroundColor) || "#ffffff";
    bump(bgColors, base, vw * docH, "body");
    bgTotal += vw * docH;
  }

  function roleFor(el) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return tag;
    const heading = el.closest("h1, h2, h3, h4, h5, h6");
    if (heading) return heading.tagName.toLowerCase();
    if (el.closest("nav, header")) {
      if (el.closest("a")) return "nav";
    }
    if (tag === "button" || el.closest("button") || el.getAttribute("role") === "button" || /\b(btn|button|cta)\b/i.test(el.className || "")) return "button";
    if (tag === "label" || tag === "small" || tag === "figcaption" || tag === "time") return "caption";
    if (el.closest("footer")) return "footer";
    if (tag === "a" || el.closest("a")) return "link";
    if (tag === "li" || tag === "p" || tag === "span" || tag === "div" || tag === "blockquote" || tag === "dd" || tag === "td") return "body";
    return "body";
  }

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    // Skip elements parked off-canvas (closed drawers, off-screen menus).
    if (r.bottom + scrollY <= 0 || r.right <= 0 || r.left >= vw) continue;
    const area = Math.min(r.width, vw) * Math.min(r.height, docH);
    const tag = el.tagName.toLowerCase();

    // backgrounds
    const bg = toHex(cs.backgroundColor);
    if (bg) {
      bump(bgColors, bg, area, shortSel(el));
      bgTotal += area;
      if ((tag === "a" || tag === "button") && saturation(bg) > 0.25) bump(accentColors, bg, 1, shortSel(el));
    }
    if (cs.backgroundImage && cs.backgroundImage !== "none") {
      if (cs.backgroundImage.includes("gradient(")) inc(gradients, cs.backgroundImage.slice(0, 300));
      const m = cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && r.width >= 80 && r.height >= 80 && bgImages.length < 60) {
        bgImages.push({ el, src: absUrl(m[1]), r, cs });
      }
    }
    // borders
    const bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    if (bw > 0) {
      const bc = toHex(cs.borderTopColor) || toHex(cs.borderBottomColor);
      if (bc) {
        bump(borderColors, bc, 1, shortSel(el));
        inc(borders, `${cs.borderTopWidth} ${cs.borderTopStyle} ${bc}`);
      }
    }
    if (cs.borderRadius && cs.borderRadius !== "0px") inc(radii, cs.borderRadius);
    if (cs.boxShadow && cs.boxShadow !== "none") inc(shadows, cs.boxShadow.slice(0, 200));

    // layout
    if (cs.maxWidth !== "none" && cs.maxWidth.endsWith("px") && r.width >= 320 && Math.abs(r.left + r.width / 2 - vw / 2) < 4) {
      inc(containerWidths, Math.round(parseFloat(cs.maxWidth)));
    }
    if ((cs.display.includes("flex") || cs.display.includes("grid")) && cs.gap && cs.gap !== "normal" && cs.gap !== "0px") inc(gaps, cs.gap);
    if (cs.scrollSnapType && cs.scrollSnapType !== "none") scrollSnap = true;

    // motion
    if (cs.animationName && cs.animationName !== "none" && cssAnimations.length < 40) {
      cssAnimations.push({ selector: shortSel(el), name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction, iterations: cs.animationIterationCount });
      if (cs.animationIterationCount === "infinite" && /marquee|ticker|scroll|slide/i.test(cs.animationName + " " + (el.className || ""))) marquees++;
    }
    if (cs.transitionDuration && cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) {
      const key = `${cs.transitionProperty}|${cs.transitionDuration}|${cs.transitionTimingFunction}`;
      const e = transitionMap.get(key) || { selector: shortSel(el), property: cs.transitionProperty, duration: cs.transitionDuration, timing: cs.transitionTimingFunction, count: 0 };
      e.count++;
      transitionMap.set(key, e);
    }
    if ((cs.position === "sticky" || cs.position === "fixed") && r.height > 20 && r.bottom > 0 && r.top < vh && sticky.length < 12) {
      sticky.push({ selector: shortSel(el), position: cs.position, top: cs.top, height: Math.round(r.height) });
    }

    // typography: elements carrying their own text
    const own = directText(el);
    if (own.length >= 2 && !["script", "style", "noscript", "svg", "path"].includes(tag)) {
      const role = roleFor(el);
      const fam = firstFamily(cs.fontFamily);
      const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      const key = [role, fam, size, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform, cs.fontStyle].join("|");
      const t = typeMap.get(key) || { role, fontFamily: cs.fontFamily.slice(0, 160), fontSize: size, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, fontStyle: cs.fontStyle, color: toHex(cs.color) || "", count: 0, weight: 0, sample: own.slice(0, 80) };
      t.count++;
      t.weight += own.length;
      typeMap.set(key, t);
      const fe = familyMap.get(fam) || { family: fam, count: 0, roles: new Set() };
      fe.count += own.length;
      fe.roles.add(role);
      familyMap.set(fam, fe);
      const tc = toHex(cs.color);
      if (tc) {
        bump(textColors, tc, own.length, role);
        textTotal += own.length;
        if (saturation(tc) > 0.35 && (role === "link" || role === "button" || role === "nav")) bump(accentColors, tc, 1, role);
      }
    }

    // buttons
    const isBtn = tag === "button" || el.getAttribute("role") === "button" || (tag === "input" && /submit|button/.test(el.type)) ||
      (tag === "a" && (toHex(cs.backgroundColor) || bw > 0) && r.height >= 28 && r.height <= 90 && r.width <= 480 && parseFloat(cs.paddingLeft) >= 8);
    if (isBtn && r.width >= 40) {
      const text = textOf(el, 40) || el.getAttribute("aria-label") || el.value || "";
      const key = [toHex(cs.backgroundColor) || "transparent", toHex(cs.color), cs.borderTopWidth + " " + (toHex(cs.borderTopColor) || ""), cs.borderRadius, cs.paddingTop + " " + cs.paddingLeft, cs.fontSize, cs.fontWeight, cs.textTransform].join("|");
      const b = buttonMap.get(key) || { text, tag, background: toHex(cs.backgroundColor) || "transparent", color: toHex(cs.color) || "", border: bw > 0 ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${toHex(cs.borderTopColor) || ""}` : "none", radius: cs.borderRadius, padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, count: 0 };
      b.count++;
      buttonMap.set(key, b);
    }
  }

  // ---------- fonts ----------
  const faces = [];
  const keyframes = new Set();
  const stylesheets = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) stylesheets.push(sheet.href);
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of Array.from(list || [])) {
        if (rule.type === 5 && faces.length < 60) {
          const src = rule.style.getPropertyValue("src");
          const urlM = src.match(/url\(["']?([^"')]+)["']?\)/);
          const abs = urlM ? absUrl(urlM[1]) : "";
          faces.push({
            family: rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim(),
            weight: rule.style.getPropertyValue("font-weight") || "400",
            style: rule.style.getPropertyValue("font-style") || "normal",
            src: abs,
            provider: /fonts\.gstatic|fonts\.googleapis/.test(abs) ? "google" : /typekit|use\.typekit|adobe/.test(abs) ? "adobe" : abs.startsWith(origin) ? "self-hosted" : "other",
          });
        } else if (rule.type === 7) {
          keyframes.add(rule.name);
        } else if (rule.cssRules) {
          walk(rule.cssRules);
        }
      }
    };
    walk(rules);
  }
  for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) {
    const h = link.href;
    if (/fonts\.googleapis|typekit|fonts\.bunny|fontshare/.test(h) && !stylesheets.includes(h)) stylesheets.push(h);
  }
  // FontFaceSet covers cross-origin @font-face rules we could not read.
  try {
    document.fonts.forEach((f) => {
      const fam = f.family.replace(/["']/g, "");
      if (!faces.some((x) => x.family === fam && x.weight === f.weight && x.style === f.style) && faces.length < 80) {
        faces.push({ family: fam, weight: f.weight, style: f.style, src: "", provider: "other" });
      }
    });
  } catch {}

  // ---------- navigation ----------
  const linkInfo = (a) => {
    const href = a.getAttribute("href") || "";
    const abs = absUrl(href);
    let internal = false;
    try { internal = new URL(abs).origin === origin; } catch {}
    return { text: (textOf(a, 60) || a.getAttribute("aria-label") || a.title || "").slice(0, 60), href: abs, internal };
  };
  const visibleEl = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  };
  let header = document.querySelector("header, [role=banner]");
  if (!header) {
    header = all.find((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (cs.position === "fixed" || cs.position === "sticky") && r.top <= 2 && r.width >= vw * 0.9 && r.height < 200 && el.querySelector("a");
    }) || null;
  }
  const headerLinks = header ? Array.from(header.querySelectorAll("a[href]")).filter(visibleEl).map(linkInfo).filter((l) => l.text || l.href).slice(0, 40) : [];
  let logo = null;
  if (header) {
    const home = Array.from(header.querySelectorAll("a[href]")).find((a) => { try { const u = new URL(a.href); return u.origin === origin && (u.pathname === "/" || u.pathname === ""); } catch { return false; } });
    const img = (home || header).querySelector("img, svg");
    logo = { text: home ? (home.getAttribute("aria-label") || textOf(home, 40)) : "", src: img && img.tagName.toLowerCase() === "img" ? img.currentSrc || img.src : img ? "inline-svg" : "" };
  }
  const hcs = header ? getComputedStyle(header) : null;
  const footer = document.querySelector("footer, [role=contentinfo]");
  const footerLinks = footer ? Array.from(footer.querySelectorAll("a[href]")).map(linkInfo).filter((l) => l.text).slice(0, 80) : [];
  const footerColumns = footer ? Math.max(footer.querySelectorAll("ul, ol").length, 0) : 0;
  let hamburger = false;
  if (header) {
    for (const b of header.querySelectorAll("button, [role=button], a[aria-expanded], div[aria-expanded], label")) {
      if (!visibleEl(b)) continue;
      const t = textOf(b, 30);
      const cls = (b.className && typeof b.className === "string" ? b.className : "") + " " + (b.getAttribute("aria-label") || "") + " " + (b.id || "");
      if (/menu|burger|hamburger|nav-toggle|navtoggle|toggle|open/i.test(cls) || (b.hasAttribute("aria-expanded") && t.length < 12) || (/^(menu|☰)$/i.test(t))) {
        hamburger = true;
        b.setAttribute("data-tessera-menu", "1");
        break;
      }
    }
  }
  const internalLinks = [];
  const seenLinks = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const li = linkInfo(a);
    if (!li.internal) continue;
    let key;
    try { const u = new URL(li.href); key = u.pathname.replace(/\/$/, "") || "/"; } catch { continue; }
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    internalLinks.push(li);
    if (internalLinks.length >= 300) break;
  }

  // ---------- sections ----------
  function significantChildren(root) {
    return Array.from(root.children).filter((c) => {
      const tag = c.tagName.toLowerCase();
      if (["script", "style", "noscript", "link", "template"].includes(tag)) return false;
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (cs.position === "fixed" && tag !== "header") return false;
      return r.height >= 40 && r.width >= vw * 0.5;
    });
  }
  let container = document.body;
  for (let depth = 0; depth < 8; depth++) {
    const kids = significantChildren(container);
    if (kids.length === 1 && kids[0].getBoundingClientRect().height >= container.getBoundingClientRect().height * 0.7) container = kids[0];
    else break;
  }
  let blocks = [];
  for (const k of significantChildren(container)) {
    const tag = k.tagName.toLowerCase();
    const kh = k.getBoundingClientRect().height;
    const inner = significantChildren(k);
    if ((tag === "main" || (kh > vh * 2.5 && inner.length >= 2 && tag !== "section" && tag !== "footer")) && inner.length >= 2) blocks.push(...inner);
    else blocks.push(k);
  }
  if (header && !blocks.some((b) => b === header || b.contains(header) || header.contains(b))) blocks.unshift(header);
  blocks = blocks.filter((b, i) => blocks.indexOf(b) === i).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).slice(0, 40);

  function effectiveBg(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const c = toHex(getComputedStyle(cur).backgroundColor);
      if (c) return c;
      cur = cur.parentElement;
    }
    return toHex(getComputedStyle(document.body).backgroundColor) || "#ffffff";
  }
  function columnsOf(el) {
    // Find the descendant row with the most side-by-side significant children.
    let best = 1, layout = "stack";
    const cands = [el, ...el.querySelectorAll("div, ul, ol, section, article, nav")].slice(0, 300);
    const er = el.getBoundingClientRect();
    for (const c of cands) {
      const cs = getComputedStyle(c);
      if (!(cs.display.includes("flex") || cs.display.includes("grid"))) continue;
      const cr = c.getBoundingClientRect();
      if (cr.width < er.width * 0.5) continue;
      const kids = Array.from(c.children).filter((k) => { const r = k.getBoundingClientRect(); return r.width > 60 && r.height > 30; });
      if (kids.length < 2) continue;
      const top0 = kids[0].getBoundingClientRect().top;
      const row = kids.filter((k) => Math.abs(k.getBoundingClientRect().top - top0) < 12).length;
      if (row > best) {
        best = row;
        layout = cs.display.includes("grid") ? "grid" : "flex-row";
      }
    }
    return { columns: Math.min(best, 12), layout };
  }
  const sections = blocks.map((el, index) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const imgs = el.querySelectorAll("img, picture, svg image").length + bgImages.filter((b) => el.contains(b.el)).length;
    const videos = el.querySelectorAll("video, iframe[src*=youtube], iframe[src*=vimeo]").length;
    const headings = Array.from(el.querySelectorAll("h1, h2, h3")).map((h) => textOf(h, 90)).filter(Boolean).slice(0, 4);
    const text = visibleText(el, 2000);
    const { columns, layout } = columnsOf(el);
    const hasForm = !!el.querySelector("form, input[type=email]");
    const CAROUSEL_SEL = '[class*="swiper"], [class*="slick"], [class*="carousel"], [class*="slider"], [class*="splide"], [class*="flickity"], [class*="embla"], [class*="glide"]';
    const carousel = el.matches(CAROUSEL_SEL) || !!el.querySelector(CAROUSEL_SEL) ||
      Array.from(el.querySelectorAll("*")).slice(0, 400).some((c) => { const s = getComputedStyle(c); return (s.overflowX === "auto" || s.overflowX === "scroll") && s.scrollSnapType !== "none" && c.children.length >= 3; });
    const marquee = Array.from([el, ...el.querySelectorAll("*")]).slice(0, 200).some((c) => { const s = getComputedStyle(c); return s.animationIterationCount === "infinite" && s.animationName !== "none" && /translate|marquee|ticker|scroll/i.test(s.animationName + " " + (typeof c.className === "string" ? c.className : "")); });
    let kind = "unknown";
    if (tag === "header" || el === header || el.contains(header)) kind = "header";
    else if (tag === "footer" || el === footer) kind = "footer";
    else if (tag === "nav") kind = "nav";
    else if (index <= 2 && r.height >= vh * 0.55 && (el.querySelector("h1") || imgs > 0 || videos > 0)) kind = "hero";
    else if (marquee && r.height < vh * 0.4) kind = "marquee";
    else if (hasForm) kind = "form";
    else if (carousel) kind = "carousel";
    else if (imgs >= 4 && text.length < imgs * 120) kind = "gallery";
    else if (columns >= 3) kind = "grid";
    else if (columns === 2 && imgs > 0) kind = "split";
    else if (videos > 0 || (imgs > 0 && text.length < 80)) kind = "media";
    else if (text.length > 0 && r.height < vh * 0.6 && el.querySelector("a, button")) kind = "cta";
    else if (text.length > 0) kind = "text";
    el.setAttribute("data-tessera-section", String(index));
    const bgImg = cs.backgroundImage !== "none" ? cs.backgroundImage.slice(0, 300) : (bgImages.find((b) => el.contains(b.el) && b.r.width >= r.width * 0.8)?.src || "");
    return {
      index,
      tag,
      selector: shortSel(el),
      kind,
      top: Math.round(r.top + scrollY),
      height: Math.round(r.height),
      background: effectiveBg(el),
      backgroundImage: bgImg,
      textColor: toHex(cs.color) || "",
      headings,
      excerpt: text.slice(0, 220),
      imageCount: imgs,
      videoCount: videos,
      columns,
      layout,
      fullBleed: r.width >= vw - 2,
    };
  });
  const sectionIndexOf = (el) => {
    const s = el.closest("[data-tessera-section]");
    return s ? Number(s.getAttribute("data-tessera-section")) : -1;
  };

  // ---------- media ----------
  const images = [];
  for (const img of document.querySelectorAll("img")) {
    if (images.length >= 150) break;
    const r = img.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    const cs = getComputedStyle(img);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    if (!src || src.startsWith("data:image/gif")) continue;
    images.push({
      src: src.startsWith("data:") ? src.slice(0, 80) : absUrl(src),
      alt: (img.alt || "").slice(0, 160),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      renderedWidth: Math.round(r.width),
      renderedHeight: Math.round(r.height),
      aspectRatio: r.height ? +(r.width / r.height).toFixed(3) : 0,
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
      top: Math.round(r.top + scrollY),
      kind: img.closest("picture") ? "picture" : "img",
      section: sectionIndexOf(img),
      loading: img.loading,
    });
  }
  for (const b of bgImages) {
    if (images.length >= 180) break;
    images.push({
      src: b.src, alt: "", naturalWidth: 0, naturalHeight: 0,
      renderedWidth: Math.round(b.r.width), renderedHeight: Math.round(b.r.height),
      aspectRatio: b.r.height ? +(b.r.width / b.r.height).toFixed(3) : 0,
      objectFit: b.cs.backgroundSize, objectPosition: b.cs.backgroundPosition,
      top: Math.round(b.r.top + scrollY), kind: "background", section: sectionIndexOf(b.el),
    });
  }
  const videos = [];
  for (const v of document.querySelectorAll("video")) {
    const r = v.getBoundingClientRect();
    const src = v.currentSrc || v.src || (v.querySelector("source[src]") || {}).src || "";
    videos.push({
      src: src ? absUrl(src) : "",
      poster: v.poster ? absUrl(v.poster) : "",
      autoplay: v.autoplay, muted: v.muted, loop: v.loop,
      isBackground: r.width >= vw * 0.6 && (v.muted || v.autoplay) && !v.controls,
      renderedWidth: Math.round(r.width), renderedHeight: Math.round(r.height),
      section: sectionIndexOf(v), provider: "file",
    });
  }
  const iframes = [];
  for (const f of document.querySelectorAll("iframe[src]")) {
    const r = f.getBoundingClientRect();
    if (r.width < 100) continue;
    iframes.push({ src: f.src.slice(0, 300), width: Math.round(r.width), height: Math.round(r.height) });
    if (/youtube|vimeo/.test(f.src)) {
      videos.push({ src: f.src, poster: "", autoplay: /autoplay=1/.test(f.src), muted: /mute=1|muted=1/.test(f.src), loop: /loop=1/.test(f.src), isBackground: /background=1|controls=0/.test(f.src) && r.width >= vw * 0.6, renderedWidth: Math.round(r.width), renderedHeight: Math.round(r.height), section: sectionIndexOf(f), provider: /youtube/.test(f.src) ? "youtube" : "vimeo" });
    }
  }

  // ---------- content structure ----------
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4")).map((h) => ({ level: Number(h.tagName[1]), text: textOf(h, 140) })).filter((h) => h.text).slice(0, 60);
  const paragraphs = Array.from(document.querySelectorAll("p")).map((p) => textOf(p, 320)).filter((t) => t.length > 40).slice(0, 30);
  const forms = Array.from(document.querySelectorAll("form")).slice(0, 8).map((f) => ({
    action: f.getAttribute("action") || "",
    method: (f.getAttribute("method") || "get").toLowerCase(),
    fields: Array.from(f.querySelectorAll("input, select, textarea")).filter((i) => i.type !== "hidden").slice(0, 20).map((i) => {
      const lab = (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i.closest("label");
      return { type: i.type || i.tagName.toLowerCase(), name: i.name || "", label: ((lab && textOf(lab, 60)) || i.getAttribute("aria-label") || i.placeholder || "").slice(0, 60), required: !!i.required };
    }),
  }));

  // ---------- tech & motion libraries ----------
  const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean);
  const w = window;
  const libs = new Set();
  const has = (cond, name) => { try { if (cond()) libs.add(name); } catch {} };
  const srcHas = (re) => scripts.some((s) => re.test(s));
  has(() => w.gsap || srcHas(/gsap/i), "GSAP");
  has(() => w.ScrollTrigger || srcHas(/ScrollTrigger/i), "GSAP ScrollTrigger");
  has(() => w.Lenis || w.lenis || document.documentElement.classList.contains("lenis") || srcHas(/lenis/i), "Lenis smooth scroll");
  has(() => w.LocomotiveScroll || document.querySelector("[data-scroll-container]"), "Locomotive Scroll");
  has(() => w.Swiper || document.querySelector(".swiper, .swiper-container") || srcHas(/swiper/i), "Swiper");
  has(() => w.AOS || document.querySelector("[data-aos]"), "AOS");
  has(() => w.barba || document.querySelector("[data-barba]"), "Barba.js");
  has(() => w.Splide || document.querySelector(".splide"), "Splide");
  has(() => w.Flickity || document.querySelector(".flickity-enabled"), "Flickity");
  has(() => document.querySelector(".slick-slider") || srcHas(/slick/i), "Slick");
  has(() => w.THREE || srcHas(/three(\.min)?\.js/i), "three.js");
  has(() => w.lottie || w.bodymovin || document.querySelector("lottie-player, dotlottie-player"), "Lottie");
  has(() => w.jQuery, "jQuery");
  has(() => w.Alpine || document.querySelector("[x-data]"), "Alpine.js");
  has(() => document.querySelector("[data-framer-name], [data-framer-component-type]"), "Framer");
  const framework = [];
  const fw = (cond, name) => { try { if (cond()) framework.push(name); } catch {} };
  fw(() => document.querySelector("[data-wf-page], [data-wf-site]") || w.Webflow, "Webflow");
  fw(() => w.Shopify, "Shopify");
  fw(() => document.getElementById("__next") || w.__NEXT_DATA__ || w.__next_f, "Next.js");
  fw(() => w.__NUXT__ || document.getElementById("__nuxt"), "Nuxt");
  fw(() => document.getElementById("___gatsby"), "Gatsby");
  fw(() => /wp-content|wp-includes/.test(document.documentElement.innerHTML.slice(0, 200000)), "WordPress");
  fw(() => w.Static && w.Static.SQUARESPACE_CONTEXT, "Squarespace");
  fw(() => document.querySelector("meta[name=generator][content*=Wix]"), "Wix");
  fw(() => document.querySelector("[data-reactroot]") || w.React, "React");
  fw(() => w.Vue || document.querySelector("[data-v-app]"), "Vue");
  fw(() => document.querySelector("[data-astro-cid], astro-island"), "Astro");
  const htmlCs = getComputedStyle(document.documentElement);
  const smoothScroll = htmlCs.scrollBehavior === "smooth" || libs.has("Lenis smooth scroll") || libs.has("Locomotive Scroll");
  const carousels = Array.from(document.querySelectorAll('.swiper, .swiper-container, .slick-slider, .splide, .flickity-enabled, [class*="carousel"], [class*="slider"]')).slice(0, 8).map((c) => ({
    selector: shortSel(c),
    slides: c.querySelectorAll('.swiper-slide, .slick-slide, .splide__slide, .carousel-item, [class*="slide"]').length || c.children.length,
    library: c.matches(".swiper, .swiper-container") ? "Swiper" : c.matches(".slick-slider") ? "Slick" : c.matches(".splide") ? "Splide" : c.matches(".flickity-enabled") ? "Flickity" : undefined,
  }));

  // ---------- meta ----------
  const meta = {};
  for (const m of document.querySelectorAll("meta[name], meta[property]")) {
    const k = m.getAttribute("name") || m.getAttribute("property");
    if (k && /^(description|og:|twitter:|theme-color|generator|keywords)/.test(k)) meta[k] = (m.getAttribute("content") || "").slice(0, 300);
  }
  const fav = document.querySelector('link[rel~="icon"]');

  const typography = [...typeMap.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 40)
    .sort((a, b) => b.fontSize - a.fontSize)
    .map(({ weight, ...t }) => ({ ...t, chars: weight }));

  return {
    width: vw,
    documentHeight: docH,
    title: document.title.slice(0, 200),
    description: meta.description || meta["og:description"] || "",
    lang: document.documentElement.lang || "",
    meta,
    favicon: fav ? fav.href : "",
    colors: {
      text: topN(textColors, 12, textTotal),
      background: topN(bgColors, 12, bgTotal),
      border: topN(borderColors, 8, 0),
      accent: topN(accentColors, 8, 0),
    },
    gradients: freq(gradients, 8),
    typography,
    fonts: {
      families: [...familyMap.values()].sort((a, b) => b.count - a.count).slice(0, 12).map((f) => ({ family: f.family, count: f.count, roles: [...f.roles] })),
      faces,
      stylesheets: stylesheets.slice(0, 30),
    },
    spacing: {
      containerWidths: freq(containerWidths, 8),
      sectionPaddings: (() => {
        const m = new Map();
        for (const s of blocks) { const cs = getComputedStyle(s); inc(m, `${cs.paddingTop} / ${cs.paddingBottom}`); }
        return freq(m, 8);
      })(),
      gaps: freq(gaps, 10),
    },
    radii: freq(radii, 10),
    shadows: freq(shadows, 8),
    borders: freq(borders, 8),
    buttons: [...buttonMap.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    navigation: {
      header: { links: headerLinks, position: hcs ? hcs.position : "", height: header ? Math.round(header.getBoundingClientRect().height) : 0, background: hcs ? (toHex(hcs.backgroundColor) || "transparent") : "", logo },
      footer: { links: footerLinks, columns: footerColumns },
      hamburger,
    },
    internalLinks,
    images,
    videos,
    iframes: iframes.slice(0, 12),
    sections,
    headings,
    paragraphs,
    forms,
    animations: {
      keyframes: [...keyframes].slice(0, 40),
      cssAnimations,
      transitions: [...transitionMap.values()].sort((a, b) => b.count - a.count).slice(0, 15),
      scrollReveals: [],
      hoverEffects: [],
      sticky,
      parallax: [],
      carousels,
      marquees,
      smoothScroll,
      scrollSnap,
      libraries: [...libs],
    },
    tech: { libraries: [...libs], generator: meta.generator || "", framework },
  };
})()
