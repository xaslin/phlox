// Ember front end. No framework: hash routes, fetch, and a small Markdown renderer.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $("#main");
let notes = [];
let byTitle = {};
let byPath = {};
let dirty = false; // an edit that has not been saved
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
  return n ? `<a class="wl" href="${href(n.path)}">${shown}</a>` : `<span class="wl missing" title="No note with this name yet">${shown}</span>`;
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
  const links = notes.reduce((a, n) => a + n.out, 0);
  $("#vaultstat").textContent = `${notes.length} notes · ${links} links`;
  drawTree();
  refreshBadges();
}
// How many suggestions and conflicts are waiting, shown beside their screens.
async function refreshBadges() {
  try {
    const [c, t] = await Promise.all([api("/api/connect"), api("/api/tensions")]);
    $("#b-connect").textContent = c.pairs.length || "";
    $("#b-tensions").textContent = t.tensions.length || "";
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
      return `<details data-id="${esc(id)}"${open.has(id) ? " open" : ""}><summary>${esc(k.replace(/^\d+\s+/, ""))}<small>${node.kids[k].count}</small></summary><div class="kids">${walk(node.kids[k], id + "/")}</div></details>`;
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
const page = (html, cls = "") => (main.innerHTML = `<div class="wrap ${cls}">${html}</div>`);
const chips = (n) => (n.tags || []).map((t) => `<a class="chip" href="${tagHref(t)}">${esc(t)}</a>`).join("");
const keyNotice = `<div class="notice">This needs your own Anthropic API key. Add one in <a href="#/settings">Settings</a>. Everything else works without it.</div>`;
const noteRows = (list) => `<div class="rows">${list.map((n) => `<a href="${href(n.path)}"><span>${esc(n.title)}</span><small>${esc(folderName(n.folder))} · ${n.words} words</small></a>`).join("")}</div>`;

async function viewToday(live) {
  const d = await api("/api/today");
  if (!live()) return;
  const nice = new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  page(`
    <div class="eyebrow">${esc(nice)}</div>
    <h1 class="page">Three notes worth another look</h1>
    <p class="lede">Picked for today from notes you have not opened in a while. Older and better-connected notes come up more often.</p>
    <form class="capture" id="capture"><input name="text" placeholder="Capture a thought. It goes to your Inbox." autocomplete="off" aria-label="Capture a thought"><button class="btn primary">Capture</button></form>
    <div class="picks">${d.picks.map((p, i) => `
      <article class="card">
        <span class="num">${i + 1}</span>
        <h2>${link(p)}</h2>
        <div class="why">${esc(p.why)}</div>
        <p>${esc(p.excerpt)}</p>
        <div class="row">${chips(p)}${p.source ? `<span class="chip plain">from ${esc(p.source.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</span>` : ""}</div>
      </article>`).join("") || `<div class="empty">No notes yet. Point Ember at a folder in Settings.</div>`}</div>
    <div class="stats">
      <div class="stat"><b>${d.stats.notes}</b><span>notes</span></div>
      <div class="stat"><b>${d.stats.links}</b><span>links</span></div>
      <div class="stat"><b>${d.stats.words.toLocaleString()}</b><span>words</span></div>
      <div class="stat"><b>${d.stats.unopened}</b><span>never opened here</span></div>
    </div>
    ${d.stats.orphans.length ? `<h3 class="section">Nothing links to these</h3><div class="linklist">${d.stats.orphans.slice(0, 14).map((o) => link(o)).join("")}</div>` : ""}
  `);
  $("#capture").addEventListener("submit", guard(async (e) => {
    e.preventDefault();
    const input = e.target.text;
    if (!input.value.trim()) return;
    await api("/api/capture", { body: { text: input.value } });
    input.value = "";
    toast("Saved to Inbox");
    await loadNotes();
  }));
}

async function viewNote(live, path) {
  let n;
  try {
    n = await api("/api/note?path=" + encodeURIComponent(path));
  } catch (err) {
    if (live()) page(`<h1 class="page">Note not found</h1><p class="lede">${esc(err.message)} It may have been renamed or deleted. Press ⌘K to look for it.</p>`);
    return;
  }
  if (!live()) return;
  const recent = [n.path, ...JSON.parse(localStorage.getItem("ember-recent") || "[]").filter((p) => p !== n.path)].slice(0, 6);
  localStorage.setItem("ember-recent", JSON.stringify(recent));
  const crumbs = `${n.folder ? esc(folderName(n.folder)).replace(/ \/ /g, " <i>/</i> ") + " <i>/</i> " : ""}<b>${esc(n.title)}</b>`;
  const src = n.source && /^https?:/.test(n.source) ? `<a href="${esc(n.source)}" target="_blank" rel="noopener noreferrer">original</a>` : esc(n.source);

  const show = () => {
    dirty = false;
    const heads = [];
    const body = render(n.body, { heads, line0: n.raw.split("\n").length - n.body.split("\n").length });
    const toc = heads.filter((h) => h.lvl === 2 || h.lvl === 3);
    page(`
      <div class="crumbs">${crumbs}<span class="grow"></span><button class="btn" id="edit" title="Edit (⌘E)">Edit</button></div>
      <div class="note-layout">
        <article>
          <div class="meta">${chips(n)}<span>${n.words} words</span><span>${esc(n.created)}</span>${src ? `<span>${src}</span>` : ""}</div>
          <div class="md">${body}</div>
        </article>
        <aside class="rail">
          ${toc.length > 1 ? `<div><h3 class="section">On this page</h3><div class="toc">${toc.map((h) => `<a href="#" class="l${h.lvl}" data-head="${h.id}">${esc(h.text)}</a>`).join("")}</div></div>` : ""}
          <div><h3 class="section">Linked from${n.backlinks.length ? ` · ${n.backlinks.length}` : ""}</h3>${n.backlinks.length ? `<ul>${n.backlinks.map((b) => `<li>${link(b)}<small>${esc(b.context)}</small></li>`).join("")}</ul>` : `<p class="none">Nothing links here yet.</p>`}</div>
          <div><h3 class="section">Reads like</h3>${n.related.length ? `<ul>${n.related.map((r) => `<li>${link(r)}${r.linked ? "" : ` <button class="ghost" data-link="${esc(r.path)}" title="Add a link to this note">+ link</button>`}<small>${Math.round(r.score * 100)}% alike${r.linked ? " · linked" : ""}</small></li>`).join("")}</ul>` : `<p class="none">Nothing similar found.</p>`}</div>
        </aside>
      </div>`, "note");
    $("#edit").onclick = edit;
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
    // Ticking a checkbox rewrites that one line of the file.
    $$("input[data-line]", main).forEach((box) => (box.onchange = async () => {
      const lines = n.raw.split("\n"), at = +box.dataset.line;
      const next = (lines[at] || "").replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/, (_, pre) => `${pre}[${box.checked ? "x" : " "}]`);
      try {
        if (next === lines[at]) throw new Error("That line changed on disk. Reopen the note.");
        lines[at] = next;
        await api("/api/note", { method: "PUT", body: { path: n.path, raw: lines.join("\n") } });
        n.raw = lines.join("\n");
        box.closest("li").classList.toggle("done", box.checked);
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      }
    }));
  };

  const edit = () => {
    page(`
      <div class="crumbs">${crumbs}<span class="grow"></span><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div>
      <div class="meta"><span>Plain Markdown. Link to another note with [[Its Title]]. ⌘S saves.</span></div>
      <div class="edit-split"><textarea class="editor" id="raw" spellcheck="true" aria-label="Note text"></textarea><div class="md preview" id="preview" aria-label="Preview"></div></div>`, "note");
    const ta = $("#raw"), pv = $("#preview");
    ta.value = n.raw;
    const preview = () => (pv.innerHTML = render(ta.value.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "")));
    preview();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener("input", () => {
      dirty = ta.value !== n.raw;
      preview();
    });
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
    <div class="eyebrow">${pairs.length} suggestion${pairs.length === 1 ? "" : "s"}</div>
    <h1 class="page">Notes that should know about each other</h1>
    <p class="lede">These pairs use the same rare words but do not link to each other. Linking adds a "See also" line to the first note.</p>
    ${pairs.map((p) => `
      <div class="card" data-id="${esc(p.id)}">
        <div class="pair">
          <div>${link(p.a, "t")}<small>${esc(folderName(p.a.folder))}</small></div>
          <div class="mid">${Math.round(p.score * 100)}% alike</div>
          <div>${link(p.b, "t")}<small>${esc(folderName(p.b.folder))}</small></div>
        </div>
        <div class="row"><span class="why" style="margin:0">Both mention: ${p.shared.map(esc).join(", ")}</span><span class="grow"></span>
          <button class="btn" data-dismiss>Not related</button><button class="btn primary" data-from="${esc(p.a.path)}" data-to="${esc(p.b.path)}">Link them</button></div>
      </div>`).join("") || `<div class="empty">Every similar pair is already linked.</div>`}
  `);
  $$("[data-from]", main).forEach((b) => (b.onclick = guard(async () => {
    b.disabled = true;
    await api("/api/link", { body: { from: b.dataset.from, to: b.dataset.to } }).finally(() => (b.disabled = false));
    b.closest(".card").remove();
    toast("Linked");
    await loadNotes();
  })));
  wireDismiss();
}
function wireDismiss() {
  $$("[data-dismiss]", main).forEach((b) => (b.onclick = guard(async () => {
    const card = b.closest(".card");
    await api("/api/dismiss", { body: { id: card.dataset.id } });
    card.remove();
    refreshBadges();
  })));
}

async function viewTensions(live) {
  const d = await api("/api/tensions");
  if (!live()) return;
  const side = (x, big) => `<div>${big !== undefined ? `<big>${esc(big)}</big>` : ""}<q>${esc(x.sentence)}</q>${link(x)}${x.section && x.section !== x.title ? `<small class="why"> · ${esc(x.section)}</small>` : ""}</div>`;
  page(`
    <div class="eyebrow">${d.tensions.length} found on this Mac</div>
    <h1 class="page">Where your notes disagree</h1>
    <p class="lede">Two passages that give different numbers for what looks like the same thing. A deeper read, for disagreements that are not about numbers, uses Claude.</p>
    ${d.tensions.map((t) => `
      <div class="card" data-id="${esc(t.id)}">
        <div class="versus">${side(t.a, `${t.a.value.toLocaleString()} ${t.a.shown}`)}${side(t.b, `${t.b.value.toLocaleString()} ${t.b.shown}`)}</div>
        <div class="row"><span class="grow"></span><button class="btn" data-dismiss>Not a conflict</button></div>
      </div>`).join("") || `<div class="empty">No conflicting numbers found.</div>`}
    <h3 class="section">Deeper read</h3>
    ${d.hasKey ? "" : keyNotice}
    <div class="row" style="margin:0 0 16px"><button class="btn primary" id="deep"${d.hasKey ? "" : " disabled"}>Read the whole vault for disagreements</button><span class="why" style="margin:0">Sends your notes, except hubs and session logs, to Claude once.</span></div>
    <div id="deepout"></div>
  `);
  wireDismiss();
  $("#deep").onclick = async (e) => {
    const btn = e.currentTarget, out = $("#deepout");
    btn.disabled = true;
    out.innerHTML = `<p class="why"><span class="spinner"></span>Reading. This can take a minute.</p>`;
    try {
      const { findings } = await api("/api/tensions/deep", { body: {} });
      out.innerHTML = findings.map((f) => `
        <div class="card"><div class="kind">${esc(f.kind)}</div><p style="margin:6px 0 12px">${esc(f.explanation)}</p><div class="versus">${side(f.a)}${side(f.b)}</div></div>`).join("") || `<div class="empty">Claude found nothing that disagrees.</div>`;
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
  page(`<div class="eyebrow">Search</div><h1 class="page">${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(q)}”</h1><p class="lede">Best matches first. Press ⌘K to search again.</p>
    <div class="hits">${hits.map((h) => `<div class="card"><h2>${link(h)}</h2><div class="why">${esc(folderName(h.folder))}</div><p>${mark(h.snippet)}</p></div>`).join("") || `<div class="empty">Nothing matches. Try fewer words.</div>`}</div>`);
}

function viewTag(live, tag) {
  const list = notes.filter((n) => (n.tags || []).includes(tag));
  page(`<div class="eyebrow">Tag</div><h1 class="page">${esc(tag)}</h1><p class="lede">${list.length} note${list.length === 1 ? "" : "s"} carry this tag.</p>
    ${list.length ? noteRows(list) : `<div class="empty">No notes have this tag.</div>`}`);
}

async function viewAsk(live) {
  const s = await api("/api/settings");
  if (!live()) return;
  page(`
    <div class="eyebrow">Uses Claude</div>
    <h1 class="page">Ask your notes</h1>
    <p class="lede">Ember finds the notes that match, sends those notes and your question to Claude, and shows an answer that cites them.</p>
    ${s.hasKey ? "" : keyNotice}
    <form class="askbox" id="ask"><textarea name="q" placeholder="What did I decide about the NHD thesis, and what is still unwritten?" aria-label="Your question"></textarea><button class="btn primary"${s.hasKey ? "" : " disabled"}>Ask</button></form>
    <div id="answer"></div>`);
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
    out.innerHTML = `<p class="why"><span class="spinner"></span>Finding notes and thinking.</p>`;
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
        out.innerHTML = `<div class="card md">${render(text)}</div>`;
      }
      out.innerHTML = `<div class="card md">${render(text || "*No answer came back.*")}</div><h3 class="section">Notes Claude was given</h3><div class="linklist">${sources.map((n) => link(n)).join("")}</div>`;
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
    <div class="eyebrow">Uses Claude</div>
    <h1 class="page">Digest a source</h1>
    <p class="lede">Paste an article, a transcript or lecture notes. Claude writes a source note with a summary, plus one small note per idea, each linked back to the source and to notes you already have.</p>
    ${s.hasKey ? "" : keyNotice}
    <form class="digest" id="digest">
      <input name="title" placeholder="Title (optional)" aria-label="Title">
      <textarea name="text" placeholder="Paste the text here" aria-label="Source text"></textarea>
      <input name="origin" placeholder="Where it came from: a link or a description (optional)" aria-label="Where it came from">
      <div class="row"><button class="btn primary"${s.hasKey ? "" : " disabled"}>Digest</button><span class="why" id="dstate" style="margin:0"></span></div>
    </form><div id="dout"></div>`);
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
      $("#dout").innerHTML = `<h3 class="section">Created</h3><div class="linklist">${[r.source, ...r.atoms].map((p) => (byPath[p] ? link(byPath[p]) : esc(p))).join("")}</div>`;
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
    <p class="lede">Ember reads and writes plain Markdown files in one folder. Nothing is uploaded unless you use Ask, Digest or the deeper read under Tensions.</p>
    <form id="set">
      <div class="field"><label for="vault">Notes folder</label><input id="vault" name="vault" value="${esc(s.vault)}" spellcheck="false">
        <small>${s.exists ? `${notes.length} notes found. An Obsidian vault works as is.` : "This folder does not exist."}</small></div>
      <div class="field"><label for="key">Anthropic API key</label><input id="key" name="apiKey" type="password" autocomplete="off" placeholder="${s.hasKey ? "A key is saved. Type a new one to replace it." : "sk-ant-…"}">
        <small>${s.hasKey ? `Using the key from ${esc(s.keyFrom)}. ` : ""}Stored in ~/.config/ember/config.json, readable only by you. Requests go to Anthropic with the model ${esc(s.model)} and are billed to this key.</small></div>
      <div class="row"><button class="btn primary">Save</button>${s.keyFrom === "settings" ? `<button class="btn" type="button" id="forget">Forget the key</button>` : ""}<button class="btn" type="button" id="reindex">Re-read the folder</button></div>
    </form>
    <h3 class="section">Keys</h3>
    <div class="rows">
      <a><span>Search or jump to a note</span><small><kbd>⌘K</kbd></small></a>
      <a><span>Edit the open note</span><small><kbd>⌘E</kbd></small></a>
      <a><span>Save while editing</span><small><kbd>⌘S</kbd></small></a>
    </div>`);
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
async function viewGraph(live) {
  const g = await api("/api/graph");
  if (!live()) return;
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#22d3ee", "#fb7185", "#94a3b8", "#c084fc"];
  const color = Object.fromEntries(groups.map((k, i) => [k, palette[i % palette.length]]));
  page(`
    <div class="eyebrow">${g.nodes.length} notes · ${g.edges.length} links</div>
    <h1 class="page">Graph</h1>
    <p class="lede">Every note and every link. Drag to move around, scroll to zoom, click a dot to open the note.</p>
    <div class="graphbox"><canvas id="graph"></canvas></div>
    <div class="legend">${groups.map((k) => `<span><i style="background:${color[k]};color:${color[k]}"></i>${esc(k.replace(/^\d+\s+/, ""))}</span>`).join("")}</div>`, "wide");
  const cv = $("#graph");
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--text").trim(), line = css.getPropertyValue("--line-2").trim();
  const nodes = g.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.4) * (120 + i * 3), y: Math.sin(i * 2.4) * (120 + i * 3), vx: 0, vy: 0 }));
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
  function step() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01, f = 4200 / d2, d = Math.sqrt(d2);
        dx = (dx / d) * f; dy = (dy / d) * f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
      a.vx -= a.x * 0.004; a.vy -= a.y * 0.004;
    }
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 95) * 0.012;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
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
      const lit = hover !== null && (i === hover || j === hover);
      ctx.strokeStyle = lit ? color[nodes[hover].group] : line;
      ctx.globalAlpha = hover === null ? 0.9 : lit ? 1 : 0.2;
      ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
    }
    nodes.forEach((n, i) => {
      const lit = hover === null || i === hover || near.has(i);
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fillStyle = color[n.group];
      ctx.shadowColor = color[n.group]; ctx.shadowBlur = lit && (hover !== null || n.degree >= 8) ? 12 : 0;
      ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, 6.3); ctx.fill();
      ctx.shadowBlur = 0;
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
    nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.y - y) - radius(n); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  cv.onmousemove = (e) => {
    if (drag) { view.x += e.movementX; view.y += e.movementY; drag.moved = true; return; }
    hover = pick(e);
    cv.style.cursor = hover !== null ? "pointer" : "grab";
  };
  cv.onmousedown = () => (drag = { moved: false });
  cv.onmouseleave = () => { drag = null; hover = null; };
  cv.onmouseup = (e) => {
    const was = drag; drag = null;
    const hit = pick(e);
    if (was && !was.moved && hit !== null) location.hash = href(nodes[hit].id);
  };
  cv.onwheel = (e) => { e.preventDefault(); view.k = Math.max(0.2, Math.min(3, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); };
  for (let i = 0; i < 220; i++) step();
  stopGraph = () => (alive = false);
  draw();
}

// ───────────── sphere ─────────────
// The whole vault on a globe: one point per note, one arc per link. Drawn on a 2D canvas with its own projection.
async function viewSphere(live) {
  const g = await api("/api/graph");
  if (!live()) return;
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#a78bfa", "#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#22d3ee", "#fb7185", "#94a3b8", "#c084fc"];
  const color = Object.fromEntries(groups.map((k, i) => [k, palette[i % palette.length]]));
  const label = (k) => k.replace(/^\d+\s+/, "");
  page(`
    <h1 class="page">Sphere</h1>
    <p class="lede">Your whole vault on one globe. Drag to spin it, scroll to zoom, click a point to read about the note, double-click to open it.</p>
    <div class="sphere">
      <canvas id="sphere"></canvas>
      <div class="hud hud-left" id="hudl"></div>
      <div class="hud hud-right" id="hudr"></div>
      <div class="hud hud-foot" id="hudf"></div>
    </div>`, "wide");
  const cv = $("#sphere"), ctx = cv.getContext("2d");
  const N = g.nodes.length, GA = Math.PI * (3 - Math.sqrt(5));
  const sorted = [...g.nodes].sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
  const nodes = sorted.map((n, i) => {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), phi = i * GA;
    return { ...n, p: [Math.cos(phi) * r, y, Math.sin(phi) * r], s: [0, 0, 0, 1] };
  });
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = g.edges.map(([a, b]) => [idx[a], idx[b]]).filter(([a, b]) => a !== undefined && b !== undefined);
  const near = nodes.map(() => new Set());
  for (const [a, b] of edges) { near[a].add(b); near[b].add(a); }

  let rotY = 0.6, rotX = 0.25, velY = 0.0022, velX = 0, zoom = 1, target = null;
  let hover = null, picked = null, onlyGroup = null, drag = null, alive = true, t = 0;
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
    if (onlyGroup && nodes[i].group !== onlyGroup) return false;
    const focus = hover ?? picked;
    return focus === null || i === focus || near[focus].has(i);
  };

  function drawHud() {
    const counts = Object.fromEntries(groups.map((k) => [k, 0]));
    nodes.forEach((n) => counts[n.group]++);
    $("#hudl").innerHTML = `<div class="hud-title">Sectors</div>` + groups.map((k) =>
      `<button class="hud-row${onlyGroup === k ? " on" : ""}" data-group="${esc(k)}"><i style="background:${color[k]}"></i>${esc(label(k))}<b>${counts[k]}</b></button>`).join("");
    $("#hudl").querySelectorAll("[data-group]").forEach((b) => (b.onclick = () => { onlyGroup = onlyGroup === b.dataset.group ? null : b.dataset.group; drawHud(); }));
    const n = picked !== null ? nodes[picked] : null;
    $("#hudr").innerHTML = n ? `
      <div class="hud-title" style="color:${color[n.group]}">${esc(label(n.group))}</div>
      <h3>${esc(n.title)}</h3>
      <div class="hud-meta">${esc(n.created)} · ${n.words} words · ${n.inn} in · ${n.out} out</div>
      <p>${esc(n.excerpt)}</p>
      <div class="hud-title">Linked</div>
      <div class="hud-links">${[...near[picked]].slice(0, 9).map((j) => `<button data-go="${j}"><i style="background:${color[nodes[j].group]}"></i>${esc(nodes[j].title)}</button>`).join("") || "<span>Nothing yet</span>"}</div>
      <a class="hud-open" href="${href(n.id)}">Open note →</a>` : `
      <div class="hud-title">Vault</div>
      <div class="hud-big">${N}<small>notes</small></div>
      <div class="hud-big">${edges.length}<small>links</small></div>
      <div class="hud-meta">Click a point for its details.</div>`;
    $("#hudr").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => select(+b.dataset.go)));
  }
  function select(i) {
    picked = i;
    if (i !== null) {
      const [x, y, z] = nodes[i].p;
      target = { y: Math.atan2(-x, z), x: Math.atan2(y, Math.hypot(x, z)) };
      velY = 0; velX = 0;
    }
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
    const bg = ctx.createRadialGradient(CX, CY, R * 0.2, CX, CY, Math.max(w, h) * 0.75);
    bg.addColorStop(0, "#17122b"); bg.addColorStop(1, "#05040a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // halo and rim
    const halo = ctx.createRadialGradient(CX, CY, R * 0.85, CX, CY, R * 1.35);
    halo.addColorStop(0, "rgba(139,92,246,0.16)"); halo.addColorStop(1, "rgba(139,92,246,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(CX, CY, R * 1.35, 0, 6.3); ctx.fill();

    // latitude and longitude wires
    ctx.lineWidth = 1;
    const wire = (pts) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.strokeStyle = `rgba(167,139,250,${0.035 + Math.max(0, (a[2] + b[2]) / 2 + 0.2) * 0.1})`;
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
    // two orbit rings with a moving marker
    [[1.16, 0.5, 0.004], [1.28, -0.35, -0.0025]].forEach(([rr, tilt, speed], ri) => {
      ctx.strokeStyle = "rgba(167,139,250,0.16)"; ctx.setLineDash(ri ? [2, 7] : []);
      ctx.beginPath(); ctx.ellipse(CX, CY, R * rr, R * rr * 0.32, tilt, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      const a = t * speed * 4, ex = Math.cos(a) * R * rr, ey = Math.sin(a) * R * rr * 0.32;
      ctx.fillStyle = "#d8c7ff"; ctx.beginPath();
      ctx.arc(CX + ex * Math.cos(tilt) - ey * Math.sin(tilt), CY + ex * Math.sin(tilt) + ey * Math.cos(tilt), 2.2, 0, 6.3); ctx.fill();
    });

    nodes.forEach((n) => (n.s = project(n.p, R, w, h)));
    const focus = hover ?? picked;

    // links: curves that dip toward the centre
    for (const [i, j] of edges) {
      const a = nodes[i], b = nodes[j], on = focus !== null && (i === focus || j === focus);
      const groupOk = !onlyGroup || a.group === onlyGroup || b.group === onlyGroup;
      const depth = (a.s[2] + b.s[2]) / 2;
      const alpha = on ? 0.95 : (focus !== null || !groupOk ? 0.03 : 0.07 + Math.max(0, depth + 0.4) * 0.16);
      const m = project([(a.p[0] + b.p[0]) * 0.36, (a.p[1] + b.p[1]) * 0.36, (a.p[2] + b.p[2]) * 0.36], R, w, h);
      ctx.strokeStyle = on ? color[nodes[focus].group] : `rgba(196,181,253,${alpha})`;
      ctx.globalAlpha = on ? alpha : 1;
      ctx.lineWidth = on ? 1.4 : 0.7;
      ctx.beginPath(); ctx.moveTo(a.s[0], a.s[1]); ctx.quadraticCurveTo(m[0], m[1], b.s[0], b.s[1]); ctx.stroke();
      if (on) { // a pulse travelling along the link
        const u = ((t * 0.012 + i * 0.37) % 1), v = 1 - u;
        ctx.fillStyle = "#fff"; ctx.beginPath();
        ctx.arc(v * v * a.s[0] + 2 * v * u * m[0] + u * u * b.s[0], v * v * a.s[1] + 2 * v * u * m[1] + u * u * b.s[1], 1.8, 0, 6.3); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // points, far ones first
    const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].s[2] - nodes[b].s[2]);
    for (const i of order) {
      const n = nodes[i], [x, y, z, k] = n.s, on = lit(i);
      const r = (2.2 + Math.sqrt(n.degree) * 1.05) * k * Math.sqrt(zoom);
      ctx.globalAlpha = (on ? 1 : 0.14) * (0.3 + 0.7 * Math.max(0, Math.min(1, (z + 1) / 1.6)));
      ctx.shadowColor = color[n.group]; ctx.shadowBlur = on && z > 0 ? 14 : 0;
      ctx.fillStyle = color[n.group];
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
      ctx.shadowBlur = 0;
      if (i === picked || i === hover) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(t * 0.08) * 1.5, 0, 6.3); ctx.stroke();
      }
      const show = i === focus || (focus !== null && near[focus].has(i) && z > -0.3) || (focus === null && on && z > 0.45 && n.degree >= 9);
      if (show) {
        ctx.globalAlpha = i === focus ? 1 : 0.85;
        ctx.font = `${i === focus ? 600 : 400} ${i === focus ? 13 : 11}px -apple-system, sans-serif`;
        ctx.fillStyle = "#f1ecff";
        ctx.fillText(n.title, x + r + 6, y + 4);
      }
    }
    ctx.globalAlpha = 1;

    // corner brackets
    ctx.strokeStyle = "rgba(167,139,250,0.5)"; ctx.lineWidth = 1.5;
    for (const [bx, by, sx, sy] of [[14, 14, 1, 1], [w - 14, 14, -1, 1], [14, h - 14, 1, -1], [w - 14, h - 14, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(bx + 18 * sx, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + 18 * sy); ctx.stroke();
    }
    const deg = (a) => String(Math.round((((a * 180) / Math.PI) % 360 + 360) % 360)).padStart(3, "0");
    $("#hudf").textContent = `AZ ${deg(rotY)}°  ·  EL ${deg(rotX)}°  ·  ZOOM ${zoom.toFixed(2)}×  ·  ${focus !== null ? nodes[focus].title.toUpperCase() : onlyGroup ? label(onlyGroup).toUpperCase() : "ALL SECTORS"}`;
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
    if (was && was.moved < 5 && e.type === "mouseup") select(pick(e));
  };
  cv.onmouseup = release;
  cv.onmouseleave = (e) => { release(e); hover = null; };
  cv.ondblclick = (e) => { const i = pick(e); if (i !== null) location.hash = href(nodes[i].id); };
  cv.onwheel = (e) => { e.preventDefault(); zoom = Math.max(0.6, Math.min(2.4, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); };
  stopGraph = () => (alive = false);
  window.__sphere = { nodes, select, state: () => ({ rotY, rotX, zoom, picked, hover, onlyGroup }) };
  drawHud();
  frame();
}

// ───────────── command palette ─────────────
const pal = $("#palette"), pq = $("#pq"), pl = $("#pl");
const SCREENS = [["today", "Today"], ["connect", "Connect"], ["tensions", "Tensions"], ["graph", "Graph"], ["sphere", "Sphere"], ["ask", "Ask"], ["digest", "Digest"], ["settings", "Settings"]];
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
async function createNote(title) {
  const { path } = await api("/api/note", { body: { title } });
  await loadNotes();
  editNext = path;
  location.hash = href(path);
}
function buildPalette(inside = []) {
  const q = pq.value.trim(), ql = q.toLowerCase();
  const items = [];
  const noteItem = (n, group, hint) => ({ group, html: hilite(n.title, group === "Notes" ? ql : ""), hint: hint ?? folderName(n.folder), run: () => (location.hash = href(n.path)) });
  if (palMode === "new") {
    if (q) items.push({ group: "New note", html: `Create “${esc(q)}”`, hint: "opens in the editor", run: () => createNote(q) });
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
  $("#side").classList.remove("open");
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const view = parts[0] || "today";
  const arg = safeDecode(parts.slice(1).join("/"));
  markActive();
  try {
    if (view === "note") await viewNote(live, arg);
    else if (view === "search") await viewSearch(live, arg);
    else if (view === "tag") viewTag(live, arg);
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
$("#open-palette").onclick = () => openPalette();
$("#new").onclick = () => openPalette("new");
$("#menu").onclick = () => $("#side").classList.toggle("open");
window.addEventListener("hashchange", route);
loadNotes().then(route).catch((err) => page(`<h1 class="page">Ember could not start</h1><p class="lede">${esc(err.message)}</p>`));
