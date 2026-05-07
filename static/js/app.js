/**
 * Sales Pipeline Tracker — Relationship Workspace Edition
 * Stabilization pass: fixed modal selectors, replaced stage drag with arrows,
 * hardened event delegation.
 */

const PROFILE_STORAGE_KEY = "pipelineUserProfile";

// ── State ──────────────────────────────────────────────
let stages = [];
let currentLeadId = null;
let currentLeadData = null;
let saveTimer = null;

const STAGE_COLORS = ["#64748b", "#0d9488", "#d97706", "#7c3aed", "#059669"];
function getStageColor(pos) { return STAGE_COLORS[pos % STAGE_COLORS.length]; }

// ── DOM safe access ───────────────────────────────────
function $id(id) { return document.getElementById(id); }

// ── Profile ────────────────────────────────────────────
function normalizeProfile(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    userName: String(obj.userName || "").trim(),
    jobTitle: String(obj.jobTitle || "").trim(),
    companyName: String(obj.companyName || "").trim(),
    selling: String(obj.selling || "").trim(),
  };
}

function loadUserProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : null;
  } catch { return null; }
}

function saveUserProfile(p) { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p)); }
function isProfileComplete(p) { return !!(p && p.userName && p.jobTitle && p.companyName && p.selling); }

function getUserContextForApi() {
  const p = loadUserProfile();
  if (!isProfileComplete(p)) return null;
  return { user_name: p.userName, job_title: p.jobTitle, company_name: p.companyName, selling: p.selling };
}

function setProfileAriaStates() {
  const overlay = $id("profile-onboarding");
  if (!overlay) return;
  const ready = document.documentElement.classList.contains("profile-ready");
  const editing = overlay.classList.contains("profile-onboarding--edit-open");
  overlay.setAttribute("aria-hidden", (!ready || editing) ? "false" : "true");
}

function populateProfileForm() {
  const p = loadUserProfile();
  const map = { profile_user_name: "userName", profile_job_title: "jobTitle", profile_company_name: "companyName", profile_selling: "selling" };
  Object.entries(map).forEach(([id, key]) => { const el = $id(id); if (el) el.value = p?.[key] || ""; });
}

function openProfileEditorFromHeader() {
  populateProfileForm();
  const overlay = $id("profile-onboarding");
  overlay?.classList.add("profile-onboarding--edit-open");
  $id("profile-cancel-btn")?.classList.remove("hidden");
  const titleEl = $id("profile-onboarding-title");
  if (titleEl) titleEl.textContent = "Edit your profile";
  const saveBtn = $id("profile-save-btn");
  if (saveBtn) saveBtn.textContent = "Save";
  setProfileAriaStates();
}

function closeProfileEditor() {
  populateProfileForm();
  $id("profile-onboarding")?.classList.remove("profile-onboarding--edit-open");
  $id("profile-cancel-btn")?.classList.add("hidden");
  setProfileAriaStates();
}

async function handleProfileFormSubmit(ev) {
  ev.preventDefault();
  const form = $id("profile-setup-form");
  if (!form) return;
  const profile = { userName: form.userName.value.trim(), jobTitle: form.jobTitle.value.trim(), companyName: form.companyName.value.trim(), selling: form.selling.value.trim() };
  if (!isProfileComplete(profile)) { alert("Please fill in all fields."); return; }
  saveUserProfile(profile);
  document.documentElement.classList.add("profile-ready");
  closeProfileEditor();
  await loadAllData();
}

// ── API helper ─────────────────────────────────────────
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
  return data;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diff = Date.now() - date;
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
}

function formatFullDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ── Stages ─────────────────────────────────────────────
async function loadStages() {
  try { stages = await fetchJson("/api/stages"); }
  catch (err) { console.error("Failed to load stages:", err); stages = []; }
}

