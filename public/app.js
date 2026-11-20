// Phlox front end. No framework: hash routes, fetch, and a small Markdown renderer.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $("#main");
let notes = [];
let byTitle = {};
let byPath = {};
let dirty = false; // an edit that has not been saved
let lastVersion = 0; // the folder version this page last loaded
let editNext = null; // a note to open straight into the editor

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const href = (p) => "#/note/" + encodeURIComponent(p);
const tagHref = (t) => "#/tag/" + encodeURIComponent(t);
const link = (n, cls = "") => `<a class="${cls}" href="${href(n.path)}">${esc(n.title)}</a>`;
const folderName = (f) => (f ? f.split("/").map((p) => p.replace(/^\d+\s+/, "")).join(" / ") : "Top level");
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

async function api(path, opts = {}) {
  const res = await fetch(path, opts.body ? { method: opts.method || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opts.body) } : opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
// Runs a button's action, and says so when it fails instead of failing silently.
const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message);
  }
};

// ───────────── Markdown ─────────────
function wikilink(t, a) {
  const name = unesc(t).split("#")[0].trim();
  const n = byTitle[name.toLowerCase()];
  const shown = a || t;
  return n ? `<a class="wl" href="${href(n.path)}">${shown}</a>` : `<a class="wl missing" href="#" data-create="${esc(name)}" title="Not written yet. Click to create it.">${shown}</a>`;
}
function inline(s) {
  // Finished pieces are set aside so later rules cannot change them (a URL with underscores, code with stars).
  const kept = [];
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  const ext = (u, text) => keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  s = esc(s)
    .replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`))
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => keep(wikilink(t, a)))
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, u) => ext(u, alt || "image"))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, text, u) => ext(u, text))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => pre + ext(u, u))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>");
  while (s.includes("\u0000")) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
  return s;
}
const LIST = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
// opts.heads collects the headings; opts.line0 turns on clickable checkboxes that know their source line.
function render(md, opts = {}) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const row = (l) => l.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|(?![^\[\]]*\]\])/).map((c) => c.trim().replace(/\\\|/g, "|"));
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const buf = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(l)) {
      const lvl = l.match(/^#+/)[0].length;
      const text = l.replace(/^#+\s+/, "").replace(/\s+#+\s*$/, "");
      const id = opts.heads ? `h-${opts.heads.length}` : "";
      if (opts.heads) opts.heads.push({ lvl, id, text: text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t).replace(/[*_`=~]/g, "") });
      out.push(`<h${lvl}${id ? ` id="${id}"` : ""}>${inline(text)}</h${lvl}>`);
      i++;
    } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out.push("<hr>");
      i++;
    } else if (l.trim().startsWith("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || "") && (lines[i + 1] || "").includes("-")) {
      const head = row(l);
      const body = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) body.push(row(lines[i]));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (LIST.test(l)) {
      let html = "";
      const open = []; // the lists we are inside, outermost first
      for (; i < lines.length && LIST.test(lines[i]); i++) {
        const [, pad, mark, text] = lines[i].match(LIST);
        const ind = pad.replace(/\t/g, "    ").length, ord = /\d/.test(mark);
        while (open.length && ind < open.at(-1).ind) html += `</li></${open.pop().ord ? "ol" : "ul"}>`;
        if (!open.length || ind > open.at(-1).ind) {
          open.push({ ind, ord });
          html += ord ? "<ol>" : "<ul>";
        } else html += "</li>";
        const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
        if (task) {
          const done = task[1] !== " ";
          const box = opts.line0 === undefined ? "disabled" : `data-line="${opts.line0 + i}"`;
          html += `<li class="task${done ? " done" : ""}"><input type="checkbox" ${box}${done ? " checked" : ""} aria-label="Done"><span>${inline(task[2])}</span>`;
        } else html += `<li>${inline(text)}`;
      }
      while (open.length) html += `</li></${open.pop().ord ? "ol" : "ul"}>`;
      out.push(html);
    } else if (/^>/.test(l)) {
      const buf = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ""));
      const call = buf[0].match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (call) out.push(`<div class="callout"><div class="callout-title">${inline(call[2] || call[1][0].toUpperCase() + call[1].slice(1).toLowerCase())}</div>${render(buf.slice(1).join("\n"))}</div>`);
      else out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|>|\s*([-*+]|\d+\.)\s+|\s*\||(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i]); i++) buf.push(inline(lines[i].trim()));
      if (!buf.length) buf.push(inline(lines[i++].trim())); // a line that only looked like the start of something else
      out.push(`<p>${buf.join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

// ───────────── sidebar ─────────────
async function loadNotes() {
  const data = await api("/api/notes");
  notes = data.notes;
  byTitle = Object.fromEntries(notes.map((n) => [n.title.toLowerCase(), n]));
  byPath = Object.fromEntries(notes.map((n) => [n.path, n]));
  lastVersion = data.version;
  const links = notes.reduce((a, n) => a + n.out, 0);
  $("#vaultstat").textContent = `${notes.length} notes · ${links} links`;
  drawTree();
  refreshBadges();
}
// How many suggestions and conflicts are waiting, shown beside their screens.
async function refreshBadges() {
  try {
    const [c, t, k] = await Promise.all([api("/api/connect"), api("/api/tensions"), api("/api/tasks")]);
    $("#b-connect").textContent = c.pairs.length || "";
    $("#b-tensions").textContent = t.tensions.length || "";
    $("#b-tasks").textContent = k.open || "";
  } catch {}
}
function drawTree() {
  const root = { kids: {}, files: [], count: 0 };
  for (const n of notes) {
    let at = root;
    for (const part of n.folder ? n.folder.split("/") : []) {
      at = at.kids[part] ||= { kids: {}, files: [], count: 0 };
      at.count++;
    }
    at.files.push(n);
  }
  const open = new Set(JSON.parse(sessionStorage.getItem("ember-open") || "[]"));
  const walk = (node, prefix) =>
    Object.keys(node.kids).sort().map((k) => {
      const id = prefix + k;
      return `<details data-id="${esc(id)}"${open.has(id) ? " open" : ""}><summary>${esc(k.replace(/^\d+\s+/, ""))}</summary><div class="kids">${walk(node.kids[k], id + "/")}</div></details>`;
    }).join("") + node.files.map((n) => `<a href="${href(n.path)}" data-path="${esc(n.path)}" title="${esc(n.title)}">${esc(n.title)}</a>`).join("");
  $("#tree").innerHTML = walk(root, "");
  $$("#tree details").forEach((d) =>
    d.addEventListener("toggle", () => {
      d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id);
      sessionStorage.setItem("ember-open", JSON.stringify([...open]));
    })
  );
  markActive();
}
function markActive() {
  const [, view, rest] = location.hash.split("/");
  $$("[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === (view || "today")));
  const p = view === "note" ? safeDecode(rest || "") : "";
  $$("#tree a").forEach((a) => {
    const on = a.dataset.path === p;
    a.classList.toggle("on", on);
    if (on) for (let d = a.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
  });
}

// ───────────── views ─────────────
// Every view takes `live`, which turns false once you have moved on, so a slow screen never draws over a newer one.
function page(html, { cls = "", title = "", actions = "", stat = "" } = {}) {
  $("#bar-title").innerHTML = title;
  $("#bar-actions").innerHTML = actions;
  $("#viewstat").textContent = stat;
  main.innerHTML = `<div class="wrap ${cls}">${html}</div>`;
}
const tags = (n) => (n.tags || []).map((t) => `<a class="tag" href="${tagHref(t)}">${esc(t)}</a>`).join("");
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const keyNotice = `<div class="notice">This needs your own Anthropic API key. Add one in <a href="#/settings">Settings</a>. Everything else works without it.</div>`;
const noteRows = (list) => `<div class="rows">${list.map((n) => `<a href="${href(n.path)}"><span>${esc(n.title)}</span><small>${esc(folderName(n.folder))}</small></a>`).join("")}</div>`;

// Reading aloud uses the voice built into the Mac. Nothing is sent anywhere.
const canSpeak = "speechSynthesis" in window;
const speakBtn = canSpeak ? `<button class="icon" id="speak" title="Read aloud" aria-label="Read aloud"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>` : "";
function wireSpeak(getText) {
  const btn = $("#speak");
  if (!btn) return;
  btn.onclick = () => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      return btn.classList.remove("on");
    }
    const u = new SpeechSynthesisUtterance(getText().slice(0, 8000));
    u.onend = u.onerror = () => btn.classList.remove("on");
    btn.classList.add("on");
    speechSynthesis.speak(u);
  };
}

// Dictation uses the speech recognition built into the browser or the Mac window, when it has one.
// The button only appears where it works. Words land in the capture box to check before saving.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;
const micBtn = Recognition ? `<button type="button" class="icon" id="dictate" title="Dictate" aria-label="Dictate" aria-pressed="false"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>` : "";
function stopDictation() {
  if (listening) listening.stop();
}
function wireDictation(input) {
  const btn = $("#dictate");
  if (!btn) return;
  btn.onclick = () => {
    if (listening) return stopDictation();
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    const before = input.value.trim();
    rec.onresult = (e) => {
      const heard = Array.from(e.results, (r) => r[0].transcript).join("").trim();
      input.value = [before, heard].filter(Boolean).join(" ");
    };
    rec.onerror = (e) => {
      const why = { "not-allowed": "Phlox is not allowed to use the microphone.", "service-not-allowed": "Speech recognition is turned off on this Mac.", "no-speech": "Nothing was heard." };
      toast(why[e.error] || "Dictation stopped.");
    };
    rec.onend = () => {
      listening = null;
      btn.classList.remove("on");
      btn.setAttribute("aria-pressed", "false");
      btn.title = "Dictate";
      input.focus();
    };
    try {
      rec.start();
    } catch {
      return toast("Dictation could not start.");
    }
    listening = rec;
    btn.classList.add("on");
    btn.setAttribute("aria-pressed", "true");
    btn.title = "Stop dictating";
  };
}

function pickEntries(picks) {
  return picks.map((p) => `
      <article class="entry">
        <h3>${link(p)}</h3>
        <div class="sub">${esc(p.why)}</div>
        <p>${esc(p.excerpt)}</p>
        <div class="row">${tags(p)}${p.source ? `<span class="tag plain">from ${esc(p.source.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</span>` : ""}<span class="grow"></span>
          <button class="btn" data-snooze="${esc(p.path)}" title="Hide this note from Today for a week">Not today</button></div>
      </article>`).join("") || `<div class="empty">No notes yet. Point Phlox at a folder in Settings.</div>`;
}
// "Not today" swaps a pick for the next one and keeps it off Today for a week.
function wireSnooze(d) {
  $$("[data-snooze]", main).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    const r = await api("/api/snooze", { body: { path: b.dataset.snooze } }).finally(() => (b.disabled = false));
    const title = d.picks.find((p) => p.path === b.dataset.snooze)?.title || "Note";
    d.picks = r.picks;
    $("#picks").innerHTML = pickEntries(r.picks);
    wireSnooze(d);
    toast(`${title} is off Today until ${new Date(r.until + "T12:00").toLocaleDateString(undefined, { month: "long", day: "numeric" })}`);
  })));
}

async function viewToday(live) {
  const [d, c, t] = await Promise.all([api("/api/today"), api("/api/connect"), api("/api/tensions")]);
  if (!live()) return;
  const b = d.briefing;
  const nice = new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  // The briefing is one plain sentence per thing that is waiting, each linking to where you deal with it.
  const lines = [
    b.changedCount ? `${plural(b.changedCount, "note")} changed in the last day.` : "Nothing has changed since yesterday.",
    b.openTasks ? `<a href="#/tasks">${plural(b.openTasks, "open task")}</a>.` : "",
    c.pairs.length ? `<a href="#/connect">${plural(c.pairs.length, "pair")} of notes</a> could be linked.` : "",
    t.tensions.length ? `<a href="#/tensions">${plural(t.tensions.length, "place")}</a> where your notes disagree.` : "",
    b.streak > 1 ? `Day ${b.streak} in a row.` : "",
  ].filter(Boolean);
  page(`
    <h1 class="page">${esc(nice)}</h1>
    <p class="lede" id="brief">${lines.join(" ")}</p>
    <form class="capture" id="capture"><input name="text" placeholder="Capture a thought. It goes to your Inbox." autocomplete="off" aria-label="Capture a thought">${micBtn}<button class="btn primary">Capture</button></form>
    <h2 class="sec">Worth another look <small>not opened in a while</small></h2>
    <div id="picks">${pickEntries(d.picks)}</div>
    ${b.changed.length ? `<h2 class="sec">Changed in the last day</h2>${noteRows(b.changed)}` : ""}
    ${b.missing.length ? `<h2 class="sec">Linked but not written yet</h2><div class="rows">${b.missing.map((m) => `<a href="#" data-create="${esc(m.title)}"><span>${esc(m.title)}</span><small>mentioned in ${m.from.map(esc).join(", ")}</small></a>`).join("")}</div>` : ""}
    ${d.stats.orphans.length ? `<h2 class="sec">Nothing links to these</h2>${noteRows(d.stats.orphans.slice(0, 10))}` : ""}
  `, {
    title: "<b>Today</b>",
    actions: `${speakBtn}<button class="btn" id="daily">Today's note</button>`,
    stat: `${d.stats.words.toLocaleString()} words · ${d.stats.unopened} never opened here`,
  });
  wireSpeak(() => `${nice}. ${$("#brief").textContent} Worth another look: ${d.picks.map((p) => p.title).join(", ")}.`);
  wireSnooze(d);
  $("#daily").onclick = guard(async () => {
    const { path } = await api("/api/daily", { body: {} });
    await loadNotes();
    location.hash = href(path);
  });
  wireCreate();
  wireDictation($("#capture").text);
  $("#capture").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    stopDictation();
    const input = e.target.text;
    if (!input.value.trim()) return;
    await api("/api/capture", { body: { text: input.value } });
    input.value = "";
    toast("Saved to Inbox");
    await loadNotes();
  }));
}
// A link to a note that does not exist yet creates it when clicked.
function wireCreate() {
  $$("[data-create]", main).forEach((a) => (a.onclick = guard(async (e) => {
    e.preventDefault();
    await createNote(a.dataset.create);
  })));
}

