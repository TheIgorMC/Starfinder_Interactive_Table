// A suno.com/s/<slug> or suno.com/song/<uuid> link is a share PAGE (a React
// app), not a playable audio file — pointing an <audio> tag straight at it
// just fails silently. The page does carry a direct CDN mp3 URL though,
// either as an Open Graph audio meta tag or inside the embedded page-data
// JSON, so we fetch the page once at link-add time and pull that out.
const UA = "Mozilla/5.0 (SIT-music-resolver; personal, non-commercial use)";

const MP3_RE = /https?:\/\/cdn\d*\.suno\.(?:ai|com)\/[a-zA-Z0-9_-]+\.mp3/;

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

  const og = /<meta[^>]+property=["']og:audio(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html)
    || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio(?::secure_url)?["']/i.exec(html);
  if (og?.[1] && MP3_RE.test(og[1])) return og[1];

  const inline = MP3_RE.exec(html);
  if (inline) return inline[0];

  throw new Error("couldn't find a direct audio stream on that Suno page");
}
