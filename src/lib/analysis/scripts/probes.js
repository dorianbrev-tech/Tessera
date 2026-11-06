// Installs window.__tessera helpers in the analysed page. Plain JS, injected as a string.
(() => {
  if (window.__tessera) return true;
  const vh = () => window.innerHeight;
  const shortSel = (el) => {
    let s = el.tagName.toLowerCase();
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "")
      .split(/\s+/)
      .filter((c) => c && c.length < 40 && !/\d{3,}|[:[\]/]/.test(c) && !/^(is-|aos-animate|in-view|visible|active|animated)/.test(c))
      .slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  };

  window.__tessera = {
    /** Hide cookie banners, consent walls and newsletter popups so screenshots show the actual page. */
    dismissOverlays() {
      const hidden = [];
      const known = [
        "#onetrust-banner-sdk", "#onetrust-consent-sdk", "#CybotCookiebotDialog", "#usercentrics-root", ".cc-window", ".cc-banner",
        "#cookie-banner", "#cookie-notice", "#cookieConsent", ".cookie-banner", ".cookie-consent", ".cookie-notice", "#truste-consent-track",
        "#didomi-host", ".didomi-popup", "#axeptio_overlay", "#qc-cmp2-container", ".osano-cm-window", "#hs-eu-cookie-confirmation", "#iubenda-cs-banner",
        "[aria-label*=cookie i]", "[id*=cookie-law]", ".klaviyo-form", "[class*=newsletter-popup]", "[class*=NewsletterPopup]",
      ];
      for (const sel of known) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            if (el.offsetParent !== null || getComputedStyle(el).position === "fixed") {
              el.style.setProperty("display", "none", "important");
              hidden.push(sel);
            }
          }
        } catch {}
      }
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 40) continue;
        const text = (el.innerText || "").slice(0, 800).toLowerCase();
        const isConsent = /cookie|consent|gdpr|privacy preferences|we use cookies|cookies to/.test(text) && text.length < 2000;
        const coversCenter = r.width > innerWidth * 0.5 && r.height > innerHeight * 0.4 && Number(cs.zIndex) > 10;
        const isPopup = coversCenter && /subscribe|newsletter|sign up|join our|% off|discount|select your (country|region)|choose your location/.test(text);
        if (isConsent || isPopup) {
          el.style.setProperty("display", "none", "important");
          hidden.push(shortSel(el));
        }
      }
      for (const el of [document.documentElement, document.body]) {
        if (getComputedStyle(el).overflow === "hidden" && hidden.length) el.style.setProperty("overflow", "auto", "important");
      }
      return hidden;
    },

    /** Tag below-the-fold content to detect scroll-triggered reveals and parallax. */
    tagMotion() {
      const out = [];
      const candidates = document.querySelectorAll(
        "h1,h2,h3,h4,p,img,picture,figure,video,article,li,blockquote,button,a,[class*=reveal],[class*=fade],[class*=animate],[data-aos],[data-scroll],[class*=parallax],[data-speed],[class*=appear],[class*=inview],[class*=in-view]",
      );
      let i = 0;
      for (const el of candidates) {
        if (i >= 600) break;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 12) continue;
        if (r.top + window.scrollY < vh() * 0.9) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none") continue;
        el.setAttribute("data-tessera-mid", String(i));
        out.push({ id: i, sel: shortSel(el), opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, cls: el.className && typeof el.className === "string" ? el.className.slice(0, 200) : "", absTop: Math.round(r.top + window.scrollY) });
        i++;
      }
      return out;
    },

    readMotion() {
      return Array.from(document.querySelectorAll("[data-tessera-mid]")).map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { id: Number(el.getAttribute("data-tessera-mid")), opacity: cs.opacity, transform: cs.transform, visibility: cs.visibility, cls: el.className && typeof el.className === "string" ? el.className.slice(0, 200) : "", top: r.top, absTop: r.top + window.scrollY };
      });
    },

    /** Positions of tagged elements currently in the viewport (for parallax slope estimation). */
    sampleVisible() {
      const y = window.scrollY;
      const res = [];
      for (const el of document.querySelectorAll("[data-tessera-mid]")) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh()) continue;
        res.push([Number(el.getAttribute("data-tessera-mid")), Math.round(r.top + y)]);
      }
      return { y, res };
    },

    tagHoverTargets() {
      const picks = [];
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 12 && r.top >= 0 && r.top < innerHeight * 3;
      };
      const add = (el, kind) => {
        if (!el || picks.length >= 8 || picks.some((p) => p.el === el) || !visible(el)) return;
        picks.push({ el, kind });
      };
      const header = document.querySelector("header, [role=banner]") || document.body;
      header.querySelectorAll("nav a, a").forEach((a, i) => i < 2 && add(a, "nav link"));
      document.querySelectorAll("button, a[class*=btn], a[class*=button], [role=button]").forEach((b, i) => i < 3 && add(b, "button"));
      Array.from(document.querySelectorAll("a")).filter((a) => a.querySelector("img")).slice(0, 2).forEach((a) => add(a, "image link"));
      return picks.map((p, i) => {
        p.el.setAttribute("data-tessera-hover", String(i));
        return { id: i, kind: p.kind, sel: shortSel(p.el), text: (p.el.innerText || p.el.getAttribute("aria-label") || "").trim().slice(0, 40) };
      });
    },

    readHover(id) {
      const el = document.querySelector(`[data-tessera-hover="${id}"]`);
      if (!el) return null;
      const pick = (cs) => ({
        color: cs.color, backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor, opacity: cs.opacity,
        transform: cs.transform, boxShadow: cs.boxShadow, textDecorationLine: cs.textDecorationLine,
        letterSpacing: cs.letterSpacing, filter: cs.filter,
      });
      const out = {};
      const base = pick(getComputedStyle(el));
      for (const k in base) out[k] = base[k];
      for (const pseudo of ["::after", "::before"]) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content && ps.content !== "none") {
          out[pseudo + " transform"] = ps.transform;
          out[pseudo + " width"] = ps.width;
          out[pseudo + " opacity"] = ps.opacity;
        }
      }
      const img = el.querySelector("img");
      if (img) {
        const ics = getComputedStyle(img);
        out["img transform"] = ics.transform;
        out["img filter"] = ics.filter;
        out["img opacity"] = ics.opacity;
      }
      return out;
    },

    scrollHeight() {
      return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    },

    /** Heuristic bot-wall detection. */
    challenge() {
      const t = (document.title || "").toLowerCase();
      const body = (document.body ? document.body.innerText : "").slice(0, 3000).toLowerCase();
      if (/just a moment|attention required|access denied|are you a robot|verify you are human|robot check|pardon our interruption|request unsuccessful/.test(t)) return t;
      if (document.querySelector("#challenge-form, #cf-challenge-running, .cf-browser-verification, #px-captcha, iframe[src*='captcha'], #captcha-container")) return "captcha";
      if (body.length < 600 && /(enable javascript and cookies|checking your browser|verify you are human|access to this page has been denied)/.test(body)) return body.slice(0, 120);
      return null;
    },
  };
  return true;
})()
