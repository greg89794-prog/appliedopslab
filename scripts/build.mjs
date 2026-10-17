// Static build for appliedopslab.com. No dependencies: Node 18+ only.
//
//   1. Checks the cutting-stock example in data/cutting-example.json.
//   2. Renders it as inline SVG and injects it into src/index.html.
//   3. Fingerprints the stylesheet, copies src/ to dist/.
//   4. Checks links, the contact address, and content rules in the output.
//
// Any failed check exits non-zero, so a bad build never reaches Cloudflare Pages.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const DIST = join(root, "dist");
const EMAIL = "greg@appliedopslab.com";

const errors = [];
const fail = (msg) => errors.push(msg);

// ---------------------------------------------------------------------------
// 1. Cutting-stock example: verify every number before drawing anything.

const data = JSON.parse(readFileSync(join(root, "data/cutting-example.json"), "utf8"));
const { stockLength: STOCK, kerf: KERF, reusableMin: REUSE, parts: PARTS, orders } = data;

// Exact arithmetic: every length in the example is a multiple of 1/8 in.
const EIGHTHS = 8;
const toE = (n) => {
  const e = n * EIGHTHS;
  if (!Number.isInteger(e)) fail(`${n} in is not a multiple of 1/8 in`);
  return e;
};
const fromE = (e) => e / EIGHTHS;

// One kerf per part: each part is separated from the rest of the bar by one saw cut.
const usedE = (bar) => bar.reduce((s, p) => s + toE(PARTS[p]) + toE(KERF), 0);
const offcutE = (bar) => toE(STOCK) - usedE(bar);

const tally = (list) => list.reduce((m, p) => ((m[p] = (m[p] || 0) + 1), m), {});
const demand = tally(orders.flat());

for (const pattern of data.patterns) {
  for (const p of pattern.bars.flat()) if (!(p in PARTS)) fail(`${pattern.id}: unknown part ${p}`);
  const supplied = tally(pattern.bars.flat());
  for (const p of new Set([...Object.keys(demand), ...Object.keys(supplied)])) {
    if ((demand[p] || 0) !== (supplied[p] || 0)) {
      fail(`${pattern.id}: part ${p} ordered ${demand[p] || 0}, cut ${supplied[p] || 0}`);
    }
  }
  pattern.bars.forEach((bar, i) => {
    if (offcutE(bar) <= 0) fail(`${pattern.id} bar ${i + 1}: parts plus kerf exceed stock length`);
  });
}

// "Cut in the order received" must really be that: take parts in order,
// start a new bar whenever the next part does not fit.
const inOrder = data.patterns.find((p) => p.id === "in-order");
{
  const bars = [[]];
  let used = 0;
  for (const p of orders.flat()) {
    const need = toE(PARTS[p]) + toE(KERF);
    if (used + need > toE(STOCK)) bars.push([]), (used = 0);
    bars.at(-1).push(p);
    used += need;
  }
  if (JSON.stringify(bars) !== JSON.stringify(inOrder.bars)) {
    fail(`in-order pattern does not match the order sequence; expected ${JSON.stringify(bars)}`);
  }
}

// ---------------------------------------------------------------------------
// 2. SVG rendering.

const fmt = (n) => String(+n.toFixed(3));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function describe(pattern) {
  return pattern.bars
    .map((bar, i) => {
      const off = fromE(offcutE(bar));
      const kind = off >= REUSE ? "reusable remnant" : "scrap";
      return `Bar ${i + 1}: ${bar.map((p) => `${p} ${fmt(PARTS[p])}`).join(", ")}; offcut ${fmt(off)} in, ${kind}.`;
    })
    .join(" ");
}

