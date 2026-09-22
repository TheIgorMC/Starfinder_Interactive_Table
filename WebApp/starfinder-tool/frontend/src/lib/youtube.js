export function youtubeId(url) {
  const m = /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([\w-]{11})/.exec(url || "");
  return m ? m[1] : null;
}
