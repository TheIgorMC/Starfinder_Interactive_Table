// "!!...!!" is a lightweight convention a GM can use inside any campaign
// entry's body: text between a pair of "!!" markers is a private aside
// (a reminder, a hidden motive, something that must never reach a player)
// and has to be stripped everywhere a non-GM — or a player-visible
// preview, like the mood tablet's idle homescreen — might see it. It is
// never sent to a non-GM API response, and never survives into a body
// excerpt, regardless of who's asking for the excerpt.
const GM_NOTE_RE = /!!([\s\S]*?)!!/g;

export function stripGmNotes(text) {
  return (text || "")
    .replace(GM_NOTE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