// variant "wide": part lengths in segments, bar labels at left.
// variant "compact": part letters in segments, sized for phone screens.
function cutSvg(pattern, variant) {
  const wide = variant === "wide";
  const W = wide ? 960 : 420;
  const labelW = wide ? 64 : 22;
  const barW = W - labelW - 2;
  const scale = barW / STOCK;
  const barH = wide ? 36 : 34;
  const rowH = wide ? 92 : 90;
  const fs = wide ? 14 : 15;
  const H = pattern.bars.length * rowH;
  const hatch = `hatch-${pattern.id}-${variant}`;
  const out = [];

  out.push(
    `<svg class="cut-svg cut-svg--${variant}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${pattern.title}. ${describe(pattern)}`)}">`,
    `<defs><pattern id="${hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs>`,
  );

  pattern.bars.forEach((bar, i) => {
    const y = 10 + i * rowH;
    const cy = y + barH / 2;
    const x0 = labelW;
    out.push(`<g class="bar">`);
    out.push(
      `<text class="bar-label" x="0" y="${cy}" dominant-baseline="central">${wide ? `Bar ${i + 1}` : i + 1}</text>`,
    );

    let e = 0;
    const kerfXs = [];
    for (const p of bar) {
      const x = x0 + fromE(e) * scale;
      const w = PARTS[p] * scale;
      out.push(
        `<rect class="seg seg-${p}" x="${fmt(x)}" y="${y}" width="${fmt(w)}" height="${barH}"/>`,
        `<text class="seg-text seg-text-${p}" x="${fmt(x + w / 2)}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fs}">${wide ? fmt(PARTS[p]) : p}</text>`,
      );
      e += toE(PARTS[p]);
      kerfXs.push(x0 + (fromE(e) + KERF / 2) * scale);
      e += toE(KERF);
    }

    const offX = x0 + fromE(e) * scale;
    const off = fromE(offcutE(bar));
    const offW = off * scale;
    const reusable = off >= REUSE;
    out.push(
      reusable
        ? `<rect class="offcut offcut--reuse" x="${fmt(offX)}" y="${y + 0.75}" width="${fmt(offW - 0.75)}" height="${barH - 1.5}"/>`
        : `<rect class="offcut offcut--scrap" x="${fmt(offX)}" y="${y}" width="${fmt(offW)}" height="${barH}" fill="url(#${hatch})"/>`,
    );
    if (reusable && wide) {
      out.push(
        `<text class="offcut-text" x="${fmt(offX + offW / 2)}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${fs - 1}">remnant</text>`,
      );
    }

    // Stock outline, then the saw cuts on top.
    out.push(`<rect class="stock" x="${x0}" y="${y}" width="${fmt(barW)}" height="${barH}"/>`);
    for (const kx of kerfXs) {
      out.push(`<line class="kerf" x1="${fmt(kx)}" y1="${y - 5}" x2="${fmt(kx)}" y2="${y + barH + 5}"/>`);
    }

    // Dimension line under the offcut.
    const dy = y + barH + 14;
    const end = x0 + barW;
    out.push(
      `<path class="dim" d="M${fmt(offX)} ${dy - 4}v8M${fmt(end)} ${dy - 4}v8M${fmt(offX)} ${dy}H${fmt(end)}"/>`,
    );
    const label = `${fmt(off)} in`;
    const approxW = label.length * fs * 0.56;
    const mid = offX + offW / 2;
    const anchorEnd = mid + approxW / 2 > W;
    out.push(
      `<text class="dim-text${reusable ? " dim-text--reuse" : ""}" x="${fmt(anchorEnd ? end : mid)}" y="${dy + 16}" text-anchor="${anchorEnd ? "end" : "middle"}" font-size="${fs - 1}">${label}</text>`,
    );
    out.push(`</g>`);
  });

  out.push(`</svg>`);
  return out.join("");
}

function caption(pattern) {
  const offs = pattern.bars.map((b) => fromE(offcutE(b)));
  const reuse = offs.filter((o) => o >= REUSE);
  const scrap = offs.filter((o) => o < REUSE);
  const list = (xs) => xs.map(fmt).join(", ");
  // Non-breaking spaces keep each value with its unit when the caption wraps.
  const parts = [`${pattern.bars.length}&nbsp;bars.`];
  if (scrap.length) parts.push(`Scrap: ${list(scrap)}&nbsp;in.`);
  parts.push(reuse.length ? `Kept for reuse: ${list(reuse)}&nbsp;in.` : `No offcut long enough to keep.`);
  return parts.join(" ");
}

// The hero rule: one bar from the planned pattern, drawn as an outline.
function heroBar() {
  const bar = data.patterns.find((p) => p.id === "planned").bars[1];
  const W = 1000;
  const scale = W / STOCK;
  const out = [`<svg class="hero-bar" viewBox="0 0 ${W} 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">`];
  let e = 0;
  for (const p of bar) {
    out.push(`<rect class="hero-seg" x="${fmt(fromE(e) * scale)}" y="6" width="${fmt(PARTS[p] * scale)}" height="12"/>`);
    e += toE(PARTS[p]);
    const kx = (fromE(e) + KERF / 2) * scale;
    out.push(`<line class="hero-kerf" x1="${fmt(kx)}" y1="0" x2="${fmt(kx)}" y2="24"/>`);
    e += toE(KERF);
  }
  out.push(`<rect class="hero-stock" x="0" y="6" width="${W}" height="12"/>`, `</svg>`);
  return out.join("");
}

