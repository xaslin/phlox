// Ember front end. No framework: hash routes, fetch, and a small Markdown renderer.
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
let notes = [];
let byTitle = {};
let byPath = {};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const href = (p) => "#/note/" + encodeURIComponent(p);
const link = (n, cls = "") => `<a class="${cls}" href="${href(n.path)}">${esc(n.title)}</a>`;

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

// ───────────── Markdown ─────────────
function inline(s) {
  const code = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => {
      const n = byTitle[t.trim().toLowerCase()];
      return n ? `<a class="wl" href="${href(n.path)}">${a || t}</a>` : `<span class="wl missing" title="No note with this name yet">${a || t}</span>`;
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}
function render(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(l)) {
      const lvl = Math.min(l.match(/^#+/)[0].length, 3);
      out.push(`<h${lvl}>${inline(l.replace(/^#+\s+/, ""))}</h${lvl}>`);
      i++;
    } else if (l.trim().startsWith("|") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || "") && (lines[i + 1] || "").includes("-")) {
      const head = row(l);
      const body = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) body.push(row(lines[i]));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]); i++) {
        const sub = /^\s{2,}/.test(lines[i]);
        items.push(`<li${sub ? ' class="sub"' : ""}>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
    } else if (/^>/.test(l)) {
      const buf = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
    } else if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push("<hr>");
      i++;
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s+|\|)/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(`<p>${inline(buf.join(" "))}</p>`);
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
  drawTree();
}
function drawTree() {
  const root = { kids: {}, files: [] };
  for (const n of notes) {
    let at = root;
    for (const part of n.folder ? n.folder.split("/") : []) at = at.kids[part] ||= { kids: {}, files: [] };
    at.files.push(n);
  }
  const open = new Set(JSON.parse(sessionStorage.getItem("ember-open") || "[]"));
  const walk = (node, prefix) =>
    Object.keys(node.kids).sort().map((k) => {
      const id = prefix + k;
      return `<details data-id="${esc(id)}"${open.has(id) ? " open" : ""}><summary>${esc(k.replace(/^\d+\s+/, ""))}</summary><div class="kids">${walk(node.kids[k], id + "/")}</div></details>`;
    }).join("") + node.files.map((n) => `<a href="${href(n.path)}" data-path="${esc(n.path)}" title="${esc(n.title)}">${esc(n.title)}</a>`).join("");
  $("#tree").innerHTML = walk(root, "");
  $("#tree").querySelectorAll("details").forEach((d) =>
    d.addEventListener("toggle", () => {
      d.open ? open.add(d.dataset.id) : open.delete(d.dataset.id);
      sessionStorage.setItem("ember-open", JSON.stringify([...open]));
    })
  );
  markActive();
}
function markActive() {
  const [, view, rest] = location.hash.split("/");
  document.querySelectorAll("[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === (view || "today")));
  const p = view === "note" ? decodeURIComponent(rest || "") : "";
  $("#tree").querySelectorAll("a").forEach((a) => {
    const on = a.dataset.path === p;
    a.classList.toggle("on", on);
    if (on) for (let d = a.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
  });
}

// ───────────── views ─────────────
const page = (html, wide) => (main.innerHTML = `<div class="wrap${wide ? " wide" : ""}">${html}</div>`);
const chips = (n) => (n.tags || []).map((t) => `<span class="chip plain">${esc(t)}</span>`).join("");
const keyNotice = `<div class="notice">This needs your own Anthropic API key. Add one in <a href="#/settings">Settings</a>. Everything else works without it.</div>`;

async function viewToday() {
  const d = await api("/api/today");
  const nice = new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  page(`
    <div class="eyebrow">${esc(nice)}</div>
    <h1 class="page">Three notes worth another look</h1>
    <p class="lede">Picked for today from notes you have not opened in a while. Older and better-connected notes come up more often.</p>
    <form class="capture" id="capture"><input name="text" placeholder="Capture a thought. It goes to your Inbox." autocomplete="off" aria-label="Capture a thought"><button class="btn primary">Capture</button></form>
    ${d.picks.map((p) => `
      <article class="card">
        <h2>${link(p)}</h2>
        <div class="why">${esc(p.why)}</div>
        <p>${esc(p.excerpt)}</p>
        <div class="row">${chips(p)}${p.source ? `<span class="chip plain">from ${esc(p.source.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</span>` : ""}</div>
      </article>`).join("") || `<div class="empty">No notes yet. Point Ember at a folder in Settings.</div>`}
    <div class="stats">
      <div class="stat"><b>${d.stats.notes}</b><span>notes</span></div>
      <div class="stat"><b>${d.stats.links}</b><span>links</span></div>
      <div class="stat"><b>${d.stats.words.toLocaleString()}</b><span>words</span></div>
      <div class="stat"><b>${d.stats.unopened}</b><span>never opened here</span></div>
    </div>
    ${d.stats.orphans.length ? `<h3 class="section">Nothing links to these</h3><div class="card">${d.stats.orphans.slice(0, 12).map((o) => link(o)).join(" · ")}</div>` : ""}
  `);
  $("#capture").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = e.target.text;
    if (!input.value.trim()) return;
    try {
      await api("/api/capture", { body: { text: input.value } });
      input.value = "";
      toast("Saved to Inbox");
      await loadNotes();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function viewNote(path) {
  let n;
  try {
    n = await api("/api/note?path=" + encodeURIComponent(path));
  } catch (err) {
    return page(`<h1 class="page">Note not found</h1><p class="lede">${esc(err.message)}</p>`);
  }
  const src = n.source && /^https?:/.test(n.source) ? `<a href="${esc(n.source)}" target="_blank" rel="noopener noreferrer">original</a>` : esc(n.source);
  const show = () => {
    page(`
      <div class="note-head"><div>${chips(n)}</div><button class="btn" id="edit">Edit</button></div>
      <div class="meta">${esc(n.path)} · ${n.words} words · ${esc(n.created)}${src ? " · " + src : ""}</div>
      <div class="md">${render(n.body)}</div>
      <div class="below">
        <div><h3 class="section">Linked from</h3>${n.backlinks.length ? `<ul>${n.backlinks.map((b) => `<li>${link(b)}<small>${esc(b.context)}</small></li>`).join("")}</ul>` : `<p class="meta">Nothing links here yet.</p>`}</div>
        <div><h3 class="section">Reads like</h3>${n.related.length ? `<ul>${n.related.map((r) => `<li>${link(r)} ${r.linked ? "" : `<button class="ghost" data-link="${esc(r.path)}" title="Add a link to this note">+ link</button>`}<small>${Math.round(r.score * 100)}% alike${r.linked ? " · linked" : ""}</small></li>`).join("")}</ul>` : `<p class="meta">Nothing similar found.</p>`}</div>
      </div>`);
    $("#edit").onclick = edit;
    main.querySelectorAll("[data-link]").forEach((b) => (b.onclick = async () => {
      await api("/api/link", { body: { from: n.path, to: b.dataset.link } });
      toast("Linked");
      await loadNotes();
      viewNote(path);
    }));
  };
  const edit = () => {
    page(`
      <div class="note-head"><h1 class="page">${esc(n.title)}</h1><div class="row" style="margin:0"><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="save">Save</button></div></div>
      <div class="meta">Plain Markdown. Link to another note with [[Its Title]]. ⌘S saves.</div>
      <textarea class="editor" id="raw" spellcheck="true"></textarea>`);
    const ta = $("#raw");
    ta.value = n.raw;
    ta.focus();
    const save = async () => {
      try {
        await api("/api/note", { method: "PUT", body: { path: n.path, raw: ta.value } });
        toast("Saved");
        await loadNotes();
        viewNote(path);
      } catch (err) {
        toast(err.message);
      }
    };
    $("#save").onclick = save;
    $("#cancel").onclick = show;
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    });
  };
  show();
}

async function viewConnect() {
  const { pairs } = await api("/api/connect");
  page(`
    <h1 class="page">Notes that should know about each other</h1>
    <p class="lede">These pairs use the same rare words but do not link to each other. Linking adds a "See also" line to the first note.</p>
    ${pairs.map((p) => `
      <div class="card" data-id="${esc(p.id)}">
        <div class="pair">
          <div>${link(p.a, "t")}<small>${esc(p.a.folder || "top level")}</small></div>
          <div class="mid">${Math.round(p.score * 100)}%<br>alike</div>
          <div>${link(p.b, "t")}<small>${esc(p.b.folder || "top level")}</small></div>
        </div>
        <div class="row"><span class="why" style="margin:0">Both mention: ${p.shared.map(esc).join(", ")}</span><span style="flex:1"></span>
          <button class="btn" data-dismiss>Not related</button><button class="btn primary" data-from="${esc(p.a.path)}" data-to="${esc(p.b.path)}">Link them</button></div>
      </div>`).join("") || `<div class="empty">Every similar pair is already linked.</div>`}
  `);
  main.querySelectorAll("[data-from]").forEach((b) => (b.onclick = async () => {
    await api("/api/link", { body: { from: b.dataset.from, to: b.dataset.to } });
    b.closest(".card").remove();
    toast("Linked");
    loadNotes();
  }));
  wireDismiss();
}
function wireDismiss() {
  main.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = async () => {
    const card = b.closest(".card");
    await api("/api/dismiss", { body: { id: card.dataset.id } });
    card.remove();
  }));
}

async function viewTensions() {
  const d = await api("/api/tensions");
  const side = (x, big) => `<div>${big !== undefined ? `<big>${esc(big)}</big>` : ""}<q>${esc(x.sentence)}</q>${link(x)}${x.section && x.section !== x.title ? `<small class="why"> · ${esc(x.section)}</small>` : ""}</div>`;
  page(`
    <h1 class="page">Where your notes disagree</h1>
    <p class="lede">Found on this Mac: two passages that give different numbers for what looks like the same thing. A deeper read, for disagreements that are not about numbers, uses Claude.</p>
    ${d.tensions.map((t) => `
      <div class="card" data-id="${esc(t.id)}">
        <div class="versus">${side(t.a, `${t.a.value.toLocaleString()} ${t.a.shown}`)}${side(t.b, `${t.b.value.toLocaleString()} ${t.b.shown}`)}</div>
        <div class="row"><span style="flex:1"></span><button class="btn" data-dismiss>Not a conflict</button></div>
      </div>`).join("") || `<div class="empty">No conflicting numbers found.</div>`}
    <h3 class="section">Deeper read</h3>
    ${d.hasKey ? "" : keyNotice}
    <div class="row" style="margin:0 0 16px"><button class="btn primary" id="deep"${d.hasKey ? "" : " disabled"}>Read the whole vault for disagreements</button><span class="why" style="margin:0">Sends your notes, except hubs and session logs, to Claude once.</span></div>
    <div id="deepout"></div>
  `);
  wireDismiss();
  $("#deep").onclick = async (e) => {
    e.target.disabled = true;
    $("#deepout").innerHTML = `<p class="why"><span class="spinner"></span>Reading. This can take a minute.</p>`;
    try {
      const { findings } = await api("/api/tensions/deep", { body: {} });
      $("#deepout").innerHTML = findings.map((f) => `
        <div class="card"><div class="kind">${esc(f.kind)}</div><p style="margin:4px 0 12px">${esc(f.explanation)}</p><div class="versus">${side(f.a)}${side(f.b)}</div></div>`).join("") || `<div class="empty">Claude found nothing that disagrees.</div>`;
    } catch (err) {
      $("#deepout").innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
    e.target.disabled = false;
  };
}

async function viewSearch(q) {
  const { hits } = await api("/api/search?q=" + encodeURIComponent(q));
  page(`<h1 class="page">${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(q)}”</h1><p class="lede"></p>
    <div class="hits">${hits.map((h) => `<div class="card"><h2>${link(h)}</h2><div class="why">${esc(h.folder || "top level")}</div><p>${esc(h.snippet)}</p></div>`).join("") || `<div class="empty">Nothing matches. Try fewer words.</div>`}</div>`);
}

async function viewAsk() {
  const s = await api("/api/settings");
  page(`
    <h1 class="page">Ask your notes</h1>
    <p class="lede">Ember finds the notes that match, sends those notes and your question to Claude, and shows an answer that cites them.</p>
    ${s.hasKey ? "" : keyNotice}
    <form class="askbox" id="ask"><textarea name="q" placeholder="What did I decide about the NHD thesis, and what is still unwritten?" aria-label="Your question"></textarea><button class="btn primary"${s.hasKey ? "" : " disabled"}>Ask</button></form>
    <div id="answer"></div>`);
  const form = $("#ask");
  form.q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = form.q.value.trim();
    if (!question || !s.hasKey) return;
    const out = $("#answer");
    out.innerHTML = `<p class="why"><span class="spinner"></span>Finding notes and thinking.</p>`;
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok) throw new Error((await res.json()).error || "Request failed");
      const sources = JSON.parse(decodeURIComponent(res.headers.get("x-sources") || "%5B%5D"));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        out.innerHTML = `<div class="card md">${render(text)}</div>`;
      }
      out.innerHTML = `<div class="card md">${render(text || "*No answer came back.*")}</div><h3 class="section">Notes Claude was given</h3><div class="card">${sources.map((n) => link(n)).join(" · ")}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
    }
  });
}

