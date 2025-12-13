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

function submitForm(progress, items) {
  const visible = items.filter(it => (it.unlocks_at ?? 0) <= progress);

  const options = visible.map(it => {
    return `<option value="${escapeHtml(it.id)}">${escapeHtml(it.id)} — ${escapeHtml(it.title)}</option>`;
  }).join("");

  return `
    <div class="muted small">INVESTIGATOR REPORT (FORM IR-1)</div>
    <div class="small muted">Complete all fields. Use evidence IDs where applicable.</div>
    <hr>

    <label>SUBJECT</label>
    <input id="r_subject" placeholder="e.g., Incident Reconstruction / Persons Unknown" />

    <label>FACTS ESTABLISHED (bullet points)</label>
    <textarea id="r_facts" placeholder="- Fact 1\n- Fact 2\n- Fact 3"></textarea>

    <label>TIMELINE RECONSTRUCTION</label>
    <textarea id="r_timeline" placeholder="Describe sequence of events in order. Include times if known."></textarea>

    <label>PRIMARY HYPOTHESIS (one sentence)</label>
    <input id="r_hypothesis" placeholder="A single sentence explaining what happened and why." />

    <label>EVIDENCE RELIED UPON (select 1–6)</label>
    <select id="r_evidence" multiple size="6">
      ${options}
    </select>
    <div class="small muted">Hold Ctrl to select multiple.</div>

    <label>CONFIDENCE</label>
    <select id="r_confidence">
      <option>Low</option>
      <option selected>Medium</option>
      <option>High</option>
    </select>

    <div class="row" style="margin-top:10px;">
      <button id="fileReport">file report</button>
    </div>

    <div class="footer muted">
      Clearance level: ${progress}
    </div>
  `;
}

function evaluateSubmission(payload) {
  // Minimal rules for now:
  // - Must provide hypothesis
  // - Must cite at least 2 evidence IDs
  // - Clearance increases gradually (0->1->2)
  const hyp = (payload.hypothesis || "").trim();
  const cited = payload.evidence || [];

  if (!hyp) return { ok:false, message:"REJECTED: Missing primary hypothesis." };
  if (cited.length < 2) return { ok:false, message:"REJECTED: Cite at least two evidence items." };

  // Placeholder branching seed (we will replace with real branch rules later)
  // For now: advance 1 step if below 1, else advance to 2.
  const current = payload.progress;
  const advanceTo = current < 1 ? 1 : Math.min(current + 1, 2);

  return {
    ok: true,
    message: "ACCEPTED: Report logged. Additional material has been located.",
    advanceTo
  };
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
  setViewer("submit", `<pre class="muted">Complete the report on the right panel.</pre>`);
  setPanel(submitForm(getProgress(), registry.items));

  $("#fileReport").addEventListener("click", async () => {
    const subject = $("#r_subject").value;
    const facts = $("#r_facts").value;
    const timeline = $("#r_timeline").value;
    const hypothesis = $("#r_hypothesis").value;
    const confidence = $("#r_confidence").value;

    const sel = $("#r_evidence");
    const evidence = Array.from(sel.selectedOptions).map(o => o.value);

    const payload = {
      progress: getProgress(),
      subject, facts, timeline, hypothesis, confidence,
      evidence
    };

    const result = evaluateSubmission(payload);
    if (!result.ok) {
      setViewer("submit", `<pre>${escapeHtml(result.message)}</pre>`);
      return;
    }

    const newLevel = Math.max(getProgress(), result.advanceTo ?? getProgress());
    setProgress(newLevel);

    $("#caseMeta").textContent = `STATUS: OPEN · CLEARANCE: ${newLevel}`;
    setViewer("submit", `<pre>${escapeHtml(result.message)}\n\nClearance updated to ${newLevel}.</pre>`);
    setPanel(`<div class="muted">Return to Evidence to review newly available items.</div>`);
  });
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
