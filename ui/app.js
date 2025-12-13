const KEY = "case_progress_v1";

function getProgress() {
  return Number(localStorage.getItem(KEY) || "0");
}
function setProgress(n) {
  localStorage.setItem(KEY, String(n));
}
function resetProgress() {
  localStorage.removeItem(KEY);
}

function $(sel) { return document.querySelector(sel); }
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// Minimal markdown-ish rendering (safe, simple):
function renderText(md) {
  // Keep it extremely simple for now: show as preformatted text.
  return `<pre>${escapeHtml(md)}</pre>`;
}

async function loadRegistry() {
  const res = await fetch("evidence/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load evidence registry");
  return res.json();
}

async function loadDoc(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load document: " + path);
  return res.text();
}

function setViewer(label, html) {
  $("#viewLabel").textContent = "VIEW: " + label.toUpperCase();
  $("#viewer").innerHTML = html;
}

function setPanel(html) {
  $("#panel").innerHTML = html;
}

function evidenceList(items, progress) {
  const visible = items.filter(it => (it.unlocks_at ?? 0) <= progress);
  const locked = items.filter(it => (it.unlocks_at ?? 0) > progress);

  const mk = (arr, title) => `
    <div class="muted small">${title}</div>
    <ul>
      ${arr.map(it => `
        <li>
          <a href="#" data-doc="${it.path}" data-label="${it.title}">
            ${escapeHtml(it.title)}
          </a>
          <span class="muted small">(${escapeHtml(it.id)})</span>
        </li>
      `).join("")}
    </ul>
  `;

  const lockedBlock = locked.length ? `
    <div class="muted small">LOCKED</div>
    <ul>
      ${locked.map(it => `<li class="muted">${escapeHtml(it.title)} (${escapeHtml(it.id)})</li>`).join("")}
    </ul>
  ` : `<div class="muted small">LOCKED</div><div class="muted">none</div>`;

  return mk(visible, "AVAILABLE") + lockedBlock;
}

function submitForm(progress) {
  // This is the “police report” skeleton. We’ll make it more authentic next.
  return `
    <div class="muted small">INVESTIGATOR SUBMISSION</div>
    <label>Facts Established (free text for now)</label>
    <textarea id="facts" placeholder="List facts you believe are established."></textarea>

    <label>Timeline Reconstruction</label>
    <textarea id="timeline" placeholder="Describe the sequence of events."></textarea>

    <label>Primary Hypothesis (one sentence)</label>
    <input id="hypothesis" placeholder="State your conclusion in one sentence." />

    <label>Confidence</label>
    <select id="confidence">
      <option>Low</option>
      <option selected>Medium</option>
      <option>High</option>
    </select>

    <div class="row" style="margin-top:10px;">
      <button id="fileReport">file report</button>
    </div>

    <div class="footer muted">
      Current clearance level: ${progress}
    </div>
  `;
}

function evaluateSubmission(text) {
  // Placeholder evaluation: we’ll replace this with branching rules later.
  // For now: any non-empty hypothesis advances progress by 1 (up to 2).
  const h = (text || "").trim();
  if (!h) return { ok: false, message: "Submission rejected: missing hypothesis." };
  return { ok: true, message: "Submission accepted. Additional material located.", advanceTo: 1 };
}

async function main() {
  const registry = await loadRegistry();
  const progress = getProgress();

  // Header metadata
  $("#caseId").textContent = registry.case.case_id;
  $("#caseTitle").textContent = registry.case.title;
  $("#caseMeta").textContent = `STATUS: OPEN · CLEARANCE: ${progress}`;

  async function openOverview() {
    const txt = await loadDoc(registry.case.summary_path);
    setViewer("overview", renderText(txt));
    setPanel(`<div class="muted">Review known information. No submissions required.</div>`);
  }

  async function openEvidence() {
    setViewer("evidence", `<pre class="muted">Select an evidence item from the right panel.</pre>`);
    setPanel(evidenceList(registry.items, getProgress()));
  }

  async function openTimeline() {
    // Timeline is just another doc, but usually gated.
    const item = registry.items.find(it => it.id === "T-401");
    const p = getProgress();
    if (!item || item.unlocks_at > p) {
      setViewer("timeline", `<pre class="muted">Timeline is not available at your current clearance.</pre>`);
      setPanel(`<div class="muted">Submit a report to increase clearance.</div>`);
      return;
    }
    const txt = await loadDoc(item.path);
    setViewer("timeline", renderText(txt));
    setPanel(`<div class="muted">Timeline access granted.</div>`);
  }

  async function openSubmit() {
    setViewer("submit", `<pre class="muted">Complete the submission on the right panel.</pre>`);
    setPanel(submitForm(getProgress()));

    $("#fileReport").addEventListener("click", async () => {
      const facts = $("#facts").value;
      const tl = $("#timeline").value;
      const hyp = $("#hypothesis").value;
      const conf = $("#confidence").value;

      const result = evaluateSubmission([facts, tl, hyp, conf].join("\n"));
      if (!result.ok) {
        setViewer("submit", `<pre>${escapeHtml(result.message)}</pre>`);
        return;
      }

      // Advance clearance
      const newLevel = Math.max(getProgress(), result.advanceTo ?? getProgress());
      setProgress(newLevel);

      $("#caseMeta").textContent = `STATUS: OPEN · CLEARANCE: ${newLevel}`;
      setViewer("submit", `<pre>${escapeHtml(result.message)}\n\nClearance updated to ${newLevel}.</pre>`);
      setPanel(`<div class="muted">Return to Evidence to review newly available items.</div>`);
    });
  }

  // Nav handlers
  document.querySelectorAll("button[data-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const view = btn.dataset.view;
      if (view === "overview") await openOverview();
      if (view === "evidence") await openEvidence();
      if (view === "timeline") await openTimeline();
      if (view === "submit") await openSubmit();
    });
  });

  $("#reset").addEventListener("click", async () => {
    resetProgress();
    $("#caseMeta").textContent = `STATUS: OPEN · CLEARANCE: 0`;
    setViewer("overview", `<pre class="muted">Progress reset. Reloading…</pre>`);
    location.reload();
  });

  // Evidence click handler (delegated)
  $("#panel").addEventListener("click", async (e) => {
    const a = e.target.closest("a[data-doc]");
    if (!a) return;
    e.preventDefault();
    const path = a.dataset.doc;
    const label = a.dataset.label || "document";
    const txt = await loadDoc(path);
    setViewer(label, renderText(txt));
  });

  // Default view
  await openOverview();
}

main().catch(err => {
  setViewer("error", `<pre>${escapeHtml(String(err))}</pre>`);
  setPanel(`<div class="muted">Failed to initialize.</div>`);
});
