<p align="center"><img src="public/logo.svg" width="120" alt="Ember logo"></p>

# Ember

Local-first notes with a memory. Ember reads a folder of Markdown files (an Obsidian vault works as is) and brings notes back to you.

| Screen | What it does | Needs an API key |
|---|---|---|
| Today | Three notes picked for the day, with when each was written and how long since you opened it. Quick capture to `Inbox.md`. | No |
| Connect | Pairs of notes that read alike but do not link to each other. One click adds the link. | No |
| Tensions | Passages that give different numbers for the same thing. | No |
| Tensions, deeper read | Disagreements that are not about numbers. | Yes |
| Graph | Every note and link. | No |
| Sphere | The same notes and links on a 3D globe you can spin, with a details panel for the note you click. | No |
| Ask | A question answered from your notes, with citations. | Yes |
| Digest | Turns a pasted source into a summary note plus one note per idea. | Yes |

Around those screens:

- **⌘K** opens a palette: type a note's name to jump to it, or some words to search inside every note. It also creates notes.
- **A note** shows its outline, what links to it and what reads like it beside the text. Checkboxes can be ticked in place, and tags open a list of every note that carries them.
- **Editing** (⌘E) shows a live preview next to the Markdown. ⌘S saves, and leaving with unsaved changes asks first.

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

This builds `build/Ember.app`, a native window that starts the server for you. It needs Node installed. Rebuild after changing `server.js` or `public/`.

## Where things live

- **Notes:** the folder set in Settings. Defaults to `../vault`.
- **Settings and API key:** `~/.config/ember/config.json`, readable only by you. `ANTHROPIC_API_KEY` in the environment also works.
- **What you have opened and dismissed:** `.ember/state.json` inside the notes folder.

## What leaves your Mac

Nothing, unless you use Ask, Digest or the deeper read. Those send the relevant notes to Anthropic with your key and are billed to it. Ask sends up to 12 matching notes; the deeper read sends every note except hubs and session logs.

The server only listens on 127.0.0.1 and refuses requests from other origins.

## Files

- `server.js` — index, search, resurfacing, link suggestions, tension detection, Claude calls
- `public/` — the page: `index.html`, `app.js`, `style.css`
- `mac/` — the Swift window and its build script
- `test/smoke.mjs` — the test run by `npm test`
- `public/logo.svg` — the logo. After changing it, run `swift mac/icon.swift` to remake the app icon, then rebuild

## License

MIT. See [LICENSE](LICENSE).
