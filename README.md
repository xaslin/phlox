<p align="center"><img src="public/logo.svg" width="120" alt="Phlox logo"></p>

# Phlox

Local-first notes with a memory. Phlox reads a folder of Markdown files (an Obsidian vault works as is, and the two can be open at once) and tells you what in it needs your attention.

| Screen | What it does | Needs an API key |
|---|---|---|
| Today | A briefing: what changed in the last day, open tasks, link suggestions, conflicts. Three older notes worth another look ("Not today" swaps one out and keeps it away for a week), quick capture to `Inbox.md`, and a daily note. | No |
| Tasks | Every unticked `- [ ]` checkbox across the folder. Ticking one rewrites that line in its note. | No |
| Connect | Pairs of notes that read alike but do not link to each other, with the words and two-word phrases they share. One click adds the link. | No |
| Tensions | Passages that give different numbers for the same thing. | No |
| Tensions, deeper read | Disagreements that are not about numbers. | Yes |
| Graph | Every note and link. Click a folder in the legend to hide it; drag a dot to pin it (shift-click to let it go). Both are remembered in this browser. | No |
| Sphere | The same notes and links on a 3D globe drawn in lines, with a ringed patch for each section. Click a section name to pull it up and list its notes; click a point for its details; shift-click a second one to trace the shortest chain of links between them. | No |
| Ask | A question answered from your notes, with citations. | Yes |
| Digest | Turns a pasted source into a summary note plus one note per idea. | Yes |

Around those screens:

- **⌘K** opens a palette: type a note's name to jump to it, or some words to search inside every note. It also creates notes.
- **Templates.** Put notes in a folder called `Templates` and the palette offers each one when you create a note: "Create “Name” from Meeting". `{{title}}`, `{{date}}` and `{{time}}` are filled in, as in Obsidian, and the new note's `created` date is set to today. Templates are kept out of Today's picks and the orphan count.
- **A note** shows, beside the text: its outline, what links to it, notes that mention it without linking (one click links them), notes two links away, and notes that read like it. Hovering a link previews the note. Links to notes that do not exist yet create them when clicked.
- **Editing** (⌘E) shows a live preview. Typing `[[` offers note titles. ⌘S saves, and leaving with unsaved changes asks first.
- **Renaming.** Rename in a note's title bar renames the file and rewrites every `[[link]]` to it in the other notes, keeping any `|alias` or `#heading`. A name another note already has is refused.
- **Dictation**: the microphone button in Today's capture box types what you say into it, for you to check before pressing Capture. It shows only where the browser or the Mac window offers speech recognition; the Mac app asks for the microphone the first time.
- **Read aloud**: the speaker button reads the briefing, a note or an answer with the Mac's built-in voice.
- **Outside edits**: change a file in Obsidian or any editor and Phlox picks it up within a few seconds.

Phlox was first called Ember. The settings folder (`~/.config/ember`), the `.ember` folder inside your notes and the `EMBER_PORT` / `EMBER_VAULT` variables keep that name so nothing saved is lost.

## Run it

```bash
npm install
```

```bash
npm start
```

Then open http://127.0.0.1:4317.

## Test it

```bash
npm test
```

This starts the server on a spare port against a throwaway folder of made-up notes and checks every endpoint that does not call Claude. It never touches your own notes or settings.

## Mac app

```bash
./mac/build.sh
```

This builds `build/Phlox.app`, a native window that starts the server for you. It needs Node installed. Rebuild after changing `server.js` or `public/`.

## Where things live

- **Notes:** the folder set in Settings. Defaults to `../vault`.
- **Settings and API key:** `~/.config/ember/config.json`, readable only by you. `ANTHROPIC_API_KEY` in the environment also works.
- **What you have opened and dismissed:** `.ember/state.json` inside the notes folder.

## What leaves your Mac

Nothing, unless you use Ask, Digest or the deeper read. Dictation uses Apple's speech recognition, which may send the audio to Apple. Those send the relevant notes to Anthropic with your key and are billed to it. Ask sends up to 12 matching notes; the deeper read sends every note except hubs and session logs.

The server only listens on 127.0.0.1 and refuses requests from other origins.

## Files

- `server.js` — index, search, resurfacing, link suggestions, tension detection, Claude calls
- `public/` — the page: `index.html`, `app.js`, `style.css`
- `mac/` — the Swift window and its build script
- `test/smoke.mjs` — the test run by `npm test`
- `public/logo.svg` — the logo. After changing it, run `swift mac/icon.swift` to remake the app icon (`mac/Phlox.icns`), then rebuild

## License

MIT. See [LICENSE](LICENSE).
