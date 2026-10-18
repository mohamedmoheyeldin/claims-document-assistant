import { FIELD_LABELS } from "../schema.js";

// Single-file review UI served by the local review server. Values are always
// written with textContent / input.value, never innerHTML.
export const REVIEW_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claims Review Queue</title>
<style>
  :root { --bg:#f6f7f9; --panel:#fff; --text:#1d2433; --muted:#5b6475; --line:#dde1e8; --accent:#1f5fd1; --warn:#9a5b00; --warn-bg:#fff4e0; --bad:#b42318; --bad-bg:#fdecea; --ok:#067647; --ok-bg:#e8f6ee; color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --panel:#1b2029; --text:#e7eaf0; --muted:#9aa3b2; --line:#2c3340; --accent:#6ea0ff; --warn:#f2b84b; --warn-bg:#3a2c12; --bad:#ff8a80; --bad-bg:#3b1c1a; --ok:#6fd39b; --ok-bg:#16301f; } }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
  header { padding:12px 20px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; }
  header p { margin:0; color:var(--muted); font-size:13px; }
  main { display:grid; grid-template-columns: 250px minmax(0,1fr) minmax(0,1.1fr); height: calc(100vh - 50px); }
  nav { border-right:1px solid var(--line); overflow:auto; background:var(--panel); }
  nav button { display:block; width:100%; text-align:left; padding:10px 14px; border:0; border-bottom:1px solid var(--line); background:none; color:inherit; cursor:pointer; font:inherit; }
  nav button[aria-current="true"] { background:var(--bg); box-shadow: inset 3px 0 var(--accent); }
  nav small { color:var(--muted); display:block; }
  .pill { display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px; margin-top:3px; }
  .pill.info { background:var(--warn-bg); color:var(--warn); } .pill.ready { background:var(--ok-bg); color:var(--ok); } .pill.done { background:var(--line); color:var(--muted); }
  iframe { width:100%; height:100%; border:0; border-right:1px solid var(--line); background:#fff; }
  section { overflow:auto; padding:16px 20px 40px; }
  h2 { font-size:15px; margin:18px 0 8px; } h2:first-child { margin-top:0; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:8px 12px; }
  label { display:flex; flex-direction:column; gap:2px; font-size:12px; color:var(--muted); }
  input, textarea { font:inherit; color:var(--text); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
  input.flagged { border-color:var(--bad); background:var(--bad-bg); }
  textarea { min-height:190px; width:100%; }
  ul.issues { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
  ul.issues li { padding:7px 10px; border-radius:6px; background:var(--bad-bg); color:var(--bad); }
  ul.issues li.warning { background:var(--warn-bg); color:var(--warn); }
  ul.issues li.none { background:var(--ok-bg); color:var(--ok); }
  .actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px; }
  button.act { font:inherit; padding:7px 14px; border-radius:6px; border:1px solid var(--line); background:var(--panel); color:var(--text); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .meta { color:var(--muted); font-size:12px; }
  #toast { min-height:20px; font-size:13px; }
</style>
</head>
<body>
<header><h1>Claims Review Queue</h1><p>Synthetic data only. Every extraction and reply draft waits here for a person to check, correct and approve.</p></header>
<main>
  <nav id="queue" aria-label="Claims awaiting review"></nav>
  <iframe id="pdf" title="Claim document"></iframe>
  <section id="detail"><p class="meta">Select a claim.</p></section>
</main>
<template id="detail-tpl">
  <h2>Problems found</h2>
  <ul class="issues"></ul>
  <h2>Extracted fields</h2>
  <p class="meta extractor"></p>
  <div class="grid fields"></div>
  <h2>Status reply draft</h2>
  <label>Subject <input name="subject"></label>
  <label style="margin-top:8px">Body <textarea name="body"></textarea></label>
  <label style="margin-top:8px">Reviewer <input name="reviewer" placeholder="Your name (recorded in the audit log)"></label>
  <div class="actions">
    <button class="act primary" data-decision="approve">Approve reply</button>
    <button class="act" data-decision="escalate">Escalate</button>
    <button class="act" data-decision="reject">Reject</button>
    <span id="toast" role="status"></span>
  </div>
</template>
<script>
const LABELS = ${JSON.stringify(FIELD_LABELS)};
let claims = [];
let current = null;
const $ = (sel, root = document) => root.querySelector(sel);
const statusPill = (c) => c.reviewState !== "pending_review" ? ["done", c.reviewState.replace("_", " ")] : c.draft.status === "ready_for_adjudication" ? ["ready", "ready"] : ["info", "needs info"];

async function load() {
  claims = await (await fetch("/api/claims")).json();
  const nav = $("#queue");
  nav.replaceChildren(...claims.map((c) => {
    const b = document.createElement("button");
    const name = [c.fields.claimantFirstName, c.fields.claimantLastName].filter(Boolean).join(" ") || "Unknown claimant";
    const [cls, text] = statusPill(c);
    b.append(c.id, Object.assign(document.createElement("small"), { textContent: (c.fields.claimNumber || "no claim number") + " · " + name }), Object.assign(document.createElement("span"), { className: "pill " + cls, textContent: text }));
    b.onclick = () => select(c.id);
    b.dataset.id = c.id;
    return b;
  }));
  if (!current && claims.length) select(claims[0].id);
}

function select(id) {
  current = claims.find((c) => c.id === id);
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === id)));
  $("#pdf").src = "/files/" + encodeURIComponent(id) + ".pdf";
  const view = $("#detail-tpl").content.cloneNode(true);
  const flagged = new Set(current.issues.map((i) => i.field));
  const list = $(".issues", view);
  if (!current.issues.length) list.append(Object.assign(document.createElement("li"), { className: "none", textContent: "No problems found. Ready for adjudication." }));
  for (const issue of current.issues) list.append(Object.assign(document.createElement("li"), { className: issue.severity, textContent: issue.message }));
  $(".extractor", view).textContent = "Extracted by " + current.extractor + (current.servedBy ? " (" + current.servedBy + ")" : "") + " in " + current.timingsMs.total + " ms. Reply drafted by " + current.draft.draftedBy + ".";
  const grid = $(".fields", view);
  for (const [key, value] of Object.entries(current.fields)) {
    const label = document.createElement("label");
    label.textContent = LABELS[key] || key;
    const input = Object.assign(document.createElement("input"), { name: key, value: value ?? "", placeholder: "missing" });
    if (flagged.has(key)) input.className = "flagged";
    label.append(input);
    grid.append(label);
  }
  $("[name=subject]", view).value = current.draft.subject;
  $("[name=body]", view).value = current.draft.body;
  view.querySelectorAll("[data-decision]").forEach((b) => (b.onclick = () => decide(b.dataset.decision)));
  if (current.reviewState !== "pending_review") view.querySelectorAll("button.act, input, textarea").forEach((el) => (el.disabled = true));
  $("#detail").replaceChildren(view);
  if (current.reviewState !== "pending_review") $("#toast").textContent = "Already " + current.reviewState + ".";
}

async function decide(decision) {
  const root = $("#detail");
  const fields = {};
  for (const input of root.querySelectorAll(".fields input")) {
    const v = input.value.trim();
    fields[input.name] = v === "" ? null : input.name === "billedAmount" ? Number(v) : v;
  }
  const res = await fetch("/api/claims/" + encodeURIComponent(current.id) + "/review", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, fields, reviewer: $("[name=reviewer]", root).value, subject: $("[name=subject]", root).value, body: $("[name=body]", root).value }),
  });
  const data = await res.json();
  if (!res.ok) { $("#toast").textContent = data.error; return; }
  const id = current.id;
  await load();
  select(id);
  $("#toast").textContent = "Saved: " + data.audit.decision + (data.audit.corrections.length ? ", " + data.audit.corrections.length + " field correction(s) logged." : ".");
}
load();
</script>
</body>
</html>`;
