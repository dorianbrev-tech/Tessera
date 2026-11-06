// Builds the local test site "Maison Verre" (fixtures/maison) used to exercise the
// analysis engine and fidelity checks without external network access.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = new URL("../fixtures/maison/", import.meta.url).pathname;
const write = (p, html) => {
  const full = path.join(root, p);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, html);
};

const products = [
  ["linen-overcoat", "Linen Overcoat", "€1,450"],
  ["silk-column-dress", "Silk Column Dress", "€2,100"],
  ["cashmere-rib-knit", "Cashmere Rib Knit", "€890"],
  ["wool-tailored-trouser", "Wool Tailored Trouser", "€720"],
  ["leather-tote-34", "Leather Tote 34", "€1,980"],
  ["satin-slingback", "Satin Slingback", "€840"],
  ["poplin-shirt", "Poplin Shirt", "€460"],
  ["mohair-scarf", "Mohair Scarf", "€390"],
];

const header = (solid) => `
<header class="site-header${solid ? " is-solid" : ""}">
  <div class="inner">
    <nav class="nav" aria-label="Primary">
      <a href="/collections/women">Women</a><a href="/collections/men">Men</a><a href="/collections">Collections</a>
    </nav>
    <a class="logo" href="/" aria-label="Maison Verre home">Maison Verre</a>
    <nav class="nav right" aria-label="Secondary">
      <a href="/journal">Journal</a><a href="/about">Maison</a><a href="/login">Account</a>
    </nav>
    <button class="menu-toggle" aria-label="Open menu" aria-expanded="false"><span></span><span></span></button>
  </div>
</header>
<div class="mobile-menu" aria-hidden="true">
  <a href="/collections/women">Women</a><a href="/collections/men">Men</a><a href="/collections">Collections</a><a href="/journal">Journal</a><a href="/about">Maison</a>
</div>`;

const footer = `
<footer class="site-footer">
  <div class="container">
    <div class="cols">
      <div><h4>Maison Verre</h4><p style="max-width:34ch;color:#6f655c">Garments made slowly in our Lyon atelier since 1962, from natural fibres traced to the farm.</p></div>
      <div><h4>Shop</h4><ul><li><a href="/collections/women">Women</a></li><li><a href="/collections/men">Men</a></li><li><a href="/collections">All collections</a></li></ul></div>
      <div><h4>Maison</h4><ul><li><a href="/about">Our story</a></li><li><a href="/journal">Journal</a></li><li><a href="/private/press">Press</a></li></ul></div>
      <div><h4>Client care</h4><ul><li><a href="/about#contact">Contact</a></li><li><a href="/about#care">Garment care</a></li><li><a href="https://instagram.com/">Instagram</a></li></ul></div>
    </div>
    <div class="wordmark">Verre</div>
    <div class="legal"><span>© 2026 Maison Verre</span><span>Lyon · Paris · Tokyo</span></div>
  </div>
</footer>
<div class="cookie-banner"><span>We use cookies to improve your experience and measure traffic.</span><button class="btn">Accept</button></div>
<script src="/assets/js/site.js"></script>`;

const page = (title, body, { solid = false, description = "" } = {}) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description || "Maison Verre — quiet luxury ready-to-wear, crafted in Lyon."}">
<meta property="og:title" content="${title}"><meta name="theme-color" content="#f6f1ea">
<link rel="stylesheet" href="/assets/css/site.css">
</head><body${solid ? " data-solid-header" : ""}>${header(solid)}
<main>${body}</main>${footer}</body></html>`;

const card = ([slug, name, price], i) => `
<a class="card reveal" href="/products/${slug}">
  <div class="img"><img src="/assets/img/product-${(i % 8) + 1}.jpg" alt="${name}" loading="lazy"></div>
  <div class="meta"><span>${name}</span><span class="price">${price}</span></div>
</a>`;

write(
  "index.html",
  page(
    "Maison Verre — Autumn Winter 2026",
    `
<section class="hero">
  <div class="media"><img src="/assets/img/hero.jpg" alt="Model in a long camel coat walking through a stone courtyard"></div>
  <div class="copy">
    <h1>The <em>quiet</em> season</h1>
    <div><p class="eyebrow" style="margin-bottom:22px">Autumn — Winter 2026</p><a class="btn light" href="/collections">Discover the collection</a></div>
  </div>
</section>
<section class="intro container">
  <p class="eyebrow reveal">The House</p>
  <p class="lead reveal">Clothes cut to be lived in for decades, not seasons.</p>
  <a class="btn reveal" href="/about">Our story</a>
</section>
<section class="split">
  <div class="img"><img src="/assets/img/editorial-1.jpg" alt="Close-up of hand-finished seams"></div>
  <div class="text">
    <p class="eyebrow reveal">Atelier</p>
    <h2 class="reveal">Every coat passes through eleven pairs of hands.</h2>
    <p class="reveal" style="max-width:44ch;color:#6f655c">From the first pattern drawn in chalk to the last buttonhole stitched by hand, our Lyon atelier works at the pace good cloth demands.</p>
    <div class="reveal"><a class="btn" href="/about#atelier">Visit the atelier</a></div>
  </div>
</section>
<section class="products container">
  <div class="head"><h2 class="section-title reveal">New arrivals</h2><a class="btn" href="/collections">View all</a></div>
  <div class="grid">${products.slice(0, 8).map(card).join("")}</div>