async function viewTasks(live) {
  const d = await api("/api/tasks");
  if (!live()) return;
  page(`
    <h1 class="page">Tasks</h1>
    <p class="lede">Every unticked checkbox in your notes, most recently edited note first. Write <code>- [ ] something</code> in any note to add one.</p>
    ${d.groups.map((g) => `
      <h2 class="sec">${link(g)} <small>${esc(folderName(g.folder))}</small></h2>
      <div class="tasks">${g.tasks.map((t) => `<label><input type="checkbox" data-path="${esc(g.path)}" data-line="${t.line}"><span>${esc(t.text)}</span></label>`).join("")}</div>`).join("") || `<div class="empty">Nothing is waiting.</div>`}
  `, { title: "<b>Tasks</b>", stat: `${d.open} open · ${d.done} done` });
  $$(".tasks input", main).forEach((box) => (box.onchange = async () => {
    try {
      await api("/api/task", { body: { path: box.dataset.path, line: +box.dataset.line, done: box.checked } });
      box.nextElementSibling.classList.toggle("gone", box.checked);
      await loadNotes();
    } catch (err) {
      box.checked = !box.checked;
      toast(err.message);
    }
  }));
}

async function viewNote(live, path) {
  let n;
  try {
    n = await api("/api/note?path=" + encodeURIComponent(path));
  } catch (err) {
    if (live()) page(`<h1 class="page">Note not found</h1><p class="lede">${esc(err.message)}. It may have been renamed or deleted. Press ⌘K to look for it.</p>`, { title: "<b>Not found</b>" });
    return;
  }
  if (!live()) return;
  const recent = [n.path, ...JSON.parse(localStorage.getItem("ember-recent") || "[]").filter((p) => p !== n.path)].slice(0, 6);
  localStorage.setItem("ember-recent", JSON.stringify(recent));
  const crumbs = `${n.folder ? esc(folderName(n.folder)) + " / " : ""}<b>${esc(n.title)}</b>`;
  const src = n.source && /^https?:/.test(n.source) ? `<a href="${esc(n.source)}" target="_blank" rel="noopener noreferrer">original</a>` : esc(n.source);
  const list = (items, each, none) => (items.length ? `<ul>${items.map((x) => `<li>${each(x)}</li>`).join("")}</ul>` : `<p class="none">${none}</p>`);

  const show = () => {
    dirty = false;
    const heads = [];
    const body = render(n.body, { heads, line0: n.raw.split("\n").length - n.body.split("\n").length });
    const toc = heads.filter((h) => h.lvl === 2 || h.lvl === 3);
    page(`
      <div class="note-layout">
        <article>
          <div class="meta">${tags(n)}<span>${esc(n.created)}</span>${src ? `<span>${src}</span>` : ""}</div>
          <div class="md">${body}</div>
        </article>
        <aside class="rail">
          ${toc.length > 1 ? `<div><h4>On this page</h4><div class="toc">${toc.map((h) => `<a href="#" class="l${h.lvl}" data-head="${h.id}">${esc(h.text)}</a>`).join("")}</div></div>` : ""}
          <div><h4>Linked from</h4>${list(n.backlinks, (b) => `${link(b)}<small>${esc(b.context)}</small>`, "Nothing links here yet.")}</div>
          ${n.mentions.length ? `<div><h4>Mentioned without a link</h4>${list(n.mentions, (m) => `${link(m)} <button class="link-btn" data-mention="${esc(m.path)}">link it</button><small>${esc(m.context)}</small>`)}</div>` : ""}
          ${n.hops.length ? `<div><h4>Two links away</h4>${list(n.hops, (h) => `${link(h)}<small>through ${h.via.map(esc).join(", ")}</small>`)}</div>` : ""}
          <div><h4>Reads like</h4>${list(n.related, (r) => `${link(r)}${r.linked ? "" : ` <button class="link-btn" data-link="${esc(r.path)}">link</button>`}<small>${Math.round(r.score * 100)}% alike${r.linked ? ", linked" : ""}</small>`, "Nothing similar found.")}</div>
        </aside>
      </div>`, {
      cls: "note",
      title: crumbs,
      actions: `${speakBtn}<button class="btn" id="rename" title="Rename this note and update links to it">Rename</button><button class="btn" id="edit" title="Edit (⌘E)">Edit</button>`,
      stat: `${plural(n.backlinks.length, "backlink")} · ${plural(n.words, "word")} · ${plural(n.chars, "character")}`,
    });
    $("#edit").onclick = edit;
    $("#rename").onclick = guard(rename);
    wireSpeak(() => $(".md", main).innerText);
    wireCreate();
    $$("[data-head]", main).forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.head)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    $$("[data-link]", main).forEach((b) => (b.onclick = guard(async () => {
      await api("/api/link", { body: { from: n.path, to: b.dataset.link } });
      toast("Linked");
      await loadNotes();
      route();
    })));
    $$("[data-mention]", main).forEach((b) => (b.onclick = guard(async () => {
      await api("/api/mention", { body: { from: b.dataset.mention, to: n.path } });
      toast("Linked");
      await loadNotes();
      route();
    })));
    $$("input[data-line]", main).forEach((box) => (box.onchange = async () => {
      try {
        await api("/api/task", { body: { path: n.path, line: +box.dataset.line, done: box.checked } });
        box.closest("li").classList.toggle("done", box.checked);
        const lines = n.raw.split("\n");
        lines[+box.dataset.line] = lines[+box.dataset.line].replace(/\[( |x|X)\]/, box.checked ? "[x]" : "[ ]");
        n.raw = lines.join("\n");
        await loadNotes();
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      }
    }));
  };

  // Renames the file and rewrites every [[link]] that pointed at it.
  const rename = async () => {
    const title = prompt(`Rename "${n.title}" to:`, n.title);
    if (title === null || !title.trim() || title.trim() === n.title) return;
    const r = await api("/api/rename", { body: { path: n.path, title } });
    const recent = JSON.parse(localStorage.getItem("ember-recent") || "[]").map((p) => (p === n.path ? r.path : p));
    localStorage.setItem("ember-recent", JSON.stringify(recent));
    toast(r.updated ? `Renamed, and updated links in ${plural(r.updated, "note")}` : "Renamed");
    await loadNotes();
    location.hash = href(r.path);
  };

  const edit = () => {
    page(`
      <div class="meta"><span>Plain Markdown. Type [[ to link to another note. ⌘S saves.</span></div>
      <div class="edit-split"><textarea class="editor" id="raw" spellcheck="true" aria-label="Note text"></textarea><div class="md preview" id="preview" aria-label="Preview"></div><div class="suggest" id="suggest" hidden></div></div>`, {
      cls: "note",
      title: crumbs,
      actions: `<button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button>`,
      stat: "Editing",
    });
    const ta = $("#raw"), pv = $("#preview"), sug = $("#suggest");
    ta.value = n.raw;
    const preview = () => (pv.innerHTML = render(ta.value.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "")));
    preview();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    // Typing [[ offers matching note titles.
    let items = [], at = 0, from = -1;
    const close = () => {
      sug.hidden = true;
      items = [];
    };
    const suggest = () => {
      const upto = ta.value.slice(0, ta.selectionStart), open = upto.lastIndexOf("[[");
      const q = open >= 0 ? upto.slice(open + 2) : null;
      if (q === null || /[\]\n|]/.test(q) || q.length > 60) return close();
      const ql = q.toLowerCase();
      items = notes.map((x) => ({ x, s: ql ? fuzzy(ql, x.title.toLowerCase()) : 0 })).filter((y) => y.s !== null && y.x.path !== n.path)
        .sort((a, b) => b.s - a.s || a.x.title.localeCompare(b.x.title)).slice(0, 6).map((y) => y.x);
      if (!items.length) return close();
      from = open + 2;
      at = Math.min(at, items.length - 1);
      sug.hidden = false;
      sug.innerHTML = `<small>Link to a note</small>` + items.map((x, i) => `<div class="${i === at ? "on" : ""}" data-i="${i}">${esc(x.title)}</div>`).join("");
    };
    const accept = (i) => {
      const end = ta.selectionStart;
      ta.setRangeText(items[i].title + (ta.value.slice(end).startsWith("]]") ? "" : "]]"), from, end, "end");
      close();
      ta.focus();
      ta.dispatchEvent(new Event("input"));
    };
    sug.onmousedown = (e) => {
      e.preventDefault();
      const el = e.target.closest("[data-i]");
      if (el) accept(+el.dataset.i);
    };
    ta.addEventListener("input", () => {
      dirty = ta.value !== n.raw;
      preview();
      at = 0;
      suggest();
    });
    ta.addEventListener("blur", close);
    const save = guard(async () => {
      await api("/api/note", { method: "PUT", body: { path: n.path, raw: ta.value } });
      dirty = false;
      toast("Saved");
      await loadNotes();
      route();
    });
    $("#save").onclick = save;
    $("#cancel").onclick = () => {
      if (dirty && !confirm("Discard your changes to this note?")) return;
      show();
    };
    ta.addEventListener("keydown", (e) => {
      if (items.length && !e.isComposing) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          return suggest();
        }
        if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), accept(at);
        if (e.key === "Escape") return e.preventDefault(), close();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      } else if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); // indent instead of leaving the editor
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
    });
  };
  if (editNext === n.path) {
    editNext = null;
    edit();
  } else show();
}

