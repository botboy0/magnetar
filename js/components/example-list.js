/* ============================================================
   example-list.js
   Loads the curated examples library from /examples/.

   Wire shape:
     examples/manifest.json  →  { "examples": ["breakout", …] }
     examples/<slug>/meta.json
       { title, description, tags, author }
     examples/<slug>/thumb.{png,svg,webp,jpg,jpeg}   (optional)
       Card tries formats in priority order — first one that loads
       wins, the rest are ignored. PNG first (real captures from
       the runner), SVG second (hand-authored placeholders), then
       WebP / JPEG for completeness.
     examples/<slug>/main.lua    (required at duplicate time)
     examples/<slug>/conf.lua    (required at duplicate time)

   Examples are read-only-from-disk. The Examples tab never
   writes to localStorage — Duplicate is the only verb that
   produces a real project (via editor.html?example=<slug>).
   ============================================================ */

/* Thumbnail format priority. PNG first (real captures from the
   runner are PNG), SVG second (hand-authored placeholders), then
   WebP and JPEG for completeness. The card tries them in order
   and uses the first that loads. */
const THUMB_EXTS = ['png', 'svg', 'webp', 'jpg', 'jpeg'];

export async function loadExamples() {
  let manifest;
  try {
    const res = await fetch('examples/manifest.json');
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    console.warn('[examples] manifest fetch failed:', e);
    return [];
  }

  const slugs = Array.isArray(manifest?.examples) ? manifest.examples : [];
  const results = await Promise.all(slugs.map(loadOne));
  return results.filter(Boolean);
}

async function loadOne(slug) {
  try {
    const metaRes = await fetch(`examples/${slug}/meta.json`);
    const meta = metaRes.ok ? await metaRes.json() : {};
    return {
      slug,
      title:       meta.title       ?? slug,
      description: meta.description ?? '',
      tags:        Array.isArray(meta.tags) ? meta.tags : [],
      author:      meta.author      ?? '',
      thumbs:      THUMB_EXTS.map(ext => `examples/${slug}/thumb.${ext}`),
    };
  } catch (e) {
    console.warn(`[examples] failed to load "${slug}":`, e);
    return null;
  }
}