async function viewDigest() {
  const s = await api("/api/settings");
  page(`
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
    const f = e.target;
    $("#dstate").innerHTML = `<span class="spinner"></span>Reading the source.`;
    try {
      const r = await api("/api/digest", { body: { title: f.title.value, text: f.text.value, origin: f.origin.value } });
      await loadNotes();
      $("#dstate").textContent = "";
      $("#dout").innerHTML = `<h3 class="section">Created</h3><div class="card">${[r.source, ...r.atoms].map((p) => (byPath[p] ? link(byPath[p]) : esc(p))).join(" · ")}</div>`;
      f.reset();
    } catch (err) {
      $("#dstate").textContent = err.message;
    }
  });
}

async function viewSettings() {
  const s = await api("/api/settings");
  page(`
    <h1 class="page">Settings</h1>
    <p class="lede">Ember reads and writes plain Markdown files in one folder. Nothing is uploaded unless you use Ask, Digest or the deeper read under Tensions.</p>
    <form id="set">
      <div class="field"><label for="vault">Notes folder</label><input id="vault" name="vault" value="${esc(s.vault)}" spellcheck="false">
        <small>${s.exists ? `${notes.length} notes found. An Obsidian vault works as is.` : "This folder does not exist."}</small></div>
      <div class="field"><label for="key">Anthropic API key</label><input id="key" name="apiKey" type="password" autocomplete="off" placeholder="${s.hasKey ? "A key is saved. Type a new one to replace it." : "sk-ant-…"}">
        <small>${s.hasKey ? `Using the key from ${esc(s.keyFrom)}. ` : ""}Stored in ~/.config/ember/config.json, readable only by you. Requests go to Anthropic with the model ${esc(s.model)} and are billed to this key.</small></div>
      <div class="row"><button class="btn primary">Save</button>${s.keyFrom === "settings" ? `<button class="btn" type="button" id="forget">Forget the key</button>` : ""}<button class="btn" type="button" id="reindex">Re-read the folder</button></div>
    </form>`);
  $("#set").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { vault: e.target.vault.value };
    if (e.target.apiKey.value.trim()) body.apiKey = e.target.apiKey.value;
    try {
      await api("/api/settings", { body });
      await loadNotes();
      toast("Saved");
      viewSettings();
    } catch (err) {
      toast(err.message);
    }
  });
  $("#reindex").onclick = async () => {
    await api("/api/reindex", { body: {} });
    await loadNotes();
    toast("Folder re-read");
    viewSettings();
  };
  const forget = $("#forget");
  if (forget) forget.onclick = async () => {
    await api("/api/settings", { body: { apiKey: "" } });
    toast("Key removed");
    viewSettings();
  };
}

// ───────────── graph ─────────────
let stopGraph = () => {};
async function viewGraph() {
  const g = await api("/api/graph");
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#e07a2f", "#3d8bd9", "#4aa36b", "#b062c9", "#d9a521", "#d6577a", "#3fb0b0", "#8a8f98", "#9c6b3f"];
  const color = Object.fromEntries(groups.map((k, i) => [k, palette[i % palette.length]]));
  page(`
    <h1 class="page">Graph</h1>
    <p class="lede">Every note and every link. Drag to move around, scroll to zoom, click a dot to open the note.</p>
    <div class="graphbox"><canvas id="graph"></canvas></div>
    <div class="legend">${groups.map((k) => `<span><i style="background:${color[k]}"></i>${esc(k.replace(/^\d+\s+/, ""))}</span>`).join("")}</div>`, true);
  const cv = $("#graph");
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--text").trim(), line = css.getPropertyValue("--line").trim();
  const nodes = g.nodes.map((n, i) => ({ ...n, x: Math.cos(i * 2.4) * (120 + i * 3), y: Math.sin(i * 2.4) * (120 + i * 3), vx: 0, vy: 0 }));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = g.edges.map(([a, b]) => [idx[a], idx[b]]).filter(([a, b]) => a !== undefined && b !== undefined);
  let view = { x: 0, y: 0, k: 0.6 }, hover = null, drag = null, heat = 1, alive = true;
  const size = () => {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    cv.width = r.width * d;
    cv.height = r.height * d;
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
      ctx.globalAlpha = hover === null ? 0.8 : lit ? 1 : 0.25;
      ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
    }
    nodes.forEach((n, i) => {
      const lit = hover === null || i === hover || near.has(i);
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.fillStyle = color[n.group];
      ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, 6.3); ctx.fill();
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
async function viewSphere() {
  const g = await api("/api/graph");
  const groups = [...new Set(g.nodes.map((n) => n.group))].sort();
  const palette = ["#ff9a3c", "#4db5ff", "#5fe0a0", "#c58bff", "#ffd24d", "#ff6f91", "#4fe3e3", "#aab4c3", "#e0a070"];
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
    </div>`, true);
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
    bg.addColorStop(0, "#1c1410"); bg.addColorStop(1, "#070504");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // halo and rim
    const halo = ctx.createRadialGradient(CX, CY, R * 0.85, CX, CY, R * 1.35);
    halo.addColorStop(0, "rgba(240,145,58,0.16)"); halo.addColorStop(1, "rgba(240,145,58,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(CX, CY, R * 1.35, 0, 6.3); ctx.fill();

    // latitude and longitude wires
    ctx.lineWidth = 1;
    const wire = (pts) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.strokeStyle = `rgba(240,160,90,${0.035 + Math.max(0, (a[2] + b[2]) / 2 + 0.2) * 0.1})`;
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
      ctx.strokeStyle = "rgba(240,160,90,0.16)"; ctx.setLineDash(ri ? [2, 7] : []);
      ctx.beginPath(); ctx.ellipse(CX, CY, R * rr, R * rr * 0.32, tilt, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      const a = t * speed * 4, ex = Math.cos(a) * R * rr, ey = Math.sin(a) * R * rr * 0.32;
      ctx.fillStyle = "#ffc27a"; ctx.beginPath();
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
      ctx.strokeStyle = on ? color[nodes[focus].group] : `rgba(255,190,130,${alpha})`;
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
        ctx.fillStyle = "#f6ebdd";
        ctx.fillText(n.title, x + r + 6, y + 4);
      }
    }
    ctx.globalAlpha = 1;

    // corner brackets
    ctx.strokeStyle = "rgba(240,160,90,0.5)"; ctx.lineWidth = 1.5;
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

// ───────────── routing ─────────────
async function route() {
  stopGraph();
  $("#side").classList.remove("open");
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const view = parts[0] || "today";
  const arg = decodeURIComponent(parts.slice(1).join("/"));
  markActive();
  try {
    if (view === "note") await viewNote(arg);
    else if (view === "search") await viewSearch(arg);
    else if (view === "connect") await viewConnect();
    else if (view === "tensions") await viewTensions();
    else if (view === "graph") await viewGraph();
    else if (view === "sphere") await viewSphere();
    else if (view === "ask") await viewAsk();
    else if (view === "digest") await viewDigest();
    else if (view === "settings") await viewSettings();
    else await viewToday();
  } catch (err) {
    page(`<h1 class="page">Something went wrong</h1><p class="lede">${esc(err.message)}</p>`);
  }
  main.scrollTop = 0;
}

$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.value.trim()) location.hash = "#/search/" + encodeURIComponent(e.target.value.trim());
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    $("#q").focus();
    $("#q").select();
  }
});
$("#menu").onclick = () => $("#side").classList.toggle("open");
$("#new").onclick = async () => {
  const title = prompt("Name the new note");
  if (!title || !title.trim()) return;
  try {
    const { path } = await api("/api/note", { body: { title } });
    await loadNotes();
    location.hash = href(path);
  } catch (err) {
    toast(err.message);
  }
};
window.addEventListener("hashchange", route);
loadNotes().then(route).catch((err) => page(`<h1 class="page">Ember could not start</h1><p class="lede">${esc(err.message)}</p>`));