async function viewConnect(live) {
  const { pairs } = await api("/api/connect");
  if (!live()) return;
  page(`
    <h1 class="page">Notes that should know about each other</h1>
    <p class="lede">These pairs use the same rare words but do not link to each other. Linking adds a "See also" line to the first note.</p>
    ${pairs.map((p) => `
      <div class="entry" data-id="${esc(p.id)}">
        <div class="pair">
          <div>${link(p.a)}<div class="sub">${esc(folderName(p.a.folder))}</div></div>
          <div class="mid">${Math.round(p.score * 100)}% alike</div>
          <div>${link(p.b)}<div class="sub">${esc(folderName(p.b.folder))}</div></div>
        </div>
        <div class="row"><span class="sub">Both mention ${p.shared.map(esc).join(", ")}</span><span class="grow"></span>
          <button class="btn" data-dismiss>Not related</button><button class="btn" data-from="${esc(p.a.path)}" data-to="${esc(p.b.path)}">Link them</button></div>
      </div>`).join("") || `<div class="empty">Every similar pair is already linked.</div>`}
  `, { title: "<b>Connect</b>", stat: plural(pairs.length, "suggestion") });
  $$("[data-from]", main).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    await api("/api/link", { body: { from: b.dataset.from, to: b.dataset.to } }).finally(() => (b.disabled = false));
    b.closest(".entry").remove();
    toast("Linked");
    await loadNotes();
  })));
  wireDismiss();
}
function wireDismiss() {
  $$("[data-dismiss]", main).forEach((b) => (b.onclick = guard(async () => {
    const entry = b.closest(".entry");
    await api("/api/dismiss", { body: { id: entry.dataset.id } });
    entry.remove();
    refreshBadges();
  })));
}