const partsList = Object.entries(PARTS)
  .map(([p, len]) => {
    const n = demand[p] || 0;
    return `<li><span class="swatch swatch-${p}" aria-hidden="true"></span><span class="part-id">${p}</span> ${fmt(len)} in <span class="qty">× ${n}</span></li>`;
  })
  .join("");

const inject = {
  "hero-bar": heroBar(),
  "parts-list": partsList,
  "stock-length": fmt(STOCK),
  "stock-feet": fmt(STOCK / 12),
  kerf: fmt(KERF),
  "reuse-min": fmt(REUSE),
  "order-count": String(orders.length),
  "part-count": String(orders.flat().length),
  year: "2026",
};
for (const p of data.patterns) {
  inject[`title:${p.id}`] = esc(p.title);
  inject[`diagram:${p.id}`] = cutSvg(p, "wide") + cutSvg(p, "compact");
  inject[`caption:${p.id}`] = caption(p);
}

// ---------------------------------------------------------------------------
// 3. Assemble dist/.

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(SRC, DIST, { recursive: true });

const css = readFileSync(join(SRC, "styles.css"), "utf8");
const cssName = `styles.${createHash("sha256").update(css).digest("hex").slice(0, 10)}.css`;
rmSync(join(DIST, "styles.css"));
writeFileSync(join(DIST, cssName), css);

const pages = ["index.html", "404.html"];
for (const page of pages) {
  let html = readFileSync(join(SRC, page), "utf8")
    .replace(/<!--@([\w:-]+)-->/g, (m, key) => {
      if (!(key in inject)) return fail(`${page}: unknown placeholder ${key}`), m;
      return inject[key];
    })
    .replace('href="/styles.css"', `href="/${cssName}"`);
  writeFileSync(join(DIST, page), html);
}

// ---------------------------------------------------------------------------
// 4. Checks on the built output.

for (const page of pages) {
  const html = readFileSync(join(DIST, page), "utf8");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  if (/<!--@/.test(html)) fail(`${page}: unreplaced placeholder`);
  if (/<script/i.test(html)) fail(`${page}: contains a <script>; the site is meant to ship without JavaScript`);

  const refs = html.matchAll(/\s(?:(?:href|src)="([^"]+)"|content="(https?:[^"]*)")/g);
  for (const ref of [...refs].map((m) => m[1] || m[2])) {
    if (ref.startsWith("#")) {
      if (ref.length > 1 && !ids.has(ref.slice(1))) fail(`${page}: broken anchor ${ref}`);
    } else if (ref.startsWith("mailto:")) {
      if (!ref.startsWith(`mailto:${EMAIL}`)) fail(`${page}: unexpected mailto ${ref}`);
    } else if (ref.startsWith("/")) {
      const path = ref.split(/[?#]/)[0];
      const file = path.endsWith("/") ? join(DIST, path, "index.html") : join(DIST, path);
      if (!existsSync(file)) fail(`${page}: missing local file ${ref}`);
    } else if (/^https:\/\/appliedopslab\.com\//.test(ref)) {
      const path = new URL(ref).pathname;
      if (path !== "/" && !existsSync(join(DIST, path))) fail(`${page}: missing file for ${ref}`);
    } else {
      fail(`${page}: external reference ${ref}`);
    }
  }
  for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) {
    if (!ids.has(ref)) fail(`${page}: broken SVG reference #${ref}`);
  }

  // Content rules from the brief: no claimed savings, funnels, or social proof.
  const text = html.replace(/<[^>]+>/g, " ");
  const banned = [
    [/\d\s*%/, "percentage figure"],
    [/free trial|pricing|book a (call|demo)|schedule a (call|demo)/i, "sales funnel language"],
    [/testimonial|trusted by|our clients/i, "social proof claim"],
    [/\bLLC\b|\bInc\.|\bCorp\b/, "legal-entity claim"],
  ];
  for (const [re, what] of banned) if (re.test(text)) fail(`${page}: ${what} found (${text.match(re)[0]})`);
}

const index = readFileSync(join(DIST, "index.html"), "utf8");
if (!index.includes('<link rel="canonical" href="https://appliedopslab.com/">')) fail("index.html: canonical URL missing");
if (!index.includes(`>${EMAIL}<`)) fail("index.html: contact address not shown as text");

if (errors.length) {
  console.error(`Build failed with ${errors.length} problem(s):\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}

console.log(`Built dist/ (${cssName})`);
for (const p of data.patterns) console.log(`  ${p.title}: ${caption(p).replace(/&nbsp;/g, " ")}`);
