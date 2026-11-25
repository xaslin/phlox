# Phlox roadmap

The scheduled daily improvement run takes the first unchecked item, finishes it, checks it, and ticks it off. Reorder or rewrite this list to steer it. Add your own ideas anywhere.

## Next

- [ ] Review: show missed cards first in a session and add a count of cards due to the Today briefing; accept a `## Question` heading followed by its answer as a card


## Done

- [x] Review screen: `Q:` / `A:` lines in notes (also as list items; the answer may run over several lines) become cards. Show answer, then Got it or Missed it; right answers come back after 1, 2, 4, 8, 16 then 32 days, missed ones tomorrow. Remembered in `.ember/state.json`; the sidebar counts cards due (2026-11-25)
- [x] Add a task from the Tasks screen: a box with an optional date and note name (defaults to Inbox) appends `- [ ] …` to that note (2026-11-24)
- [x] Stale projects: Today lists notes tagged `project` not edited in 30 days (oldest first, up to six) under "Still going?", each linking to the note; a `done`, `archived` or `finished` tag keeps a project off the list (2026-11-23)
- [x] Due dates on tasks: write `due: 2026-12-01`, `📅 2026-12-01` or `(due 2026-12-01)` in a task; Tasks lists dated ones first (overdue marked in violet) and the Today briefing counts overdue and due-this-week (2026-11-22)
- [x] Better "reads like": two words that sit side by side ("river trail") count as a phrase in the similarity index, and Connect names shared phrases instead of their single words. On the vault the top pairs barely moved but the reasons read better; one good pair slipped just below the cut-off, and halving the phrase weight brought it back but hid the phrases again (2026-11-21)
- [x] Graph filters: click a folder in the legend to hide or show it; drag a dot to pin it where you drop it, shift-click to unpin, "Unpin all" clears them; remembered in the browser (2026-11-20)
- [x] Snooze on Today: "Not today" on a pick swaps in the next best note in the same place and keeps the snoozed one off Today for a week; saved in `.ember/state.json` and carried over on rename (2026-11-19)

- [x] Rename a note: Rename in the title bar renames the file, rewrites every `[[link]]` to it (aliases and headings kept) and its own `# heading` (2026-11-18)
- [x] Templates: any note in a `Templates` folder is offered in the ⌘K palette as a starting point; `{{title}}`, `{{date}}` and `{{time}}` are filled in and the new note is dated today (2026-11-18)
- [x] Dictation: a microphone button on Today's capture box, shown where speech recognition is available; the Mac window asks for the microphone (2026-11-12)
- [x] Renamed Phlox; flat grey-and-violet interface with a title bar and status bar; flower logo (2026-11-12)
- [x] Briefing on Today, Tasks screen, daily note, read aloud (2026-11-12)
- [x] Unlinked mentions, notes two links away, hover previews, `[[` autocomplete, click-to-create links (2026-11-12)
- [x] Outside edits are noticed; route tracing on the Sphere (2026-11-12)
- [x] Sphere drawn in lines, one ringed patch per section, click a section to pull it up (2026-11-12)
- [x] Tags: click a tag to list every note carrying it (2026-11-12)
- [x] Quick switcher: ⌘K palette that jumps to notes, searches inside them and creates notes (2026-11-12)
- [x] Editing and linking clicked through in the page; note side column, live preview, tickable checkboxes, unsaved-changes prompt (2026-11-12)
- [x] Test script: `test/smoke.mjs`, run by `npm test` (2026-11-12)
- [x] Black and violet theme, new sidebar, violet logo (2026-11-12)
- [x] Logo and app icon: `public/logo.svg`, rendered to `mac/Ember.icns` by `swift mac/icon.swift` (2026-11-11)
- [x] First version: Today, Connect, Tensions, Graph, Ask, Digest, Settings, Mac window (2026-11-11)
