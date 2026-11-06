// Generates photographic-looking placeholder imagery for the local test site (fixtures/maison).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const out = new URL("../fixtures/maison/assets/img/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const palettes = [
  ["#2b2420", "#8c6d58", "#e9dccf"],
  ["#1d2328", "#566573", "#d9d4cc"],
  ["#3a2f2a", "#b08d74", "#f3ece4"],
  ["#14110f", "#5b4636", "#c9b39d"],
  ["#242a26", "#6f7d6b", "#e2e0d6"],
  ["#2e1f1d", "#9a5b4a", "#eed7c8"],
];

function svg(w, h, [a, b, c], seed) {
  const r = (n) => ((Math.sin(seed * 999 + n * 77) + 1) / 2);
  const blobs = Array.from({ length: 6 }, (_, i) =>
    `<ellipse cx="${(r(i) * w).toFixed(0)}" cy="${(r(i + 9) * h).toFixed(0)}" rx="${(w * (0.15 + r(i + 3) * 0.35)).toFixed(0)}" ry="${(h * (0.12 + r(i + 5) * 0.3)).toFixed(0)}" fill="${[a, b, c][i % 3]}" opacity="${(0.35 + r(i + 1) * 0.4).toFixed(2)}"/>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="${r(2).toFixed(2)}" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="0.55" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(w / 18)}"/></filter>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.09 0"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <g filter="url(#blur)">${blobs}</g>
    <rect x="${(w * 0.38).toFixed(0)}" y="${(h * 0.18).toFixed(0)}" width="${(w * 0.24).toFixed(0)}" height="${(h * 0.7).toFixed(0)}" rx="${(w * 0.12).toFixed(0)}" fill="${a}" opacity="0.55" filter="url(#blur)"/>
    <rect width="100%" height="100%" filter="url(#grain)"/>
  </svg>`;
}

const jobs = [
  ["hero.jpg", 2400, 1400, 0],
  ["editorial-1.jpg", 1200, 1500, 1],
  ["editorial-2.jpg", 1200, 1500, 2],
  ["campaign.jpg", 2000, 1100, 3],
  ["atelier.jpg", 1400, 1700, 4],
  ...Array.from({ length: 8 }, (_, i) => [`product-${i + 1}.jpg`, 900, 1200, 10 + i]),
  ["journal-1.jpg", 1400, 950, 30],
  ["journal-2.jpg", 1400, 950, 31],
  ["journal-3.jpg", 1400, 950, 32],
];

for (const [name, w, h, seed] of jobs) {
  await sharp(Buffer.from(svg(w, h, palettes[seed % palettes.length], seed + 1))).jpeg({ quality: 80 }).toFile(out + name);
}
console.log(`wrote ${jobs.length} images to ${out}`);
