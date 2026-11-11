# Ember roadmap

The scheduled "Ember: one improvement" run takes the first unchecked item, finishes it, checks it, and ticks it off. Reorder or rewrite this list to steer it. Add your own ideas anywhere.

## Next

- [ ] **Test script.** Add `test/smoke.mjs`, run by `npm test`: start the server on a spare port against a temporary copy of a few notes, and check search, today, connect, tensions, capture, create, edit, link and the path-traversal guards. Later runs depend on this.
- [ ] **Check editing and linking in the page.** Saving an edited note and the "Link them" button were never clicked through. Exercise both, fix what breaks.
- [ ] **Notice outside edits.** Re-read the folder when a file changes on disk, so edits made in Obsidian show up without pressing "Re-read the folder".
- [ ] **Quick switcher.** ⌘K opens a palette that fuzzy-matches note titles and opens the chosen note; Enter on no match offers to create it.
- [ ] **Rename a note.** Rename the file and rewrite every `[[link]]` that pointed at it.
- [ ] **Daily note.** A "Today's note" button that opens or creates `Daily/YYYY-MM-DD.md`.
- [ ] **Tags.** Click a tag chip to list every note carrying it.
- [ ] **Snooze on Today.** "Not today" swaps a pick for another and keeps it away for a week.
- [ ] **Graph filters.** Toggle folders on and off from the legend; drag a dot to pin it.
- [ ] **Better "reads like".** Add two-word phrases to the similarity index and compare the Connect list before and after on the real vault.
- [ ] **Unfinished work view.** List notes that say something is empty, blocked, paused or still to do, newest first.
- [ ] **App icon.** Give `Ember.app` an icon, generated from the flame mark in `public/index.html`.

## Done

- [x] First version: Today, Connect, Tensions, Graph, Ask, Digest, Settings, Mac window (2026-11-11)
