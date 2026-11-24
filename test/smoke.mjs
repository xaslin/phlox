// Smoke test: starts Ember on a spare port against a throwaway folder of made-up notes
// and checks every endpoint that does not call Claude. Run with `npm test`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ember-test-"));
const vault = path.join(tmp, "vault");

const files = {
  "Home.md": "---\ntags: [map]\n---\n\n# Home\n\nStart at [[Sourdough]] or [[Bike Tour]].\n",
  "Inbox.md": "---\ntags: [inbox]\n---\n\n# Inbox\n",
  "Templates/Trip Plan.md": "---\ntags: [trip]\ncreated: 2024-01-01\n---\n\n# {{title}}\n\nPlanned on {{date}} at {{ time }}.\n\n## Route\n",
  "Templates/Plain.md": "# {{Title}}\n\nWhat it is.\n",
  "Cooking/Sourdough.md":
    "---\ntags: [recipe, bread]\ncreated: 2025-01-10\n---\n\n# Sourdough\n\nA wet dough with long fermentation gives the loaf an open crumb and a sour flavour that keeps for days.\n\n## Timing\n\nThe starter needs 35 days before it is strong enough to raise a loaf.\n\nMost bakers say the starter takes 42 days to mature fully.\n\n- [ ] Buy rye flour\n- [x] Feed the starter\n\nSee [[Starter Care|how to feed it]] and [[Missing Note]].\n",
  "Cooking/Starter Care.md":
    "---\ntags:\n  - recipe\n  - bread\ncreated: 2025-02-01\n---\n\n# Starter Care\n\nFeed the starter with equal parts flour and water every day. Fermentation slows in a cold kitchen, so keep the jar somewhere warm and the dough will rise.\n",
  "Cooking/Rye Loaf.md":
    "---\ntags: [recipe]\ncreated: 2025-03-05\n---\n\n# Rye Loaf\n\nRye flour makes a dense loaf. The dough ferments quickly and the starter should be fed the night before baking so fermentation is active and the crumb stays moist.\n",
  "Trips/Bike Tour.md":
    "---\ntags: [trip]\ncreated: 2025-04-12\n---\n\n# Bike Tour\n\nThree days along the river trail with panniers, a tent and a small stove. The route climbs gently and ends at the old mill, where the campsite has water and a shelter.\n",
  "Trips/Packing List.md":
    "---\ntags: [trip]\r\ncreated: 2025-04-13\n---\n\n# Packing List\n\nTent, stove, panniers, spare tube and a pump for the river trail. Pack the stove fuel separately and keep the tent at the top of the panniers for a quick campsite setup.\n",
};
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  fs.writeFileSync(path.join(vault, rel), text);
}
fs.writeFileSync(path.join(tmp, "secret.md"), "outside the vault\n");

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
}
async function call(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json", ...headers } : headers,
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}
// fetch refuses to set Host, so this one goes through http directly
const rawGet = (pathname, headers) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: pathname, method: "GET", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });

