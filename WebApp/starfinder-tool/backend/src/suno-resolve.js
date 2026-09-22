// A suno.com/s/<slug> or suno.com/song/<uuid> link is a share PAGE (a React
// app), not a playable audio file — pointing an <audio> tag straight at it
// just fails silently. Worse, the page's own server-rendered HTML doesn't
// carry the real audio URL either: it ships an i18n JSON-LD template whose
// "audio_url" is literally the string "https://studio-api.prod.suno.com/
// api/forbidden" — the real one is only fetched client-side, after auth,
// once the page hydrates (confirmed on a real share page's HTML, 2026-09).
//
// What the static HTML DOES always carry is the song's canonical URL
// (suno.com/song/<uuid>), even when the link you were given is the short
// /s/<slug> form. Every public clip is served from a CDN path keyed by
// that same id, so resolve the id and probe the predictable CDN URL
// directly rather than trying to scrape audio out of the page at all.
const UA = "Mozilla/5.0 (SIT-music-resolver; personal, non-commercial use)";

const MP3_RE = /https?:\/\/cdn\d*\.suno\.(?:ai|com)\/[a-zA-Z0-9_-]+\.mp3/;
const CANONICAL_RE = /<link rel="canonical" href="https:\/\/suno\.com\/song\/([0-9a-f-]{36})"/i;

export function isSunoPageUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "suno.com" && !MP3_RE.test(url);
  } catch {
    return false;
  }
}

export async function resolveSunoAudio(pageUrl) {
  const res = await fetch(pageUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`suno.com returned HTTP ${res.status}`);
  const html = await res.text();

  // Belt and braces: if a page variant ever does ship a real og:audio tag
  // or an inline mp3 URL, prefer that over the CDN-probe fallback below.
  const og = /<meta[^>]+property=["']og:audio(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio(?::secure_url)?["']/i.exec(html);
  if (og?.[1] && MP3_RE.test(og[1])) return og[1];
  const inline = MP3_RE.exec(html);
  if (inline) return inline[0];

  const canonical = CANONICAL_RE.exec(html);
  if (canonical) {
    const candidate = `https://cdn1.suno.ai/${canonical[1]}.mp3`;
    const head = await fetch(candidate, { method: "HEAD", headers: { "User-Agent": UA } }).catch(() => null);
    if (head?.ok) return candidate;
  }

  throw new Error("couldn't find a direct audio stream for that Suno song (it may be private)");
}