async function handleAddStage(name) {
  if (!name || !name.trim()) return;
  try {
    const newStage = await fetchJson("/api/stages", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    stages.push(newStage);
    await buildBoard();
    await loadLeads();
    populateStageDropdowns();
    renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

async function handleRenameStage(stageId, newName) {
  if (!newName || !newName.trim()) return;
  try {
    await fetchJson(`/api/stages/${stageId}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) });
    const stage = stages.find(s => s.id === stageId);
    if (stage) stage.name = newName.trim();
    await buildBoard();
    await loadLeads();
    populateStageDropdowns();
  } catch (err) { alert(err.message); }
}

async function handleDeleteStage(stageId) {
  try {
    await fetchJson(`/api/stages/${stageId}`, { method: "DELETE" });
    stages = stages.filter(s => s.id !== stageId);
    await buildBoard();
    await loadLeads();
    populateStageDropdowns();
    renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

async function handleReorderStages(order) {
  try {
    await fetchJson("/api/stages/reorder", { method: "POST", body: JSON.stringify({ order }) });
    order.forEach((stageId, pos) => { const s = stages.find(x => x.id === stageId); if (s) s.position = pos; });
    await buildBoard();
    await loadLeads();
    renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

function populateStageDropdowns(preselectedStage) {
  document.querySelectorAll("select[name='stage']").forEach(select => {
    const currentValue = preselectedStage || select.value;
    select.innerHTML = "";
    stages.forEach(stage => {
      const option = document.createElement("option");
      option.value = stage.name;
      option.textContent = stage.name;
      if (stage.name === currentValue) option.selected = true;
      select.appendChild(option);
    });
  });
}

// ── Board ──────────────────────────────────────────────
function buildBoard() {
  const board = $id("kanban-board");
  if (!board) return;
  board.innerHTML = "";
  stages.forEach((stage, index) => {
    const column = document.createElement("div");
    column.className = "kanban-column";
    column.dataset.stage = stage.name;
    column.dataset.stageId = stage.id;
    column.innerHTML = `
      <div class="column-header">
        <h3>${escapeHtml(stage.name)}</h3>
        <span class="column-count" data-stage="${escapeHtml(stage.name)}">0</span>
      </div>
      <div class="lead-list" id="stage-${index}" data-stage="${escapeHtml(stage.name)}"></div>
      <div class="add-lead-area" data-stage="${escapeHtml(stage.name)}">
        <button type="button" class="add-lead-btn" title="Add lead">+</button>
        <span class="add-lead-label">Add Lead</span>
      </div>
    `;
    board.appendChild(column);
  });
}

function renderLeads(leads) {
  document.querySelectorAll(".lead-list").forEach(list => { list.innerHTML = ""; });

  const leadsByStage = {};
  leads.forEach(lead => {
    if (!leadsByStage[lead.stage]) leadsByStage[lead.stage] = [];
    leadsByStage[lead.stage].push(lead);
  });

  stages.forEach((stage, index) => {
    const list = document.getElementById(`stage-${index}`);
    const column = list?.closest(".kanban-column");
    const columnLeads = leadsByStage[stage.name] || [];

    const countBadge = column?.querySelector(".column-count");
    if (countBadge) countBadge.textContent = columnLeads.length;

    if (column) {
      column.classList.toggle("kanban-column--empty", columnLeads.length === 0);
    }

    columnLeads.forEach(lead => {
      list.appendChild(createLeadCard(lead, index));
    });
  });
}

function createLeadCard(lead, stagePosition) {
  const article = document.createElement("article");
  article.className = "lead-card";
  article.dataset.leadId = String(lead.id);
  article.dataset.stage = lead.stage;
  article.draggable = true;

  const color = getStageColor(stagePosition);
  article.style.setProperty("--card-accent", color);

  const updated = lead.updated_at ? formatDate(lead.updated_at) : "";

  article.innerHTML = `
    <div class="lead-card__body">
      <h4 class="lead-card__company">${escapeHtml(lead.company_name)}</h4>
      <p class="lead-card__contact">${escapeHtml(lead.contact_name)}</p>
      <a class="lead-card__email" href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>
      ${updated ? `<span class="lead-card__updated">${updated}</span>` : ""}
    </div>
    <div class="lead-card__actions">
      <button type="button" class="card-btn card-btn--email" data-action="email" data-lead-id="${lead.id}" title="Generate email">✉️ Generate Email</button>
      <button type="button" class="card-btn card-btn--icon" data-action="edit" data-lead-id="${lead.id}" title="Edit lead">✏️</button>
      <button type="button" class="card-btn card-btn--icon card-btn--danger" data-action="delete" data-lead-id="${lead.id}" title="Delete">🗑️</button>
    </div>
  `;

  // Drag handlers
  article.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(lead.id));
    e.dataTransfer.effectAllowed = "move";
    article.classList.add("lead-card--dragging");
  });
  article.addEventListener("dragend", () => {
    article.classList.remove("lead-card--dragging");
    document.querySelectorAll(".kanban-column").forEach(col => col.classList.remove("column--drag-over"));
  });

  return article;
}

// ── Leads ──────────────────────────────────────────────
async function loadLeads() {
  try {
    const leads = await fetchJson("/api/leads");
    renderLeads(leads);
  } catch (err) { console.error(err); alert(err.message); }
}

async function loadAllData() {
  await loadStages();
  buildBoard();
  populateStageDropdowns();
  await loadLeads();
}

async function handleAddLeadSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    company_name: form.company_name.value.trim(),
    contact_name: form.contact_name.value.trim(),
    email: form.email.value.trim(),
    notes: form.notes.value.trim(),
    stage: form.stage.value,
  };
  try {
    await fetchJson("/api/leads", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    closeAddLeadModal();
    await loadLeads();
  } catch (err) { alert(err.message); }
}

async function handleDeleteClick(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;
  if (!confirm("Delete this lead?")) return;
  button.disabled = true;
  try {
    await fetchJson(`/api/leads/${leadId}`, { method: "DELETE" });
    await loadLeads();
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; }
}

// ── Relationship Workspace Modal ───────────────────────
function openRelationshipModal(lead) {
  currentLeadId = lead.id;
  currentLeadData = lead;

  const modal = $id("relationship-modal");
  const textarea = $id("notes-textarea");
  if (!modal || !textarea) return;

  // Header — all selectors now reference actual IDs in the HTML
  const elCompany = $id("rel-company");
  const elContact = $id("rel-contact");
  const elStage = $id("rel-stage");
  const elEmail = $id("rel-email");
  const elCreated = $id("rel-created");
  const elUpdated = $id("rel-updated");
  const researchPanel = $id("research-panel");
  const researchEmpty = $id("research-empty");
  const researchContent = $id("research-content");
  const timeline = $id("timeline-list");
  const editBtn = $id("rel-edit-btn");

  if (elCompany) elCompany.textContent = lead.company_name;
  if (elContact) elContact.textContent = lead.contact_name;
  if (elStage) { elStage.textContent = lead.stage; elStage.className = "badge badge--stage"; }
  if (elEmail) { elEmail.textContent = lead.email; elEmail.href = `mailto:${lead.email}`; }
  if (elCreated) elCreated.textContent = formatFullDate(lead.created_at);
  if (elUpdated) elUpdated.textContent = formatFullDate(lead.updated_at);

  // Notes
  textarea.value = lead.notes || "";
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  const saveStatus = $id("notes-save-status");
  if (saveStatus) saveStatus.textContent = "";

  // Research
  if (researchPanel) researchPanel.classList.add("hidden");
  if (researchEmpty) researchEmpty.classList.remove("hidden");
  if (researchContent) { researchContent.innerHTML = ""; researchContent.dataset.researchText = ""; }

  // Timeline placeholder
  if (timeline) {
    timeline.innerHTML = `
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Lead created</strong><br/><small>${formatFullDate(lead.created_at)}</small></div>
      </li>
      ${lead.updated_at && lead.updated_at !== lead.created_at ? `
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Last updated</strong><br/><small>${formatFullDate(lead.updated_at)}</small></div>
      </li>` : ""}
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Stage</strong><br/><small>${escapeHtml(lead.stage)}</small></div>
      </li>
    `;
  }

  if (editBtn) editBtn.dataset.leadId = lead.id;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeRelationshipModal() {
  flushAutoSave();
  const modal = $id("relationship-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  currentLeadId = null;
  currentLeadData = null;
}

// ── Auto-save ──────────────────────────────────────────
function debouncedSaveNotes() {
  if (saveTimer) clearTimeout(saveTimer);
  const status = $id("notes-save-status");
  if (status) { status.textContent = "Saving…"; status.className = "save-status save-status--saving"; }
  saveTimer = setTimeout(() => flushAutoSave(), 800);
}

async function flushAutoSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!currentLeadId) return;

  const textarea = $id("notes-textarea");
  if (!textarea) return;

  const content = textarea.value;
  const status = $id("notes-save-status");

  try {
    await fetchJson(`/api/leads/${currentLeadId}/notes`, { method: "PATCH", body: JSON.stringify({ content }) });
    if (status) { status.textContent = "Saved"; status.className = "save-status save-status--saved"; }
    if (currentLeadData) currentLeadData.notes = content;
    await loadLeads();
  } catch (err) {
    console.error("Auto-save failed:", err);
    if (status) { status.textContent = "Save failed"; status.className = "save-status save-status--error"; }
  }
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// ── Research ───────────────────────────────────────────
async function handleResearch() {
  if (!currentLeadId) return;
  const uc = getUserContextForApi();
  if (!uc) { alert("Please complete your profile before using AI research."); return; }

  const btn = $id("run-research-btn");
  const empty = $id("research-empty");
  const panel = $id("research-panel");
  const content = $id("research-content");

  if (btn) { btn.disabled = true; btn.textContent = "Researching…"; }
  if (empty) empty.classList.add("hidden");

  try {
    const result = await fetchJson(`/api/leads/${currentLeadId}/research`, { method: "POST", body: JSON.stringify({ user_context: uc }) });
    if (panel) panel.classList.remove("hidden");
    if (content) {
      content.innerHTML = parseResearchOutput(result.research);
      content.dataset.researchText = result.research;
    }
  } catch (err) {
    alert(err.message);
    if (empty) empty.classList.remove("hidden");
  }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Run Research"; } }
}

function parseResearchOutput(text) {
  const sections = { whatTheyDo: "", contactRole: "", painPoints: [], talkingPoints: [] };
  let cur = null;
  text.split("\n").forEach(line => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith("• What they do:")) { sections.whatTheyDo = t.replace(/^•\s*What they do:\s*/, ""); cur = "whatTheyDo"; }
    else if (t.startsWith("• Contact's role:")) { sections.contactRole = t.replace(/^•\s*Contact's role:\s*/, ""); cur = "contactRole"; }
    else if (t.startsWith("• Their likely pain points:")) { cur = "painPoints"; }
    else if (t.startsWith("• Talking points:")) { cur = "talkingPoints"; }
    else if (t.startsWith("- ") && cur === "painPoints") { sections.painPoints.push(t.substring(2)); }
    else if (t.startsWith("- ") && cur === "talkingPoints") { sections.talkingPoints.push(t.substring(2)); }
  });
  let html = "";
  if (sections.whatTheyDo) html += `<h4>What they do</h4><p>${escapeHtml(sections.whatTheyDo)}</p>`;
  if (sections.contactRole) html += `<h4>Contact's role</h4><p>${escapeHtml(sections.contactRole)}</p>`;
  if (sections.painPoints.length) html += `<h4>Pain points</h4><ul>${sections.painPoints.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
  if (sections.talkingPoints.length) html += `<h4>Talking points</h4><ul>${sections.talkingPoints.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
  return html || `<p>${escapeHtml(text)}</p>`;
}

// ── Email Modal ────────────────────────────────────────
function openEmailModal(draft) {
  const modal = $id("email-modal");
  const output = $id("email-draft-output");
  if (!modal || !output) return;
  output.value = draft || "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEmailModal() {
  const modal = $id("email-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  const output = $id("email-draft-output");
  if (output) output.value = "";
}

async function handleGenerateEmail(e, leadId) {
  e.stopPropagation();
  e.preventDefault();
  if (!leadId) return;
  try {
    const genBody = {};
    const uc = getUserContextForApi();
    if (uc) genBody.user_context = uc;
    const result = await fetchJson(`/api/leads/${leadId}/generate-follow-up`, { method: "POST", body: JSON.stringify(genBody) });
    openEmailModal(result.draft || "");
  } catch (err) { alert(err.message); }
}

// ── Edit Lead ──────────────────────────────────────────
function openEditLeadModal(lead) {
  const modal = $id("edit-lead-modal");
  if (!modal) return;
  const elCompany = $id("edit_company_name");
  const elContact = $id("edit_contact_name");
  const elEmail = $id("edit_email");
  if (elCompany) elCompany.value = lead.company_name || "";
  if (elContact) elContact.value = lead.contact_name || "";
  if (elEmail) elEmail.value = lead.email || "";
  populateStageDropdowns(lead.stage);
  modal.dataset.leadId = lead.id;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEditLeadModal() {
  const modal = $id("edit-lead-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function handleEditLeadSubmit(event) {
  event.preventDefault();
  const modal = $id("edit-lead-modal");
  if (!modal) return;
  const leadId = modal.dataset.leadId;
  if (!leadId) return;
  const payload = {
    company_name: ($id("edit_company_name")?.value || "").trim(),
    contact_name: ($id("edit_contact_name")?.value || "").trim(),
    email: ($id("edit_email")?.value || "").trim(),
    stage: $id("edit_stage")?.value || "",
  };
  try {
    await fetchJson(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(payload) });
    closeEditLeadModal();
    await loadLeads();
  } catch (err) { alert(err.message); }
}

// ── Add Lead Modal ─────────────────────────────────────
function openAddLeadModal(preselectedStage) {
  const modal = $id("add-lead-modal");
  if (!modal) return;
  populateStageDropdowns(preselectedStage);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeAddLeadModal() {
  const modal = $id("add-lead-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  $id("add-lead-form")?.reset();
}

// ── Stage Settings (arrow buttons — no drag/drop) ──────
function openStageSettings() {
  const modal = $id("stage-settings-modal");
  if (!modal) return;
  renderStageSettingsList();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeStageSettings() {
  const modal = $id("stage-settings-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function renderStageSettingsList() {
  const list = $id("stages-list");
  if (!list) return;

  list.innerHTML = "";

  fetchJson("/api/leads").then(leads => {
    const counts = {};
    leads.forEach(lead => { counts[lead.stage] = (counts[lead.stage] || 0) + 1; });

    stages.forEach((stage, index) => {
      const li = document.createElement("li");
      li.className = "stage-item";
      li.dataset.stageId = stage.id;

      const color = getStageColor(index);
      const leadCount = counts[stage.name] || 0;
      const canDelete = leadCount === 0;
      const isFirst = index === 0;
      const isLast = index === stages.length - 1;

      li.innerHTML = `
        <span class="stage-item__dot" style="background:${color}"></span>
        <input type="text" class="stage-item__input" value="${escapeHtml(stage.name)}" data-stage-id="${stage.id}" />
        <span class="stage-item__count">${leadCount} lead${leadCount !== 1 ? "s" : ""}</span>
        <div class="stage-item__arrows">
          <button type="button" class="stage-arrow stage-arrow--up" data-stage-id="${stage.id}" title="Move up" ${isFirst ? "disabled" : ""}>▲</button>
          <button type="button" class="stage-arrow stage-arrow--down" data-stage-id="${stage.id}" title="Move down" ${isLast ? "disabled" : ""}>▼</button>
        </div>
        <button type="button" class="stage-item__delete" data-stage-id="${stage.id}" ${!canDelete ? "disabled" : ""} title="${canDelete ? "Delete stage" : "Move leads first"}">🗑️</button>
      `;

      // Rename on blur
      const input = li.querySelector(".stage-item__input");
      input.addEventListener("blur", () => {
        const newName = input.value.trim();
        if (newName && newName !== stage.name) handleRenameStage(stage.id, newName);
        else input.value = stage.name;
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

      // Delete
      li.querySelector(".stage-item__delete").addEventListener("click", () => {
        if (canDelete) handleDeleteStage(stage.id);
      });

      // Arrow buttons
      li.querySelector(".stage-arrow--up").addEventListener("click", () => {
        if (index > 0) moveStage(stage.id, index - 1);
      });
      li.querySelector(".stage-arrow--down").addEventListener("click", () => {
        if (index < stages.length - 1) moveStage(stage.id, index + 1);
      });

      list.appendChild(li);
    });
  }).catch(err => console.error("Failed to load leads for stage settings:", err));
}

async function moveStage(stageId, newIndex) {
  const currentIndex = stages.findIndex(s => s.id === stageId);
  if (currentIndex === -1) return;

  // Reorder local array
  const [moved] = stages.splice(currentIndex, 1);
  stages.splice(newIndex, 0, moved);

  // Persist
  const order = stages.map(s => s.id);
  try {
    await fetchJson("/api/stages/reorder", { method: "POST", body: JSON.stringify({ order }) });
    await buildBoard();
    await loadLeads();
    renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

async function handleAddStageFormSubmit(event) {
  event.preventDefault();
  const input = $id("new-stage-name");
  if (!input) return;
  const name = input.value.trim();
  if (name) {
    await handleAddStage(name);
    input.value = "";
  }
}

// ── Global event delegation ────────────────────────────
function initGlobalDelegation() {
  const board = $id("kanban-board");
  if (!board) return;

  // Click delegation
  board.addEventListener("click", async (e) => {
    // Add Lead button
    const addBtn = e.target.closest(".add-lead-btn") || e.target.closest(".add-lead-area");
    if (addBtn) {
      e.preventDefault();
      const stage = addBtn.closest(".kanban-column")?.dataset.stage || addBtn.dataset.stage;
      openAddLeadModal(stage);
      return;
    }

    // Lead card click → open relationship workspace
    const card = e.target.closest(".lead-card");
    if (card) {
      // If the click is on a button or link, let that action handle it
      if (e.target.closest("button") || e.target.closest("a")) return;
      e.preventDefault();
      try {
        const lead = await fetchJson(`/api/leads/${card.dataset.leadId}`);
        openRelationshipModal(lead);
      } catch (err) { alert(err.message); }
      return;
    }

    // Generate Email button
    const emailBtn = e.target.closest("[data-action='email']");
    if (emailBtn) {
      handleGenerateEmail(e, emailBtn.dataset.leadId);
      return;
    }

    // Edit button
    const editBtn = e.target.closest("[data-action='edit']");
    if (editBtn) {
      e.stopPropagation();
      try {
        const lead = await fetchJson(`/api/leads/${editBtn.dataset.leadId}`);
        openEditLeadModal(lead);
      } catch (err) { alert(err.message); }
      return;
    }

    // Delete button
    const delBtn = e.target.closest("[data-action='delete']");
    if (delBtn) {
      e.stopPropagation();
      handleDeleteClick(delBtn);
      return;
    }
  });

  // Drag-and-drop delegation
  board.addEventListener("dragenter", (e) => {
    const col = e.target.closest(".kanban-column");
    if (col) { e.preventDefault(); col.classList.add("column--drag-over"); }
  });
  board.addEventListener("dragleave", (e) => {
    const col = e.target.closest(".kanban-column");
    if (col && !col.contains(e.relatedTarget)) col.classList.remove("column--drag-over");
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".kanban-column");
    if (col) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  });
  board.addEventListener("drop", async (e) => {
    e.preventDefault();
    const col = e.target.closest(".kanban-column");
    if (!col) return;
    col.classList.remove("column--drag-over");
    const leadId = e.dataTransfer.getData("text/plain");
    if (!leadId) return;
    const newStage = col.dataset.stage;
    if (!newStage) return;
    try {
      await fetchJson(`/api/leads/${leadId}/stage`, { method: "PATCH", body: JSON.stringify({ stage: newStage }) });
      await loadLeads();
    } catch (err) { alert(err.message); }
  });
}

function dismissAllModals() {
  closeEmailModal();
  closeRelationshipModal();
  closeAddLeadModal();
  closeStageSettings();
  closeEditLeadModal();
}

// ── Initialize ─────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  populateProfileForm();
  setProfileAriaStates();
  initGlobalDelegation();

  // Profile
  $id("profile-setup-form")?.addEventListener("submit", (ev) => { void handleProfileFormSubmit(ev); });
  $id("profile-cancel-btn")?.addEventListener("click", closeProfileEditor);
  $id("open-profile-setup")?.addEventListener("click", openProfileEditorFromHeader);
  $id("profile-onboarding")?.addEventListener("click", (ev) => {
    if (ev.target !== ev.currentTarget) return;
    if (document.documentElement.classList.contains("profile-ready")) closeProfileEditor();
  });

  // Add Lead
  $id("open-add-lead-modal")?.addEventListener("click", () => openAddLeadModal());
  $id("close-add-lead-modal")?.addEventListener("click", closeAddLeadModal);
  $id("cancel-add-lead")?.addEventListener("click", closeAddLeadModal);
  $id("add-lead-form")?.addEventListener("submit", handleAddLeadSubmit);

  // Edit Lead
  $id("close-edit-lead-modal")?.addEventListener("click", closeEditLeadModal);
  $id("edit-lead-form")?.addEventListener("submit", handleEditLeadSubmit);

  // Relationship modal
  $id("close-relationship-modal")?.addEventListener("click", closeRelationshipModal);
  $id("rel-edit-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (currentLeadId) {
      try {
        const lead = await fetchJson(`/api/leads/${currentLeadId}`);
        openEditLeadModal(lead);
      } catch (err) { alert(err.message); }
    }
  });
  $id("run-research-btn")?.addEventListener("click", handleResearch);

  // Notes auto-save
  const notesTextarea = $id("notes-textarea");
  if (notesTextarea) {
    notesTextarea.addEventListener("input", () => {
      autoResizeTextarea(notesTextarea);
      debouncedSaveNotes();
    });
  }

  // Stage Settings
  $id("open-stage-settings")?.addEventListener("click", openStageSettings);
  $id("close-stage-settings")?.addEventListener("click", closeStageSettings);
  $id("add-stage-form")?.addEventListener("submit", handleAddStageFormSubmit);

  // Email modal
  $id("close-email-modal")?.addEventListener("click", closeEmailModal);

  // Backdrop dismiss
  document.querySelectorAll("[data-modal-dismiss]").forEach(el => {
    el.addEventListener("click", dismissAllModals);
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlay = $id("profile-onboarding");
    if (overlay?.classList.contains("profile-onboarding--edit-open")) { closeProfileEditor(); e.preventDefault(); return; }
    dismissAllModals();
  });

  // Init board
  if (document.documentElement.classList.contains("profile-ready")) {
    void loadAllData();
  }
});