</section>
<section class="marquee"><div class="track"><span>Made in Lyon</span><span>Natural fibres only</span><span>Repairs for life</span><span>Made in Lyon</span><span>Natural fibres only</span><span>Repairs for life</span></div></section>
<section class="campaign">
  <div class="parallax"><img src="/assets/img/campaign.jpg" alt="Campaign image: two figures on a windswept dune"></div>
  <div class="caption"><p class="eyebrow">Campaign</p><h2>Wind &amp; Stone</h2><a class="btn light" href="/journal">Watch the film</a></div>
</section>
<section class="carousel">
  <div class="container"><h2 class="section-title reveal" style="margin-bottom:48px">From the journal</h2></div>
  <div class="rail">
    ${[1, 2, 3].map((n) => `<article class="slide"><div class="img"><img src="/assets/img/journal-${n}.jpg" alt="Journal story ${n}"></div><p class="eyebrow" style="margin-top:18px">Story ${n}</p><h3>${["The last weavers of Biella", "A winter in the atelier", "On mending"][n - 1]}</h3></article>`).join("")}
    <article class="slide"><div class="img"><img src="/assets/img/atelier.jpg" alt="Atelier"></div><p class="eyebrow" style="margin-top:18px">Story 4</p><h3>Notes on camel hair</h3></article>
  </div>
</section>
<section class="newsletter">
  <div class="container"><h2>Letters from the Maison</h2>
  <form action="/newsletter" method="post"><input type="email" name="email" placeholder="Email address" aria-label="Email address" required><button type="submit">Subscribe</button></form></div>
</section>`,
  ),
);

const collectionPage = (title, list, intro) =>
  page(
    `${title} — Maison Verre`,
    `
<section class="page-hero container"><p class="eyebrow">Collection</p><h1>${title}</h1><p>${intro}</p></section>
<section class="products container" style="padding-top:0"><div class="grid">${list.map(card).join("")}</div></section>`,
    { solid: true },
  );
write("collections/index.html", collectionPage("Collections", products, "Autumn — Winter 2026: wool, cashmere and silk in the colours of the Rhône valley."));
write("collections/women.html", collectionPage("Women", products.slice(0, 6), "Long lines, soft shoulders and fabrics that move."));
write("collections/men.html", collectionPage("Men", products.slice(2, 8), "Tailoring without stiffness, knitwear without compromise."));

products.forEach(([slug, name, price], i) =>
  write(
    `products/${slug}.html`,
    page(
      `${name} — Maison Verre`,
      `
<section class="product-page">
  <div class="gallery">${[0, 1, 2].map((k) => `<div class="img"><img src="/assets/img/product-${((i + k) % 8) + 1}.jpg" alt="${name} view ${k + 1}"></div>`).join("")}</div>
  <div class="info">
    <p class="eyebrow">New arrival</p><h1>${name}</h1><p style="font-size:18px">${price}</p>
    <p style="color:#6f655c;max-width:42ch">Cut in our Lyon atelier from fabric woven in Biella. Unlined, with hand-finished seams and horn buttons.</p>
    <form action="/cart" method="post"><label>Size <select name="size"><option>XS</option><option>S</option><option>M</option><option>L</option></select></label></form>
    <a class="btn solid" href="/collections">Add to bag</a>
  </div>
</section>`,
      { solid: true },
    ),
  ),
);

write(
  "about.html",
  page(
    "The Maison — Maison Verre",
    `
<section class="page-hero container"><p class="eyebrow">Since 1962</p><h1>The Maison</h1><p>Founded by Hélène Verre in a former silk mill on the banks of the Saône, the house still cuts every pattern by hand.</p></section>
<section class="split" id="atelier"><div class="img"><img src="/assets/img/atelier.jpg" alt="The atelier"></div><div class="text"><h2 class="reveal">Eleven pairs of hands</h2><p class="reveal" style="color:#6f655c;max-width:44ch">Pattern cutters, tailors, finishers. Most have been with us for more than twenty years.</p></div></section>
<section class="intro container" id="contact"><p class="eyebrow">Contact</p><p class="lead">12 Quai Saint-Vincent, Lyon</p><a class="btn" href="mailto:atelier@example.com">Write to us</a></section>`,
    { solid: true },
  ),
);

write(
  "journal.html",
  page(
    "Journal — Maison Verre",
    `
<section class="page-hero container"><p class="eyebrow">Journal</p><h1>Stories from the atelier</h1></section>
<section class="container"><div class="journal-list">
${[1, 2, 3, 1, 2, 3].map((n, i) => `<article class="reveal"><div class="img"><img src="/assets/img/journal-${n}.jpg" alt="Story ${i + 1}"></div><p class="eyebrow">Essay · ${6 + i} min</p><h3>${["The last weavers of Biella", "A winter in the atelier", "On mending", "Notes on camel hair", "Dyeing with walnut", "The Saône in November"][i]}</h3></article>`).join("")}
</div></section>`,
    { solid: true },
  ),
);

write("login.html", page("Sign in — Maison Verre", `<section class="page-hero container"><h1>Sign in</h1><form><input type="email"><input type="password"></form></section>`, { solid: true }));
write("private/press.html", page("Press — Maison Verre", `<section class="page-hero container"><h1>Press (private)</h1></section>`, { solid: true }));
console.log("fixture site written to", root);