async function viewTensions(live) {
  const d = await api("/api/tensions");
  if (!live()) return;
  const side = (x, big) => `<div>${big !== undefined ? `<big>${esc(big)}</big>` : ""}<q>${esc(x.sentence)}</q><span class="sub">${link(x)}${x.section && x.section !== x.title ? `, under ${esc(x.section)}` : ""}</span></div>`;
  page(`
    <h1 class="page">Where your notes disagree</h1>
    <p class="lede">Two passages that give different numbers for what looks like the same thing. These are found on this Mac.</p>
    ${d.tensions.map((t) => `
      <div class="entry" data-id="${esc(t.id)}">
        <div class="versus">${side(t.a, `${t.a.value.toLocaleString()} ${t.a.shown}`)}${side(t.b, `${t.b.value.toLocaleString()} ${t.b.shown}`)}</div>
        <div class="row"><span class="grow"></span><button class="btn" data-dismiss>Not a conflict</button></div>
      </div>`).join("") || `<div class="empty">No conflicting numbers found.</div>`}
    <h2 class="sec">Deeper read <small>uses Claude</small></h2>
    <p class="lede" style="margin-top:12px">For disagreements that are not about numbers. Sends your notes, except hubs and session logs, to Claude once.</p>
    ${d.hasKey ? "" : keyNotice}
    <button class="btn" id="deep"${d.hasKey ? "" : " disabled"}>Read the whole vault for disagreements</button>
    <div id="deepout" style="margin-top:14px"></div>
  `, { title: "<b>Tensions</b>", stat: `${d.tensions.length} found` });
  wireDismiss();
  $("#deep").onclick = async (e) => {
    const btn = e.currentTarget, out = $("#deepout");
    btn.disabled = true;
    out.innerHTML = `<p class="sub"><span class="spinner"></span>Reading. This can take a minute.</p>`;
    try {
      const { findings } = await api("/api/tensions/deep", { body: {} });
      out.innerHTML = findings.map((f) => `
        <div class="entry"><div class="kind">${esc(f.kind)}</div><p style="margin:2px 0 10px">${esc(f.explanation)}</p><div class="versus">${side(f.a)}${side(f.b)}</div></div>`).join("") || `<div class="empty">Claude found nothing that disagrees.</div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
    btn.disabled = false;
  };
}

async function viewSearch(live, q) {
  const { hits } = await api("/api/search?q=" + encodeURIComponent(q));
  if (!live()) return;
  const words = q.split(/\s+/).filter((w) => w.length > 1).map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const mark = (s) => (words.length ? esc(s).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>") : esc(s));
  page(`<h1 class="page">“${esc(q)}”</h1><p class="lede">${plural(hits.length, "note")}, best match first.</p>
    ${hits.map((h) => `<div class="entry"><h3>${link(h)}</h3><div class="sub">${esc(folderName(h.folder))}</div><p>${mark(h.snippet)}</p></div>`).join("") || `<div class="empty">Nothing matches. Try fewer words.</div>`}`,
    { title: "<b>Search</b>", stat: plural(hits.length, "result") });
}

function viewTag(live, tag) {
  const list = notes.filter((n) => (n.tags || []).includes(tag));
  page(`<h1 class="page">#${esc(tag)}</h1><p class="lede">${plural(list.length, "note")}.</p>
    ${list.length ? noteRows(list) : `<div class="empty">No notes have this tag.</div>`}`, { title: `Tags / <b>${esc(tag)}</b>` });
}

async function viewAsk(live) {
  const s = await api("/api/settings");
  if (!live()) return;
  page(`
    <h1 class="page">Ask your notes</h1>
    <p class="lede">Phlox finds the notes that match, sends those notes and your question to Claude, and shows an answer that cites them.</p>
    ${s.hasKey ? "" : keyNotice}
    <form class="askbox" id="ask"><textarea class="field" name="q" placeholder="What did I decide about the NHD thesis, and what is still unwritten?" aria-label="Your question"></textarea><button class="btn primary"${s.hasKey ? "" : " disabled"}>Ask</button></form>
    <div id="answer"></div>`, { title: "<b>Ask</b>", actions: speakBtn });
  wireSpeak(() => $("#answer").innerText);
  const form = $("#ask");
  let busy = false;
  form.q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = form.q.value.trim();
    if (!question || !s.hasKey || busy) return;
    busy = true;
    const out = $("#answer");
    out.innerHTML = `<p class="sub"><span class="spinner"></span>Finding notes and thinking.</p>`;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
      const sources = JSON.parse(safeDecode(res.headers.get("x-sources") || "%5B%5D"));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (!out.isConnected) return reader.cancel();
        out.innerHTML = `<div class="answer md">${render(text)}</div>`;
      }
      out.innerHTML = `<div class="answer md">${render(text || "*No answer came back.*")}</div><h2 class="sec">Notes Claude was given</h2>${noteRows(sources)}`;
    } catch (err) {
      out.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    } finally {
      busy = false;
    }
  });
}

async function viewDigest(live) {
  const s = await api("/api/settings");
  if (!live()) return;
  page(`
    <h1 class="page">Digest a source</h1>
    <p class="lede">Paste an article, a transcript or lecture notes. Claude writes a source note with a summary, plus one small note per idea, each linked back to the source and to notes you already have.</p>
    ${s.hasKey ? "" : keyNotice}
    <form class="digest" id="digest">
      <input class="field" name="title" placeholder="Title (optional)" aria-label="Title">
      <textarea class="field" name="text" placeholder="Paste the text here" aria-label="Source text"></textarea>
      <input class="field" name="origin" placeholder="Where it came from: a link or a description (optional)" aria-label="Where it came from">
      <div class="row" style="margin-top:10px"><button class="btn primary"${s.hasKey ? "" : " disabled"}>Digest</button><span class="sub" id="dstate"></span></div>
    </form><div id="dout"></div>`, { title: "<b>Digest</b>" });
  $("#digest").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, btn = $("button", f), state = $("#dstate");
    if (btn.disabled) return;
    btn.disabled = true;
    state.innerHTML = `<span class="spinner"></span>Reading the source.`;
    try {
      const r = await api("/api/digest", { body: { title: f.title.value, text: f.text.value, origin: f.origin.value } });
      await loadNotes();
      state.textContent = "";
      $("#dout").innerHTML = `<h2 class="sec">Created</h2>${noteRows([r.source, ...r.atoms].map((p) => byPath[p]).filter(Boolean))}`;
      f.reset();
    } catch (err) {
      state.textContent = err.message;
    }
    btn.disabled = false;
  });
}

async function viewSettings(live) {
  const s = await api("/api/settings");
  if (!live()) return;
  page(`
    <h1 class="page">Settings</h1>
    <p class="lede">Phlox reads and writes plain Markdown files in one folder. Nothing is uploaded unless you use Ask, Digest or the deeper read under Tensions.</p>
    <form id="set">
      <div class="form-row"><label for="vault">Notes folder</label><input class="field" id="vault" name="vault" value="${esc(s.vault)}" spellcheck="false">
        <small>${s.exists ? `${notes.length} notes found. An Obsidian vault works as is, and edits made there show up here within a few seconds.` : "This folder does not exist."}</small></div>
      <div class="form-row"><label for="key">Anthropic API key</label><input class="field" id="key" name="apiKey" type="password" autocomplete="off" placeholder="${s.hasKey ? "A key is saved. Type a new one to replace it." : "sk-ant-…"}">
        <small>${s.hasKey ? `Using the key from ${esc(s.keyFrom)}. ` : ""}Stored in ~/.config/ember/config.json, readable only by you. Requests go to Anthropic with the model ${esc(s.model)} and are billed to this key.</small></div>
      <div class="row"><button class="btn primary">Save</button>${s.keyFrom === "settings" ? `<button class="btn" type="button" id="forget">Forget the key</button>` : ""}<button class="btn" type="button" id="reindex">Re-read the folder</button></div>
    </form>
    <h2 class="sec">Keys</h2>
    <div class="rows">
      <div><span>Search, jump to a note, or create one</span><small><kbd>⌘K</kbd></small></div>
      <div><span>Edit the open note</span><small><kbd>⌘E</kbd></small></div>
      <div><span>Save while editing</span><small><kbd>⌘S</kbd></small></div>
      <div><span>Link to a note while editing</span><small><kbd>[[</kbd></small></div>
      <div><span>Trace how two notes connect, on the Sphere</span><small>click one, then <kbd>shift</kbd>-click another</small></div>
    </div>`, { title: "<b>Settings</b>" });
  $("#set").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    const body = { vault: e.target.vault.value };
    if (e.target.apiKey.value.trim()) body.apiKey = e.target.apiKey.value;
    await api("/api/settings", { body });
    await loadNotes();
    toast("Saved");
    route();
  }));
  $("#reindex").onclick = guard(async () => {
    await api("/api/reindex", { body: {} });
    await loadNotes();
    toast("Folder re-read");
    route();
  });
  const forget = $("#forget");
  if (forget) forget.onclick = guard(async () => {
    await api("/api/settings", { body: { apiKey: "" } });
    toast("Key removed");
    route();
  });
}

// ───────────── graph ─────────────
let stopGraph = () => {};
// Hidden folders and pinned dots are kept in this browser only, so the graph looks the same next time.
function graphPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("ember-graph") || "{}");
    return { hidden: Array.isArray(p.hidden) ? p.hidden : [], pins: p.pins && typeof p.pins === "object" ? p.pins : {} };
  } catch {
    return { hidden: [], pins: {} };
  }
}
function saveGraphPrefs(p) {
  try {
    localStorage.setItem("ember-graph", JSON.stringify(p));
  } catch {}
}
async function viewGraph(live) {
  const g = await api("/api/graph");
  if (!live()) return;
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#22d3ee", "#fb7185", "#94a3b8", "#c084fc"];
  const color = Object.fromEntries(groups.map((k, i) => [k, palette[i % palette.length]]));
  const prefs = graphPrefs();
  const hidden = new Set(prefs.hidden.filter((k) => groups.includes(k)));
  const count = Object.fromEntries(groups.map((k) => [k, g.nodes.filter((n) => n.group === k).length]));
  page(`
    <div class="graphbox"><canvas id="graph"></canvas></div>
    <div class="legend">${groups.map((k) => `<button class="lg${hidden.has(k) ? " off" : ""}" data-g="${esc(k)}" aria-pressed="${!hidden.has(k)}" title="Show or hide this folder"><i style="background:${color[k]}"></i>${esc(k.replace(/^\d+\s+/, ""))} <small>${count[k]}</small></button>`).join("")}<button class="lg unpin" hidden>Unpin all</button></div>`, { cls: "wide", title: "<b>Graph</b>", stat: "Drag the background to move · drag a dot to pin it · shift-click to unpin · click a folder to hide it" });
  const cv = $("#graph");
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--text").trim(), line = css.getPropertyValue("--line-2").trim();
  const nodes = g.nodes.map((n, i) => {
    const pin = prefs.pins[n.id];
    const at = Array.isArray(pin) && pin.every(Number.isFinite) ? pin : null;
    return { ...n, x: at ? at[0] : Math.cos(i * 2.4) * (120 + i * 3), y: at ? at[1] : Math.sin(i * 2.4) * (120 + i * 3), vx: 0, vy: 0, pinned: Boolean(at) };
  });
  const shown = (n) => !hidden.has(n.group);
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = g.edges.map(([a, b]) => [idx[a], idx[b]]).filter(([a, b]) => a !== undefined && b !== undefined);
  let view = { x: 0, y: 0, k: 0.6 }, hover = null, drag = null, heat = 1, alive = true;
  const size = () => {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return [r.width, r.height, d];
  };
  const toWorld = (e) => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left - r.width / 2 - view.x) / view.k, (e.clientY - r.top - r.height / 2 - view.y) / view.k];
  };
  const radius = (n) => 3 + Math.sqrt(n.degree) * 1.5;
  const savePins = () => {
    prefs.pins = Object.fromEntries(nodes.filter((n) => n.pinned).map((n) => [n.id, [Math.round(n.x), Math.round(n.y)]]));
    prefs.hidden = [...hidden];
    saveGraphPrefs(prefs);
    $(".legend .unpin").hidden = !nodes.some((n) => n.pinned);
  };
  function step() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!shown(a)) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!shown(b)) continue;
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01, f = 4200 / d2, d = Math.sqrt(d2);
        dx = (dx / d) * f; dy = (dy / d) * f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
      a.vx -= a.x * 0.004; a.vy -= a.y * 0.004;
    }
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j];
      if (!shown(a) || !shown(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 95) * 0.012;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n.pinned || !shown(n)) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += Math.max(-12, Math.min(12, n.vx)) * heat;
      n.y += Math.max(-12, Math.min(12, n.vy)) * heat;
    }
    heat = Math.max(0.02, heat * 0.992);
  }
  function draw() {
    if (!alive) return;
    if (heat > 0.03) step();
    const [w, h, d] = size();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + view.x, h / 2 + view.y);
    ctx.scale(view.k, view.k);
    const near = new Set();
    if (hover !== null) for (const [i, j] of edges) { if (i === hover) near.add(j); if (j === hover) near.add(i); }
    ctx.lineWidth = 1 / view.k;
    for (const [i, j] of edges) {
      if (!shown(nodes[i]) || !shown(nodes[j])) continue;
      const lit = hover !== null && (i === hover || j === hover);
      ctx.strokeStyle = lit ? color[nodes[hover].group] : line;
      ctx.globalAlpha = hover === null ? 0.9 : lit ? 1 : 0.2;
      ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
    }
    nodes.forEach((n, i) => {
      if (!shown(n)) return;
      const lit = hover === null || i === hover || near.has(i);
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fillStyle = color[n.group];
      ctx.shadowColor = color[n.group]; ctx.shadowBlur = i === hover ? 10 : 0;
      ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, 6.3); ctx.fill();
      ctx.shadowBlur = 0;
      if (n.pinned) {
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2 / view.k;
        ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2.5 / view.k, 0, 6.3); ctx.stroke();
        ctx.lineWidth = 1 / view.k;
      }
      if (i === hover || (hover !== null && near.has(i)) || (hover === null && n.degree >= 14 && view.k > 0.45)) {
        ctx.fillStyle = ink;
        ctx.font = `${(i === hover ? 13 : 11) / view.k}px -apple-system, sans-serif`;
        ctx.fillText(n.title, n.x + radius(n) + 4 / view.k, n.y + 4 / view.k);
      }
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  const pick = (e) => {
    const [x, y] = toWorld(e);
    let best = null, bd = 14 / view.k;
    nodes.forEach((n, i) => { if (!shown(n)) return; const d = Math.hypot(n.x - x, n.y - y) - radius(n); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  cv.onmousemove = (e) => {
    if (drag && drag.node !== null) {
      const n = nodes[drag.node];
      [n.x, n.y] = toWorld(e);
      n.pinned = true; drag.moved = true; heat = Math.max(heat, 0.3);
      return;
    }
    if (drag) { view.x += e.movementX; view.y += e.movementY; drag.moved = true; return; }
    hover = pick(e);
    cv.style.cursor = hover !== null ? "pointer" : "grab";
  };
  cv.onmousedown = (e) => (drag = { moved: false, node: e.shiftKey ? null : pick(e) });
  cv.onmouseleave = () => {
    if (drag && drag.node !== null && drag.moved) savePins();
    drag = null; hover = null;
  };
  cv.onmouseup = (e) => {
    const was = drag; drag = null;
    const hit = pick(e);
    if (was && was.node !== null && was.moved) return savePins();
    if (!was || was.moved || hit === null) return;
    if (e.shiftKey) {
      if (nodes[hit].pinned) { nodes[hit].pinned = false; heat = Math.max(heat, 0.3); savePins(); }
      return;
    }
    location.hash = href(nodes[hit].id);
  };
  for (const b of document.querySelectorAll(".legend .lg[data-g]")) b.onclick = () => {
    const k = b.dataset.g;
    hidden.has(k) ? hidden.delete(k) : hidden.add(k);
    b.classList.toggle("off", hidden.has(k));
    b.setAttribute("aria-pressed", String(!hidden.has(k)));
    if (hover !== null && !shown(nodes[hover])) hover = null;
    heat = Math.max(heat, 0.5);
    savePins();
  };
  $(".legend .unpin").onclick = () => {
    for (const n of nodes) n.pinned = false;
    heat = Math.max(heat, 0.5);
    savePins();
  };
  $(".legend .unpin").hidden = !nodes.some((n) => n.pinned);
  cv.onwheel = (e) => { e.preventDefault(); view.k = Math.max(0.2, Math.min(3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); };
  for (let i = 0; i < 220; i++) step();
  stopGraph = () => (alive = false);
  draw();
}

// ───────────── sphere ─────────────
// The whole vault on a globe, drawn in lines: each section of notes has its own ringed patch, and every link is a line.
// Drawn on a 2D canvas with its own projection.
async function viewSphere(live) {
  const g = await api("/api/graph");
  if (!live()) return;
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#22d3ee", "#fb7185", "#94a3b8", "#c084fc"];
  const color = Object.fromEntries(groups.map((k, i) => [k, palette[i % palette.length]]));
  const label = (k) => k.replace(/^\d+\s+/, "");
  page(`
    <div class="sphere">
      <canvas id="sphere"></canvas>
      <div class="hud hud-left" id="hudl"></div>
      <div class="hud hud-right" id="hudr"></div>
      <div class="hud hud-foot" id="hudf"></div>
    </div>`, { cls: "wide", title: "<b>Sphere</b>", stat: "Drag to spin · scroll to zoom · click a section name to pull it up · click a point · shift-click a second one to trace the route · double-click to open" });
  const cv = $("#sphere"), ctx = cv.getContext("2d");
  const N = g.nodes.length, GA = Math.PI * (3 - Math.sqrt(5));
  // Each section gets a patch of the globe sized to how many notes it holds; patches are nudged apart so they never touch.
  const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const members = Object.fromEntries(groups.map((k) => [k, g.nodes.filter((n) => n.group === k).sort((a, b) => a.title.localeCompare(b.title))]));
  const patch = groups.map((k, i) => {
    const y = 1 - (2 * (i + 0.5)) / groups.length, r = Math.sqrt(1 - y * y), phi = i * GA;
    return { k, c: [Math.cos(phi) * r, y, Math.sin(phi) * r], a: Math.acos(1 - 2 * Math.min(0.45, (members[k].length / N) * 0.5)) + 0.05 };
  });
  for (let pass = 0; pass < 300; pass++) {
    for (let i = 0; i < patch.length; i++) for (let j = i + 1; j < patch.length; j++) {
      const A = patch[i], B = patch[j];
      const gap = Math.acos(Math.max(-1, Math.min(1, A.c[0] * B.c[0] + A.c[1] * B.c[1] + A.c[2] * B.c[2])));
      const want = A.a + B.a + 0.1;
      if (gap >= want) continue;
      const push = (want - gap) * 0.2, d = norm([A.c[0] - B.c[0] + 1e-6, A.c[1] - B.c[1], A.c[2] - B.c[2]]);
      A.c = norm([A.c[0] + d[0] * push, A.c[1] + d[1] * push, A.c[2] + d[2] * push]);
      B.c = norm([B.c[0] - d[0] * push, B.c[1] - d[1] * push, B.c[2] - d[2] * push]);
    }
  }
  const around = (P, ang, turn) => { // a point `ang` radians from the middle of a patch, in direction `turn`
    const u = norm(cross(P.c, Math.abs(P.c[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(P.c, u);
    const ca = Math.cos(ang), sa = Math.sin(ang), ct = Math.cos(turn), st = Math.sin(turn);
    return [P.c[0] * ca + (u[0] * ct + v[0] * st) * sa, P.c[1] * ca + (u[1] * ct + v[1] * st) * sa, P.c[2] * ca + (u[2] * ct + v[2] * st) * sa];
  };
  const patchOf = Object.fromEntries(patch.map((P) => [P.k, P]));
  const nodes = patch.flatMap((P) => members[P.k].map((n, i, all) =>
    ({ ...n, p: around(P, (P.a - 0.05) * Math.sqrt((i + 0.5) / all.length), i * GA), s: [0, 0, 0, 1] })));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = g.edges.map(([a, b]) => [idx[a], idx[b]]).filter(([a, b]) => a !== undefined && b !== undefined);
  const near = nodes.map(() => new Set());
  for (const [a, b] of edges) { near[a].add(b); near[b].add(a); }

  let rotY = 0.6, rotX = 0.25, velY = 0.0022, velX = 0, zoom = 1, target = null;
  let hover = null, picked = null, onlyGroup = null, drag = null, alive = true, t = 0;
  let trail = [], trailSet = new Set(); // a chain of links between two notes, when one is being traced
  const CAM = 3.2;
  let CX = 0, CY = 0; // where the globe sits; it moves up when the details panel is docked below

  function rotate([x, y, z]) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX), sx = Math.sin(rotX);
    const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
    return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
  }
  function project(v, R, w, h) {
    const [x, y, z] = rotate(v), k = CAM / (CAM - z);
    return [CX + x * R * k, CY - y * R * k, z, k];
  }
  const lit = (i) => {
    if (trail.length) return trail.includes(i);
    if (onlyGroup && nodes[i].group !== onlyGroup) return false;
    const focus = hover ?? picked;
    return focus === null || i === focus || near[focus].has(i);
  };

  function drawHud() {
    const counts = Object.fromEntries(groups.map((k) => [k, 0]));
    nodes.forEach((n) => counts[n.group]++);
    $("#hudl").innerHTML = `<div class="hud-title">Sections</div>` + groups.map((k) =>
      `<button class="hud-row${onlyGroup === k ? " on" : ""}" data-group="${esc(k)}"><i style="background:${color[k]}"></i>${esc(label(k))}<b>${counts[k]}</b></button>`).join("");
    $("#hudl").querySelectorAll("[data-group]").forEach((b) => (b.onclick = () => pull(onlyGroup === b.dataset.group ? null : b.dataset.group)));
    const n = picked !== null ? nodes[picked] : null;
    $("#hudr").innerHTML = n ? `
      <div class="hud-title" style="color:${color[n.group]}">${esc(label(n.group))}</div>
      <h3>${esc(n.title)}</h3>
      <div class="hud-meta">${esc(n.created)} · ${n.words} words · ${n.inn} in · ${n.out} out</div>
      <p>${esc(n.excerpt)}</p>
      ${trail.length ? `<div class="hud-title">Route · ${trail.length - 1} step${trail.length === 2 ? "" : "s"}</div><div class="hud-links">${trail.map((j) => `<button data-go="${j}"><i style="background:${color[nodes[j].group]}"></i>${esc(nodes[j].title)}</button>`).join("")}</div>` : ""}
      <div class="hud-title">Linked</div>
      <div class="hud-links">${[...near[picked]].slice(0, 9).map((j) => `<button data-go="${j}"><i style="background:${color[nodes[j].group]}"></i>${esc(nodes[j].title)}</button>`).join("") || "<span>Nothing yet</span>"}</div>
      <a class="hud-open" href="${href(n.id)}">Open note →</a>
      <div class="hud-meta" style="margin-top:8px">Shift-click another point to trace how the two connect.</div>` : onlyGroup ? `
      <div class="hud-title" style="color:${color[onlyGroup]}">${esc(label(onlyGroup))} · ${members[onlyGroup].length} notes</div>
      <div class="hud-links">${members[onlyGroup].map((m) => `<button data-go="${idx[m.id]}" title="${esc(m.excerpt)}">${esc(m.title)}</button>`).join("")}</div>
      <button class="hud-open hud-back" id="hud-all">← All sections</button>` : `
      <div class="hud-title">Vault</div>
      <div class="hud-big">${N}<small>notes</small></div>
      <div class="hud-big">${edges.length}<small>links</small></div>
      <div class="hud-meta">Click a section on the left to pull it up, or a point for its details.</div>`;
    if ($("#hud-all")) $("#hud-all").onclick = () => pull(null);
    $("#hudr").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => select(+b.dataset.go)));
  }
  // Pull one section up: turn the globe to it, fade the rest and list its notes.
  function pull(k) {
    onlyGroup = k;
    picked = null; trail = []; trailSet = new Set();
    if (k) {
      const [x, y, z] = patchOf[k].c;
      target = { y: Math.atan2(-x, z), x: Math.atan2(y, Math.hypot(x, z)) };
      velY = 0; velX = 0;
    }
    drawHud();
  }
  function select(i) {
    picked = i;
    trail = [];
    trailSet = new Set();
    if (i !== null) {
      const [x, y, z] = nodes[i].p;
      target = { y: Math.atan2(-x, z), x: Math.atan2(y, Math.hypot(x, z)) };
      velY = 0; velX = 0;
    }
    drawHud();
  }

  // Shortest chain of links from the picked note to another one.
  function trace(to) {
    // Index pages link to everything, so a route through one says nothing. Try without them first.
    const search = (skipHubs) => {
      const prev = new Map([[picked, null]]), queue = [picked];
      while (queue.length && !prev.has(to)) {
        const at = queue.shift();
        for (const next of near[at]) {
          if (prev.has(next) || (skipHubs && nodes[next].hub && next !== to)) continue;
          prev.set(next, at);
          queue.push(next);
        }
      }
      return prev;
    };
    let prev = search(true);
    if (!prev.has(to)) prev = search(false);
    if (!prev.has(to)) return toast("No chain of links joins those two notes.");
    trail = [];
    for (let at = to; at !== null; at = prev.get(at)) trail.unshift(at);
    trailSet = new Set(trail.slice(1).map((b, k) => trail[k] + "-" + b));
    drawHud();
  }

  function frame() {
    if (!alive) return;
    t++;
    const box = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (cv.width !== Math.round(box.width * d) || cv.height !== Math.round(box.height * d)) { cv.width = Math.round(box.width * d); cv.height = Math.round(box.height * d); }
    const w = box.width, h = box.height, narrow = w < 700;
    CX = w / 2; CY = narrow ? h * 0.36 : h / 2;
    const R = Math.min(w, narrow ? h * 0.66 : h) * 0.36 * zoom;
    if (target) {
      let dy = ((target.y - rotY + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const dx = target.x - rotX;
      rotY += dy * 0.09; rotX += dx * 0.09;
      if (Math.abs(dy) + Math.abs(dx) < 0.004) target = null;
    } else if (!drag) {
      rotY += velY; rotX += velX;
      velX *= 0.94;
      const idle = hover === null && picked === null ? 0.0022 : 0;
      velY += (idle - velY) * 0.03;
    }
    rotX = Math.max(-1.35, Math.min(1.35, rotX));

    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = "#0b0b0d"; ctx.fillRect(0, 0, w, h);

    // latitude and longitude wires
    ctx.lineWidth = 1;
    const wire = (pts) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.strokeStyle = `rgba(255,255,255,${0.025 + Math.max(0, (a[2] + b[2]) / 2 + 0.2) * 0.05})`;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    };
    for (let la = -60; la <= 60; la += 30) {
      const y = Math.sin((la * Math.PI) / 180), r = Math.cos((la * Math.PI) / 180), pts = [];
      for (let a = 0; a <= 360; a += 10) pts.push(project([Math.cos((a * Math.PI) / 180) * r, y, Math.sin((a * Math.PI) / 180) * r], R, w, h));
      wire(pts);
    }
    for (let lo = 0; lo < 180; lo += 30) {
      const pts = [];
      for (let a = 0; a <= 360; a += 10) {
        const th = (a * Math.PI) / 180, ph = (lo * Math.PI) / 180;
        pts.push(project([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)], R, w, h));
      }
      wire(pts);
    }
    // a ring around each section, with its name
    for (const P of patch) {
      const dim = onlyGroup && onlyGroup !== P.k;
      ctx.strokeStyle = color[P.k]; ctx.lineWidth = onlyGroup === P.k ? 1.6 : 1;
      let last = null;
      for (let a = 0; a <= 360; a += 6) {
        const q = project(around(P, P.a, (a * Math.PI) / 180), R, w, h);
        if (last) {
          ctx.globalAlpha = (dim ? 0.12 : 0.75) * (0.15 + 0.85 * Math.max(0, Math.min(1, ((last[2] + q[2]) / 2 + 0.5) / 1.2)));
          ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        last = q;
      }
      const top = project(around(P, P.a + 0.07, Math.PI / 2), R, w, h);
      if (top[2] > 0.05 && !dim) {
        ctx.globalAlpha = Math.min(1, top[2] * 2.2);
        ctx.font = "600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.fillStyle = color[P.k]; ctx.textAlign = "center";
        ctx.fillText(label(P.k).toUpperCase(), top[0], top[1]);
        ctx.textAlign = "start";
      }
    }
    ctx.globalAlpha = 1;

    nodes.forEach((n) => (n.s = project(n.p, R, w, h)));
    const focus = hover ?? picked;

    // links: straight lines, in the section's colour when both ends share one
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j], on = focus !== null && (i === focus || j === focus);
      const groupOk = !onlyGroup || a.group === onlyGroup || b.group === onlyGroup;
      const depth = (a.s[2] + b.s[2]) / 2, same = a.group === b.group;
      const onTrail = trailSet.size && (trailSet.has(i + "-" + j) || trailSet.has(j + "-" + i));
      ctx.strokeStyle = onTrail ? "#fff" : on ? color[nodes[focus].group] : same ? color[a.group] : "#cfc8e6";
      ctx.globalAlpha = onTrail || on ? 1 : trail.length || focus !== null || !groupOk ? 0.04 : (same ? 0.2 : 0.1) + Math.max(0, depth + 0.4) * (same ? 0.4 : 0.16);
      ctx.lineWidth = onTrail ? 2.2 : on ? 1.5 : 0.8;
      ctx.beginPath(); ctx.moveTo(a.s[0], a.s[1]); ctx.lineTo(b.s[0], b.s[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // points, far ones first
    const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].s[2] - nodes[b].s[2]);
    for (const i of order) {
      const n = nodes[i], [x, y, z, k] = n.s, on = lit(i);
      const r = (1.3 + Math.sqrt(n.degree) * 0.42) * k * Math.sqrt(zoom);
      ctx.globalAlpha = (on ? 1 : 0.14) * (0.3 + 0.7 * Math.max(0, Math.min(1, (z + 1) / 1.6)));
      ctx.fillStyle = color[n.group];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
      if (i === picked || i === hover) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 6.3); ctx.stroke();
      }
      const show = trail.includes(i) || i === focus || (focus !== null && near[focus].has(i) && z > -0.3) || (focus === null && on && z > 0.45 && n.degree >= 14) || (focus === null && onlyGroup === n.group && z > 0.2);
      if (show) {
        ctx.globalAlpha = i === focus ? 1 : 0.85;
        ctx.font = `${i === focus ? 600 : 400} ${i === focus ? 13 : 11}px -apple-system, sans-serif`;
        ctx.fillStyle = "#f1ecff";
        ctx.fillText(n.title, x + r + 6, y + 4);
      }
    }
    ctx.globalAlpha = 1;

    // corner brackets
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
    for (const [bx, by, sx, sy] of [[14, 14, 1, 1], [w - 14, 14, -1, 1], [14, h - 14, 1, -1], [w - 14, h - 14, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(bx + 18 * sx, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + 18 * sy); ctx.stroke();
    }
    const deg = (a) => String(Math.round((((a * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, "0");
    $("#hudf").textContent = `AZ ${deg(rotY)}°  ·  EL ${deg(rotX)}°  ·  ZOOM ${zoom.toFixed(2)}×  ·  ${focus !== null ? nodes[focus].title.toUpperCase() : onlyGroup ? label(onlyGroup).toUpperCase() : "ALL SECTIONS"}`;
    requestAnimationFrame(frame);
  }

  const pick = (e) => {
    const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
    let best = null, bd = 16;
    nodes.forEach((n, i) => {
      if (n.s[2] < -0.15 || (onlyGroup && n.group !== onlyGroup)) return;
      const dd = Math.hypot(n.s[0] - mx, n.s[1] - my) - n.s[2] * 3;
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  };
  cv.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; target = null; cv.style.cursor = "grabbing"; };
  cv.onmousemove = (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      rotY += dx * 0.006; rotX += dy * 0.006; velY = dx * 0.006; velX = dy * 0.006;
      return;
    }
    hover = pick(e);
    cv.style.cursor = hover !== null ? "pointer" : "grab";
  };
  const release = (e) => {
    const was = drag; drag = null; cv.style.cursor = "grab";
    if (was && was.moved < 5 && e.type === "mouseup") {
      const hit = pick(e);
      if (e.shiftKey && picked !== null && hit !== null && hit !== picked) trace(hit);
      else select(hit);
    }
  };
  cv.onmouseup = release;
  cv.onmouseleave = (e) => { release(e); hover = null; };
  cv.ondblclick = (e) => { const i = pick(e); if (i !== null) location.hash = href(nodes[i].id); };
  cv.onwheel = (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(2.4, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); };
  stopGraph = () => (alive = false);
  window.__sphere = { nodes, select, trace, pull, patch, trail: () => trail, state: () => ({ rotY, rotX, zoom, picked, hover, onlyGroup }) };
  drawHud();
  frame();
}

// ───────────── command palette ─────────────
const pal = $("#palette"), pq = $("#pq"), pl = $("#pl");
const SCREENS = [["today", "Today"], ["tasks", "Tasks"], ["connect", "Connect"], ["tensions", "Tensions"], ["graph", "Graph"], ["sphere", "Sphere"], ["ask", "Ask"], ["digest", "Digest"], ["settings", "Settings"]];
let palItems = [], palAt = 0, palMode = "jump", palSeq = 0, palTimer;

// Scores how well the typed letters match a title; null when they do not appear in order.
function fuzzy(q, s) {
  const at = s.indexOf(q);
  if (at >= 0) return 1000 - at * 2 - (s.length - q.length) * 0.1 + (at === 0 || /\W/.test(s[at - 1]) ? 50 : 0);
  let score = 0, last = -1, i = 0;
  for (const c of q) {
    i = s.indexOf(c, last + 1);
    if (i < 0) return null;
    score -= i - last - 1;
    last = i;
  }
  if (score < -Math.max(6, q.length * 2)) return null; // the letters are there but too scattered to mean anything
  return 400 + score - s.length * 0.1;
}
function hilite(title, q) {
  const low = title.toLowerCase(), at = low.indexOf(q);
  if (q && at >= 0) return esc(title.slice(0, at)) + "<u>" + esc(title.slice(at, at + q.length)) + "</u>" + esc(title.slice(at + q.length));
  let out = "", from = 0;
  for (const c of q) {
    const i = low.indexOf(c, from);
    if (i < 0) return esc(title);
    out += esc(title.slice(from, i)) + "<u>" + esc(title[i]) + "</u>";
    from = i + 1;
  }
  return out + esc(title.slice(from));
}
function openPalette(mode = "jump") {
  palMode = mode;
  pq.value = "";
  pq.placeholder = mode === "new" ? "Name the new note" : "Type a note name, or some words to search for";
  if (!pal.open) pal.showModal();
  buildPalette();
  pq.focus();
}
async function createNote(title, template) {
  const { path } = await api("/api/note", { body: { title, template } });
  await loadNotes();
  editNext = path;
  location.hash = href(path);
}
function buildPalette(inside = []) {
  const q = pq.value.trim(), ql = q.toLowerCase();
  const items = [];
  const noteItem = (n, group, hint) => ({ group, html: hilite(n.title, group === "Notes" ? ql : ""), hint: hint ?? folderName(n.folder), run: () => (location.hash = href(n.path)) });
  // Notes in a Templates folder, offered as starting points for a new note.
  const fromTemplates = () => notes.filter((n) => /(^|\/)templates$/i.test(n.folder)).sort((a, b) => a.title.localeCompare(b.title))
    .forEach((t) => items.push({ group: "From a template", html: `Create “${esc(q)}” from ${esc(t.title)}`, hint: t.folder, run: () => createNote(q, t.path) }));
  if (palMode === "new") {
    if (q) items.push({ group: "New note", html: `Create “${esc(q)}”`, hint: "opens in the editor", run: () => createNote(q) });
    if (q) fromTemplates();
  } else if (!q) {
    JSON.parse(localStorage.getItem("ember-recent") || "[]").map((p) => byPath[p]).filter(Boolean).forEach((n) => items.push(noteItem(n, "Recently opened")));
    SCREENS.forEach(([v, name]) => items.push({ group: "Go to", html: name, hint: "", run: () => (location.hash = "#/" + v) }));
  } else {
    notes.map((n) => ({ n, s: fuzzy(ql, n.title.toLowerCase()) })).filter((x) => x.s !== null).sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title)).slice(0, 7)
      .forEach(({ n }) => items.push(noteItem(n, "Notes")));
    const have = new Set(items.map((it) => it.html));
    inside.filter((h) => !have.has(hilite(h.title, ql))).slice(0, 5).forEach((h) => items.push(noteItem(h, "Inside notes", h.snippet)));
    SCREENS.filter(([, name]) => name.toLowerCase().startsWith(ql)).forEach(([v, name]) => items.push({ group: "Go to", html: name, hint: "", run: () => (location.hash = "#/" + v) }));
    items.push({ group: "Actions", html: `Search inside every note for “${esc(q)}”`, hint: "", run: () => (location.hash = "#/search/" + encodeURIComponent(q)) });
    if (!byTitle[ql]) items.push({ group: "Actions", html: `Create a note called “${esc(q)}”`, hint: "", run: () => createNote(q) });
    if (!byTitle[ql]) fromTemplates();
  }
  palItems = items;
  palAt = Math.min(palAt, Math.max(0, items.length - 1));
  let group = "";
  pl.innerHTML = items.map((it, i) => `${it.group !== group ? `<div class="pal-group">${(group = it.group)}</div>` : ""}<div class="pal-item${i === palAt ? " on" : ""}" role="option" aria-selected="${i === palAt}" data-i="${i}"><span>${it.html}</span><small>${esc(it.hint)}</small></div>`).join("")
    || `<div class="pal-none">${palMode === "new" ? "Type a name, then press Return." : "Nothing matches."}</div>`;
}
function movePalette(to) {
  if (!palItems.length) return;
  palAt = (to + palItems.length) % palItems.length;
  $$(".pal-item", pl).forEach((el, i) => {
    el.classList.toggle("on", i === palAt);
    el.setAttribute("aria-selected", i === palAt);
    if (i === palAt) el.scrollIntoView({ block: "nearest" });
  });
}
const runPalette = guard(async (i) => {
  const it = palItems[i];
  if (!it) return;
  pal.close();
  await it.run();
});
pq.addEventListener("input", () => {
  palAt = 0;
  buildPalette();
  clearTimeout(palTimer);
  const q = pq.value.trim(), seq = ++palSeq;
  if (palMode !== "jump" || q.length < 2) return;
  palTimer = setTimeout(async () => {
    try {
      const { hits } = await api("/api/search?q=" + encodeURIComponent(q));
      if (seq === palSeq && pal.open) buildPalette(hits);
    } catch {}
  }, 140);
});
pq.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "ArrowDown") { e.preventDefault(); movePalette(palAt + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); movePalette(palAt - 1); }
  else if (e.key === "Enter") { e.preventDefault(); runPalette(palAt); }
});
pl.addEventListener("mousemove", (e) => {
  const el = e.target.closest(".pal-item");
  if (el && +el.dataset.i !== palAt) movePalette(+el.dataset.i);
});
pl.addEventListener("click", (e) => {
  const el = e.target.closest(".pal-item");
  if (el) runPalette(+el.dataset.i);
});
pal.addEventListener("click", (e) => {
  if (e.target === pal) pal.close(); // a click on the dimmed area around it
});

// ───────────── routing ─────────────
let routeSeq = 0, shownHash = location.hash;
async function route() {
  // Leaving a half-edited note asks first; saying no puts the address back and keeps the editor as it is.
  if (dirty && location.hash !== shownHash) {
    if (!confirm("Leave this note without saving your changes?")) return void (location.hash = shownHash);
    dirty = false;
  }
  if (dirty) return;
  shownHash = location.hash;
  const seq = ++routeSeq, live = () => seq === routeSeq;
  stopGraph();
  hidePeek();
  if (canSpeak) speechSynthesis.cancel();
  stopDictation();
  $("#side").classList.remove("open");
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const view = parts[0] || "today";
  const arg = safeDecode(parts.slice(1).join("/"));
  markActive();
  try {
    if (view === "note") await viewNote(live, arg);
    else if (view === "search") await viewSearch(live, arg);
    else if (view === "tag") viewTag(live, arg);
    else if (view === "tasks") await viewTasks(live);
    else if (view === "connect") await viewConnect(live);
    else if (view === "tensions") await viewTensions(live);
    else if (view === "graph") await viewGraph(live);
    else if (view === "sphere") await viewSphere(live);
    else if (view === "ask") await viewAsk(live);
    else if (view === "digest") await viewDigest(live);
    else if (view === "settings") await viewSettings(live);
    else await viewToday(live);
  } catch (err) {
    if (live()) page(`<h1 class="page">Something went wrong</h1><p class="lede">${esc(err.message)}</p>`);
  }
  if (live()) main.scrollTop = 0;
}

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  if (e.key === "k") {
    e.preventDefault();
    pal.open ? pal.close() : openPalette();
  } else if (e.key === "e" && !pal.open && $("#edit")) {
    e.preventDefault();
    $("#edit").click();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
// ───────────── hover preview ─────────────
const peek = $("#peek");
let peekTimer;
function hidePeek() {
  clearTimeout(peekTimer);
  peek.hidden = true;
}
const noteLink = (el) => el.closest?.('a[href^="#/note/"]');
main.addEventListener("mouseover", (e) => {
  const a = noteLink(e.target);
  const n = a && byPath[safeDecode(a.getAttribute("href").slice(7))];
  if (!n || !n.excerpt) return;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!a.isConnected) return;
    peek.innerHTML = `<b>${esc(n.title)}</b><small>${esc(folderName(n.folder))} · ${plural(n.words, "word")}</small><p>${esc(n.excerpt)}</p>`;
    peek.hidden = false;
    const r = a.getBoundingClientRect(), h = peek.offsetHeight;
    peek.style.left = Math.max(8, Math.min(r.left, innerWidth - 332)) + "px";
    peek.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6) + "px";
  }, 450);
});
main.addEventListener("mouseout", (e) => {
  if (noteLink(e.target)) hidePeek();
});
main.addEventListener("scroll", hidePeek, { passive: true });

// ───────────── changes made outside the app ─────────────
// The server watches the folder. When its version moves, reload the list, and the open note if it was the one edited.
setInterval(async () => {
  if (document.hidden || dirty) return;
  try {
    const { version } = await api("/api/version");
    if (version === lastVersion) return;
    const [, view, rest] = location.hash.split("/");
    const open = view === "note" ? safeDecode(rest || "") : null, before = open && byPath[open]?.mtime;
    await loadNotes();
    if (open && !dirty && byPath[open]?.mtime !== before) {
      const y = main.scrollTop;
      await route();
      main.scrollTop = y;
    }
  } catch {}
}, 4000);

$("#back").onclick = () => history.back();
$("#fwd").onclick = () => history.forward();
$("#open-palette").onclick = () => openPalette();
$("#new").onclick = () => openPalette("new");
$("#menu").onclick = () => $("#side").classList.toggle("open");
window.addEventListener("hashchange", route);
loadNotes().then(route).catch((err) => page(`<h1 class="page">Phlox could not start</h1><p class="lede">${esc(err.message)}</p>`));