const env = { ...process.env, EMBER_PORT: String(PORT), EMBER_VAULT: vault, HOME: tmp };
delete env.ANTHROPIC_API_KEY;
const server = spawn(process.execPath, [path.join(HERE, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/api/settings")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start:\n" + log);
}

async function run() {
  await waitUp();
  const read = (rel) => fs.readFileSync(path.join(vault, rel), "utf8");
  const note = (rel) => call("GET", "/api/note?path=" + encodeURIComponent(rel));

  // index
  let r = await call("GET", "/api/notes");
  check("lists every note", r.data.notes.length === 9, `got ${r.data.notes.length}`);
  const care = r.data.notes.find((n) => n.title === "Starter Care");
  check("reads block-style tag lists", care && care.tags.join() === "recipe,bread", JSON.stringify(care && care.tags));
  const pack = r.data.notes.find((n) => n.title === "Packing List");
  check("reads frontmatter with Windows line ends", pack && pack.created === "2025-04-13" && pack.tags.join() === "trip", JSON.stringify(pack));

  // one note
  r = await note("Cooking/Sourdough.md");
  check("opens a note", r.status === 200 && r.data.title === "Sourdough");
  check("note has backlinks", r.data.backlinks.some((b) => b.title === "Home"));
  check("note has related notes", r.data.related.some((x) => x.title === "Rye Loaf"));
  check("alias links resolve", r.data.related.find((x) => x.title === "Starter Care")?.linked === true);
  check("missing note is a 404", (await note("Nope.md")).status === 404);
  check("note without a path is a 404", (await call("GET", "/api/note")).status === 404);

  // search
  r = await call("GET", "/api/search?q=" + encodeURIComponent("river trail"));
  check("search finds by body", r.data.hits[0] && ["Bike Tour", "Packing List"].includes(r.data.hits[0].title));
  r = await call("GET", "/api/search?q=sourdough");
  check("search finds by title", r.data.hits[0]?.title === "Sourdough");
  check("empty search is empty", (await call("GET", "/api/search?q=")).data.hits.length === 0);
  check("search survives odd input", (await call("GET", "/api/search?q=" + encodeURIComponent("((%%[["))).status === 200);

  // today
  r = await call("GET", "/api/today");
  check("today picks up to three notes", r.data.picks.length === 3, `got ${r.data.picks.length}`);
  check("today never picks hubs", !r.data.picks.some((p) => ["Home", "Inbox"].includes(p.title)));
  const first = r.data.picks.map((p) => p.path).join();
  check("today is stable within a day", (await call("GET", "/api/today")).data.picks.map((p) => p.path).join() === first);
  check("today counts notes and links", r.data.stats.notes === 9 && !r.data.stats.orphans.some((o) => o.path.startsWith("Templates/")) && r.data.stats.links >= 3);

  // snooze: "Not today" swaps the pick and keeps it away for a week
  const gone = r.data.picks[1].path;
  const kept = r.data.picks.filter((p) => p.path !== gone).map((p) => p.path);
  r = await call("POST", "/api/snooze", { path: gone });
  const after = (r.data?.picks || []).map((p) => p.path);
  check("snooze swaps in another note", r.status === 200 && after.length === 3 && !after.includes(gone) && kept.every((p) => after.includes(p)), JSON.stringify(after));
  check("snooze keeps the swapped note in place", after[1] !== gone && after[0] === kept[0]);
  const week = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA");
  check("snooze lasts a week", r.data?.until === week, r.data?.until);
  check("snoozed note stays off Today", !(await call("GET", "/api/today")).data.picks.some((p) => p.path === gone));
  const saved = JSON.parse(fs.readFileSync(path.join(vault, ".ember", "state.json"), "utf8"));
  check("snooze is saved in the vault's state", saved.snoozed?.[gone] === week);
  check("snooze refuses an unknown note", (await call("POST", "/api/snooze", { path: "Nope.md" })).status === 404);

  // connect and link
  r = await call("GET", "/api/connect");
  const pair = r.data.pairs.find((p) => [p.a.title, p.b.title].sort().join() === "Bike Tour,Packing List");
  check("connect suggests an unlinked pair", Boolean(pair), JSON.stringify(r.data.pairs.map((p) => [p.a.title, p.b.title])));
  check("connect names a shared two-word phrase", pair?.shared.includes("river trail"), JSON.stringify(pair?.shared));
  check("a word inside a shared phrase is not listed twice", pair && !pair.shared.includes("river") && !pair.shared.includes("trail"), JSON.stringify(pair?.shared));
  if (pair) {
    r = await call("POST", "/api/link", { from: pair.a.path, to: pair.b.path });
    check("link adds a See also line", r.status === 200 && read(pair.a.path).includes(`See also: [[${pair.b.title}]]`));
    await call("POST", "/api/link", { from: pair.a.path, to: pair.b.path });
    check("linking twice adds one link", read(pair.a.path).split(`[[${pair.b.title}]]`).length === 2);
    r = await call("GET", "/api/connect");
    check("linked pair leaves the list", !r.data.pairs.some((p) => p.id === pair.id));
  }
  check("link to a missing note is a 404", (await call("POST", "/api/link", { from: "Home.md", to: "Nope.md" })).status === 404);
  r = await call("GET", "/api/connect");
  if (r.data.pairs[0]) {
    const id = r.data.pairs[0].id;
    await call("POST", "/api/dismiss", { id });
    check("dismissed pair stays away", !(await call("GET", "/api/connect")).data.pairs.some((p) => p.id === id));
  }

  // tensions
  r = await call("GET", "/api/tensions");
  const t = r.data.tensions.find((x) => [x.a.value, x.b.value].sort().join() === "35,42");
  check("tensions finds 35 against 42 days", Boolean(t), JSON.stringify(r.data.tensions.map((x) => [x.a.value, x.b.value, x.unit])));
  check("tensions reports no key", r.data.hasKey === false);

  // capture
  r = await call("POST", "/api/capture", { text: "Try a longer proof" });
  check("capture writes to the inbox", r.status === 200 && read("Inbox.md").includes("Try a longer proof"));
  await call("POST", "/api/capture", { text: "Second thought" });
  const inbox = read("Inbox.md");
  check("newest capture goes first", inbox.indexOf("Second thought") < inbox.indexOf("Try a longer proof"));
  check("capture stamps date and time", /\n## \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n/.test(inbox), inbox);
  check("empty capture is refused", (await call("POST", "/api/capture", { text: "   " })).status === 400);

  // create and edit
  r = await call("POST", "/api/note", { title: "Oven: notes / 2025?" });
  check("create cleans the title", r.status === 200 && r.data.path === "Oven notes 2025.md", JSON.stringify(r.data));
  r = await call("POST", "/api/note", { title: "Sourdough" });
  check("create never overwrites", r.data.path === "Sourdough 2.md" && read("Cooking/Sourdough.md").includes("open crumb"));
  r = await call("POST", "/api/note", { title: "" });
  check("create without a name still works", r.status === 200 && r.data.path.startsWith("Untitled"));
  r = await call("POST", "/api/note", { title: "Coast Ride", folder: "Trips", template: "Templates/Trip Plan.md" });
  const plan = r.status === 200 ? read("Trips/Coast Ride.md") : "";
  check("create from a template fills title, date and time", /# Coast Ride\n\nPlanned on \d{4}-\d{2}-\d{2} at \d{2}:\d{2}\.\n\n## Route/.test(plan), plan);
  check("a note from a template keeps its tags and is dated today", plan.includes("tags: [trip]") && !plan.includes("2024-01-01") && /created: \d{4}-\d{2}-\d{2}/.test(plan), plan);
  r = await call("POST", "/api/note", { title: "Bare Idea", template: "Templates/Plain.md" });
  const bare = r.status === 200 ? read("Bare Idea.md") : "";
  check("a template without frontmatter gets a created date", /^---\ncreated: \d{4}-\d{2}-\d{2}\n---\n\n# Bare Idea\n\nWhat it is\./.test(bare), bare);
  check("only notes in a Templates folder can be templates", (await call("POST", "/api/note", { title: "Nope", template: "Cooking/Sourdough.md" })).status === 404 && !fs.existsSync(path.join(vault, "Nope.md")));
  check("templates stay out of Today's picks", !(await call("GET", "/api/today")).data.picks.some((p) => p.path.startsWith("Templates/")));
  check("the palette offers templates", /From a template/.test(await (await fetch(BASE + "/app.js")).text()));
  r = await call("PUT", "/api/note", { path: "Oven notes 2025.md", raw: "# Oven\n\nRuns 15 degrees hot. See [[Sourdough]]." });
  check("edit saves", r.status === 200 && read("Oven notes 2025.md").endsWith("See [[Sourdough]].\n"));
  r = await note("Cooking/Sourdough.md");
  check("edit updates backlinks", r.data.backlinks.some((b) => b.title === "Oven notes 2025"));
  check("edit of a missing note is a 404", (await call("PUT", "/api/note", { path: "Nope.md", raw: "x" })).status === 404);
  check("edit without text is refused", (await call("PUT", "/api/note", { path: "Home.md" })).status === 400);

  // tasks
  r = await call("GET", "/api/tasks");
  const group = r.data.groups.find((g) => g.title === "Sourdough");
  check("tasks lists open checkboxes", r.data.open === 1 && r.data.done === 1 && group?.tasks[0].text === "Buy rye flour", JSON.stringify(r.data));
  r = await call("POST", "/api/task", { path: group.path, line: group.tasks[0].line, done: true });
  check("ticking a task rewrites its line", r.status === 200 && read("Cooking/Sourdough.md").includes("- [x] Buy rye flour"));
  check("ticked task leaves the list", (await call("GET", "/api/tasks")).data.open === 0);
  check("ticking a line that is not a task is refused", (await call("POST", "/api/task", { path: group.path, line: 0, done: true })).status === 409);

  // due dates
  const soon = new Date(Date.now() + 3 * 86400000).toLocaleDateString("en-CA");
  const past = new Date(Date.now() - 2 * 86400000).toLocaleDateString("en-CA");
  const plans = (await call("POST", "/api/note", { title: "Plans" })).data.path;
  await call("PUT", "/api/note", { path: plans, raw: `# Plans\n\n- [ ] Later thing due: ${soon}\n- [ ] Old thing 📅 ${past}\n- [ ] No date here\n- [ ] Bad date due: 2026-13-45\n` });
  r = await call("GET", "/api/tasks");
  check("tasks with due dates come back soonest first", r.data.due.length === 2 && r.data.due[0].days === -2 && r.data.due[1].days === 3 && r.data.due[0].text.includes("Old thing"), JSON.stringify(r.data.due));
  check("open count still includes undated tasks", r.data.open === 4);
  r = await call("GET", "/api/today");
  check("briefing counts overdue and due-soon tasks", r.data.briefing.overdue === 1 && r.data.briefing.dueSoon === 1, JSON.stringify(r.data.briefing));
  // adding tasks
  r = await call("POST", "/api/addtask", { text: "Pack the camera", due: "2026-12-05" });
  check("add task creates or extends the Inbox", r.status === 200 && read(r.data.path).includes("- [ ] Pack the camera due: 2026-12-05"), JSON.stringify(r));
  r = await call("POST", "/api/addtask", { text: "Second thing", path: "Cooking/Sourdough.md" });
  check("add task to a chosen note appends a checkbox line", r.status === 200 && read("Cooking/Sourdough.md").trimEnd().endsWith("- [ ] Second thing"));
  check("added tasks show in the list", (await call("GET", "/api/tasks")).data.groups.some((g) => g.tasks.some((t) => t.text.startsWith("Second thing"))));
  check("add task refuses empty text, bad dates and unknown notes", (await call("POST", "/api/addtask", { text: " " })).status === 400 && (await call("POST", "/api/addtask", { text: "x", due: "soon" })).status === 400 && (await call("POST", "/api/addtask", { text: "x", path: "Nope.md" })).status === 404);

  // mentions, two hops, briefing, daily note
  r = await note("Cooking/Starter Care.md");
  check("finds unlinked mentions", r.data.mentions.some((m) => m.title === "Rye Loaf") === false && Array.isArray(r.data.mentions));
  fs.writeFileSync(path.join(vault, "Cooking/Rye Loaf.md"), read("Cooking/Rye Loaf.md") + "\nGood starter care matters here.\n");
  await new Promise((res) => setTimeout(res, 700));
  r = await note("Cooking/Starter Care.md");
  check("picks up an edit made outside the app", r.data.mentions.some((m) => m.title === "Rye Loaf"), JSON.stringify(r.data.mentions));
  // stale projects
  const oldP = (await call("POST", "/api/note", { title: "Old Venture" })).data.path;
  await call("PUT", "/api/note", { path: oldP, raw: "---\ntags: [project]\n---\n\n# Old Venture\n\nA made-up project.\n" });
  const doneP = (await call("POST", "/api/note", { title: "Finished Venture" })).data.path;
  await call("PUT", "/api/note", { path: doneP, raw: "---\ntags: [project, done]\n---\n\n# Finished Venture\n" });
  const longAgo = new Date(Date.now() - 45 * 86400000);
  for (const p of [oldP, doneP]) fs.utimesSync(path.join(vault, p), longAgo, longAgo);
  await call("POST", "/api/reindex", {});
  r = await call("GET", "/api/today");
  check("stale projects list old project notes only", r.data.briefing.stale.length === 1 && r.data.briefing.stale[0].title === "Old Venture" && r.data.briefing.stale[0].days >= 45, JSON.stringify(r.data.briefing.stale));

  r = await call("POST", "/api/mention", { from: "Cooking/Rye Loaf.md", to: "Cooking/Starter Care.md" });
  check("linking a mention keeps the wording", r.status === 200 && read("Cooking/Rye Loaf.md").includes("Good [[Starter Care|starter care]] matters"), read("Cooking/Rye Loaf.md"));
  r = await note("Home.md");
  check("finds notes two links away", r.data.hops.some((h) => h.title === "Starter Care" && h.via.includes("Sourdough")), JSON.stringify(r.data.hops));
  r = await call("GET", "/api/today");
  check("briefing lists links to unwritten notes", r.data.briefing.missing.some((m) => m.title === "Missing Note"));
  check("briefing counts changed notes", r.data.briefing.changedCount >= 1);
  r = await call("POST", "/api/daily", {});
  check("daily note is created once", /^Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(r.data.path) && (await call("POST", "/api/daily", {})).data.path === r.data.path);
  check("version moves when notes change", (await call("GET", "/api/version")).data.version > 1);

  // renaming a note rewrites the links to it
  r = await call("POST", "/api/rename", { path: "Cooking/Starter Care.md", title: "Feeding the Starter" });
  check("rename moves the file", r.status === 200 && r.data.path === "Cooking/Feeding the Starter.md" && fs.existsSync(path.join(vault, "Cooking/Feeding the Starter.md")) && !fs.existsSync(path.join(vault, "Cooking/Starter Care.md")), JSON.stringify(r.data));
  check("rename counts the notes it updated", r.data.updated === 2, JSON.stringify(r.data));
  check("rename keeps link aliases", read("Cooking/Sourdough.md").includes("[[Feeding the Starter|how to feed it]]"));
  check("rename rewrites aliased mentions", read("Cooking/Rye Loaf.md").includes("[[Feeding the Starter|starter care]]"));
  check("rename updates the note's own heading", read("Cooking/Feeding the Starter.md").includes("# Feeding the Starter\n"));
  r = await note("Cooking/Feeding the Starter.md");
  check("renamed note keeps its backlinks", r.data.backlinks.some((b) => b.title === "Sourdough"), JSON.stringify(r.data.backlinks));
  check("rename refuses a title already taken", (await call("POST", "/api/rename", { path: "Cooking/Rye Loaf.md", title: "sourdough" })).status === 409);
  check("rename refuses an empty title", (await call("POST", "/api/rename", { path: "Cooking/Rye Loaf.md", title: " / " })).status === 400);
  r = await call("POST", "/api/rename", { path: "Cooking/Rye Loaf.md", title: "../../escape" });
  check("rename stays in the note's folder", !fs.existsSync(path.join(tmp, "escape.md")) && (r.status !== 200 || r.data.path.startsWith("Cooking/")), JSON.stringify(r.data));
  if (r.status === 200) await call("POST", "/api/rename", { path: r.data.path, title: "Rye Loaf" });

  // graph
  r = await call("GET", "/api/graph");
  const ids = new Set(r.data.nodes.map((n) => n.id));
  check("graph has a node per note", r.data.nodes.length === (await call("GET", "/api/notes")).data.notes.length);
  check("graph edges point at real nodes", r.data.edges.length > 0 && r.data.edges.every(([a, b]) => ids.has(a) && ids.has(b)));
  // the legend hides folders by the top-level group, so each node's group must be its first folder
  const groupOf = Object.fromEntries(r.data.nodes.map((n) => [n.id, n.group]));
  check("graph groups notes by top folder", groupOf["Cooking/Sourdough.md"] === "Cooking" && groupOf["Trips/Bike Tour.md"] === "Trips" && groupOf["Home.md"] === "Home", JSON.stringify(groupOf));
  const graphJs = await (await fetch(BASE + "/app.js")).text();
  check("graph legend toggles folders and pins dots", /class="lg/.test(graphJs) && /Unpin all/.test(graphJs) && /ember-graph/.test(graphJs));

  // staying inside the folder and on this machine
  check("cannot edit outside the vault", (await call("PUT", "/api/note", { path: "../secret.md", raw: "changed" })).status === 404);
  await call("POST", "/api/note", { title: "x", folder: "../../escape" });
  check("cannot create outside the vault", !fs.existsSync(path.join(tmp, "escape")) && fs.readFileSync(path.join(tmp, "secret.md"), "utf8") === "outside the vault\n");
  check("cannot read outside public", (await rawGet("/../server.js", { host: `127.0.0.1:${PORT}` })) === 404);
  check("cannot read outside public, encoded", (await rawGet("/%2e%2e/server.js", { host: `127.0.0.1:${PORT}` })) === 404);
  check("refuses other hosts", (await rawGet("/api/notes", { host: "evil.example" })) === 403);
  check("refuses other origins", (await call("GET", "/api/notes", undefined, { origin: "https://evil.example" })).status === 403);
  check("refuses non-JSON posts", (await fetch(BASE + "/api/capture", { method: "POST", body: "text=hi", headers: { "content-type": "text/plain" } })).status === 415);
  check("refuses broken JSON", (await call("POST", "/api/capture", "{nope")).status === 400);
  check("unknown route is a 404", (await call("GET", "/api/nothing")).status === 404);

  // the page
  for (const f of ["/", "/app.js", "/style.css", "/logo.svg"]) check(`serves ${f}`, (await fetch(BASE + f)).status === 200);
  const appJs = await (await fetch(BASE + "/app.js")).text();
  const mic = appJs.match(/const micBtn = Recognition \? `(<button[^>]*>)/);
  check("dictation button only where speech recognition exists", !!mic);
  check("dictation button does not submit the capture form", !!mic && /type="button"/.test(mic[1]));
  check("dictation stops when leaving the page", /speechSynthesis\.cancel\(\);\s*stopDictation\(\);/.test(appJs));

  // Claude features without a key: refused before anything is sent
  check("ask needs a key", (await call("POST", "/api/ask", { question: "what about bread?" })).status === 409);
  check("deep read needs a key", (await call("POST", "/api/tensions/deep", {})).status === 409);
  check("digest refuses short text", (await call("POST", "/api/digest", { text: "too short" })).status === 400);

  check("reindex re-reads the folder", (await call("POST", "/api/reindex", {})).data.notes >= 11);
  check("server printed no errors", !/Error|at .*server\.js/.test(log), log);
}

try {
  await run();
} catch (err) {
  failures.push("test run crashed — " + (err.stack || err));
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
process.exit(failures.length ? 1 : 0);
