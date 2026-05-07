/**
 * Sales Pipeline Tracker — Relationship Workspace Edition
 */

const PROFILE_STORAGE_KEY = "pipelineUserProfile";

// ── State ──────────────────────────────────────────────
let stages = [];
let currentLeadId = null;
let currentLeadData = null;
let saveTimer = null;
let stageSettingsInitialized = false;

const STAGE_COLORS = ["#64748b", "#0d9488", "#d97706", "#7c3aed", "#059669"];
function getStageColor(pos) { return STAGE_COLORS[pos % STAGE_COLORS.length]; }

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
  const overlay = document.getElementById("profile-onboarding");
  if (!overlay) return;
  const ready = document.documentElement.classList.contains("profile-ready");
  const editing = overlay.classList.contains("profile-onboarding--edit-open");
  overlay.setAttribute("aria-hidden", (!ready || editing) ? "false" : "true");
}

function populateProfileForm() {
  const p = loadUserProfile();
  const map = { profile_user_name: "userName", profile_job_title: "jobTitle", profile_company_name: "companyName", profile_selling: "selling" };
  Object.entries(map).forEach(([id, key]) => { const el = document.getElementById(id); if (el) el.value = p?.[key] || ""; });
}

function openProfileEditorFromHeader() {
  populateProfileForm();
  const overlay = document.getElementById("profile-onboarding");
  overlay?.classList.add("profile-onboarding--edit-open");
  document.getElementById("profile-cancel-btn")?.classList.remove("hidden");
  const titleEl = document.getElementById("profile-onboarding-title");
  if (titleEl) titleEl.textContent = "Edit your profile";
  const saveBtn = document.getElementById("profile-save-btn");
  if (saveBtn) saveBtn.textContent = "Save";
  setProfileAriaStates();
}

function closeProfileEditor() {
  populateProfileForm();
  document.getElementById("profile-onboarding")?.classList.remove("profile-onboarding--edit-open");
  document.getElementById("profile-cancel-btn")?.classList.add("hidden");
  setProfileAriaStates();
}

async function handleProfileFormSubmit(ev) {
  ev.preventDefault();
  const form = document.getElementById("profile-setup-form");
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
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
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
  const board = document.getElementById("kanban-board");
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
      <button type="button" class="card-btn card-btn--email" data-lead-id="${lead.id}" title="Generate email">✉️ Generate Email</button>
      <button type="button" class="card-btn card-btn--icon" data-action="edit" data-lead-id="${lead.id}" title="Edit lead">✏️</button>
      <button type="button" class="card-btn card-btn--icon card-btn--danger" data-action="delete" data-lead-id="${lead.id}" title="Delete">🗑️</button>
    </div>
  `;

  // Drag start/end on card
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

  const modal = document.getElementById("relationship-modal");
  const textarea = document.getElementById("notes-textarea");
  const saveStatus = document.getElementById("notes-save-status");
  const researchPanel = document.getElementById("research-panel");
  const researchEmpty = document.getElementById("research-empty");
  const timeline = document.getElementById("timeline-list");

  if (!modal || !textarea) return;

  // Header
  document.getElementById("rel-company").textContent = lead.company_name;
  document.getElementById("rel-contact").textContent = lead.contact_name;
  document.getElementById("rel-stage").textContent = lead.stage;
  document.getElementById("rel-stage").className = "badge badge--stage";
  document.getElementById("rel-email").textContent = lead.email;
  document.getElementById("rel-email").href = `mailto:${lead.email}`;
  document.getElementById("rel-created").textContent = formatFullDate(lead.created_at);
  document.getElementById("rel-updated").textContent = formatFullDate(lead.updated_at);

  // Notes
  textarea.value = lead.notes || "";
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  if (saveStatus) saveStatus.textContent = "";

  // Research
  researchPanel.classList.add("hidden");
  researchEmpty?.classList.remove("hidden");
  document.getElementById("research-content").innerHTML = "";
  document.getElementById("research-content").dataset.researchText = "";

  // Timeline placeholder
  if (timeline) {
    timeline.innerHTML = `
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Lead created</strong><br/><small>${formatFullDate(lead.created_at)}</small></div>
      </li>
      ${lead.updated_at !== lead.created_at ? `
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

  // Edit button in header
  const editBtn = document.getElementById("rel-edit-btn");
  if (editBtn) editBtn.dataset.leadId = lead.id;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeRelationshipModal() {
  // Flush any pending auto-save
  flushAutoSave();

  const modal = document.getElementById("relationship-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  currentLeadId = null;
  currentLeadData = null;
}

// ── Auto-save ──────────────────────────────────────────
function debouncedSaveNotes() {
  if (saveTimer) clearTimeout(saveTimer);
  const status = document.getElementById("notes-save-status");
  if (status) { status.textContent = "Saving…"; status.className = "save-status save-status--saving"; }
  saveTimer = setTimeout(() => flushAutoSave(), 800);
}

async function flushAutoSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!currentLeadId) return;

  const textarea = document.getElementById("notes-textarea");
  if (!textarea) return;

  const content = textarea.value;
  const status = document.getElementById("notes-save-status");

  try {
    await fetchJson(`/api/leads/${currentLeadId}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
    if (status) { status.textContent = "Saved"; status.className = "save-status save-status--saved"; }
    // Update local data
    if (currentLeadData) currentLeadData.notes = content;
    await loadLeads();
  } catch (err) {
    console.error("Auto-save failed:", err);
    if (status) { status.textContent = "Save failed"; status.className = "save-status save-status--error"; }
  }
}

// Auto-resize textarea
function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// ── Research ───────────────────────────────────────────
async function handleResearch() {
  if (!currentLeadId) return;
  const uc = getUserContextForApi();
  if (!uc) { alert("Please complete your profile before using AI research."); return; }

  const btn = document.getElementById("run-research-btn");
  const empty = document.getElementById("research-empty");
  const panel = document.getElementById("research-panel");
  const content = document.getElementById("research-content");

  if (btn) { btn.disabled = true; btn.textContent = "Researching…"; }
  if (empty) empty.classList.add("hidden");

  try {
    const result = await fetchJson(`/api/leads/${currentLeadId}/research`, {
      method: "POST",
      body: JSON.stringify({ user_context: uc }),
    });
    panel.classList.remove("hidden");
    content.innerHTML = parseResearchOutput(result.research);
    content.dataset.researchText = result.research;
  } catch (err) { alert(err.message); if (empty) empty.classList.remove("hidden"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Run Research"; } }
}

function parseResearchOutput(text) {
  const sections = { whatTheyDo: "", contactRole: "", painPoints: [], talkingPoints: [] };
  let currentSection = null;

  text.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("• What they do:")) { sections.whatTheyDo = trimmed.replace(/^•\s*What they do:\s*/, ""); currentSection = "whatTheyDo"; }
    else if (trimmed.startsWith("• Contact's role:")) { sections.contactRole = trimmed.replace(/^•\s*Contact's role:\s*/, ""); currentSection = "contactRole"; }
    else if (trimmed.startsWith("• Their likely pain points:")) { currentSection = "painPoints"; }
    else if (trimmed.startsWith("• Talking points:")) { currentSection = "talkingPoints"; }
    else if (trimmed.startsWith("- ") && currentSection === "painPoints") { sections.painPoints.push(trimmed.substring(2)); }
    else if (trimmed.startsWith("- ") && currentSection === "talkingPoints") { sections.talkingPoints.push(trimmed.substring(2)); }
  });

  let html = "";
  if (sections.whatTheyDo) html += `<h4>What they do</h4><p>${escapeHtml(sections.whatTheyDo)}</p>`;
  if (sections.contactRole) html += `<h4>Contact's role</h4><p>${escapeHtml(sections.contactRole)}</p>`;
  if (sections.painPoints.length > 0) html += `<h4>Pain points</h4><ul>${sections.painPoints.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`;
  if (sections.talkingPoints.length > 0) html += `<h4>Talking points</h4><ul>${sections.talkingPoints.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
  return html || `<p>${escapeHtml(text)}</p>`;
}

// ── Email Modal ────────────────────────────────────────
function openEmailModal(draft) {
  const modal = document.getElementById("email-modal");
  const output = document.getElementById("email-draft-output");
  if (!modal || !output) return;
  output.value = draft || "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEmailModal() {
  const modal = document.getElementById("email-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  const output = document.getElementById("email-draft-output");
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
  const modal = document.getElementById("edit-lead-modal");
  if (!modal) return;
  document.getElementById("edit_company_name").value = lead.company_name || "";
  document.getElementById("edit_contact_name").value = lead.contact_name || "";
  document.getElementById("edit_email").value = lead.email || "";
  populateStageDropdowns(lead.stage);
  modal.dataset.leadId = lead.id;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeEditLeadModal() {
  const modal = document.getElementById("edit-lead-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function handleEditLeadSubmit(event) {
  event.preventDefault();
  const modal = document.getElementById("edit-lead-modal");
  const leadId = modal.dataset.leadId;
  if (!leadId) return;
  const payload = {
    company_name: document.getElementById("edit_company_name").value.trim(),
    contact_name: document.getElementById("edit_contact_name").value.trim(),
    email: document.getElementById("edit_email").value.trim(),
    stage: document.getElementById("edit_stage").value,
  };
  try {
    await fetchJson(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(payload) });
    closeEditLeadModal();
    // If relationship modal is open, close it to refresh
    closeRelationshipModal();
    await loadLeads();
  } catch (err) { alert(err.message); }
}

// ── Add Lead Modal ─────────────────────────────────────
function openAddLeadModal(preselectedStage) {
  const modal = document.getElementById("add-lead-modal");
  if (!modal) return;
  populateStageDropdowns(preselectedStage);
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeAddLeadModal() {
  const modal = document.getElementById("add-lead-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("add-lead-form")?.reset();
}

// ── Stage Settings ─────────────────────────────────────
function openStageSettings() {
  const modal = document.getElementById("stage-settings-modal");
  if (!modal) return;
  if (!stageSettingsInitialized) {
    renderStageSettingsList();
    stageSettingsInitialized = true;
  }
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeStageSettings() {
  const modal = document.getElementById("stage-settings-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function renderStageSettingsList() {
  const list = document.getElementById("stages-list");
  if (!list) return;

  const newList = list.cloneNode(false);
  list.parentNode.replaceChild(newList, list);

  fetchJson("/api/leads").then(leads => {
    const counts = {};
    leads.forEach(lead => { counts[lead.stage] = (counts[lead.stage] || 0) + 1; });

    stages.forEach((stage, index) => {
      const li = document.createElement("li");
      li.className = "stage-item";
      li.dataset.stageId = stage.id;
      li.draggable = true;

      const color = getStageColor(index);
      const leadCount = counts[stage.name] || 0;
      const canDelete = leadCount === 0;

      li.innerHTML = `
        <span class="stage-item__handle" title="Drag to reorder">⋮⋮</span>
        <span class="stage-item__dot" style="background:${color}"></span>
        <input type="text" class="stage-item__input" value="${escapeHtml(stage.name)}" data-stage-id="${stage.id}" />
        <span class="stage-item__count">${leadCount} lead${leadCount !== 1 ? "s" : ""}</span>
        <button type="button" class="stage-item__delete" data-stage-id="${stage.id}" ${!canDelete ? "disabled" : ""} title="${canDelete ? "Delete stage" : "Move leads first"}">🗑️</button>
      `;

      const input = li.querySelector(".stage-item__input");
      input.addEventListener("blur", () => {
        const newName = input.value.trim();
        if (newName && newName !== stage.name) handleRenameStage(stage.id, newName);
        else input.value = stage.name;
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

      li.querySelector(".stage-item__delete").addEventListener("click", () => {
        if (canDelete) handleDeleteStage(stage.id);
      });

      // Stage drag with drop indicator
      li.addEventListener("dragstart", (e) => {
        li.classList.add("stage-item--dragging");
        e.dataTransfer.setData("text/stage-id", String(stage.id));
        e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("stage-item--dragging");
        newList.querySelectorAll(".stage-item--over").forEach(el => el.classList.remove("stage-item--over"));
        // Commit reorder
        const items = newList.querySelectorAll(".stage-item");
        const order = Array.from(items).map(item => parseInt(item.dataset.stageId));
        handleReorderStages(order);
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const dragging = newList.querySelector(".stage-item--dragging");
        if (!dragging || dragging === li) return;
        newList.querySelectorAll(".stage-item--over").forEach(el => el.classList.remove("stage-item--over"));
        li.classList.add("stage-item--over");
        const rect = li.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          newList.insertBefore(dragging, li);
        } else {
          newList.insertBefore(dragging, li.nextSibling);
        }
      });
      li.addEventListener("dragleave", () => {
        li.classList.remove("stage-item--over");
      });

      newList.appendChild(li);
    });
  }).catch(err => console.error("Failed to load leads for stage settings:", err));
}

async function handleAddStageFormSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("new-stage-name");
  const name = input.value.trim();
  if (name) {
    await handleAddStage(name);
    input.value = "";
  }
}

// ── Global event delegation ────────────────────────────
function initGlobalDelegation() {
  const board = document.getElementById("kanban-board");
  if (!board) return;

  // Click delegation (only set up once)
  board.addEventListener("click", async (e) => {
    // --- Add Lead button ---
    const addBtn = e.target.closest(".add-lead-btn") || e.target.closest(".add-lead-area");
    if (addBtn) {
      e.preventDefault();
      const stage = addBtn.closest(".kanban-column")?.dataset.stage || addBtn.dataset.stage;
      openAddLeadModal(stage);
      return;
    }

    // --- Lead card click → open relationship modal ---
    const card = e.target.closest(".lead-card");
    if (card) {
      // Don't open modal if clicking a button inside the card
      if (e.target.closest("button") || e.target.closest("a")) return;
      e.preventDefault();
      try {
        const lead = await fetchJson(`/api/leads/${card.dataset.leadId}`);
        openRelationshipModal(lead);
      } catch (err) { alert(err.message); }
      return;
    }

    // --- Generate Email button ---
    const emailBtn = e.target.closest(".card-btn--email");
    if (emailBtn) {
      handleGenerateEmail(e, emailBtn.dataset.leadId);
      return;
    }

    // --- Edit button ---
    const editBtn = e.target.closest("[data-action='edit']");
    if (editBtn) {
      e.stopPropagation();
      try {
        const lead = await fetchJson(`/api/leads/${editBtn.dataset.leadId}`);
        openEditLeadModal(lead);
      } catch (err) { alert(err.message); }
      return;
    }

    // --- Delete button ---
    const delBtn = e.target.closest("[data-action='delete']");
    if (delBtn) {
      e.stopPropagation();
      handleDeleteClick(delBtn);
      return;
    }
  });

  // Drag-and-drop delegation on the board
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
  document.getElementById("profile-setup-form")?.addEventListener("submit", (ev) => { void handleProfileFormSubmit(ev); });
  document.getElementById("profile-cancel-btn")?.addEventListener("click", closeProfileEditor);
  document.getElementById("open-profile-setup")?.addEventListener("click", openProfileEditorFromHeader);
  document.getElementById("profile-onboarding")?.addEventListener("click", (ev) => {
    if (ev.target !== ev.currentTarget) return;
    if (document.documentElement.classList.contains("profile-ready")) closeProfileEditor();
  });

  // Add Lead modal
  document.getElementById("open-add-lead-modal")?.addEventListener("click", () => openAddLeadModal());
  document.getElementById("close-add-lead-modal")?.addEventListener("click", closeAddLeadModal);
  document.getElementById("cancel-add-lead")?.addEventListener("click", closeAddLeadModal);
  document.getElementById("add-lead-form")?.addEventListener("submit", handleAddLeadSubmit);

  // Edit Lead modal
  document.getElementById("close-edit-lead-modal")?.addEventListener("click", closeEditLeadModal);
  document.getElementById("edit-lead-form")?.addEventListener("submit", handleEditLeadSubmit);

  // Relationship modal
  document.getElementById("close-relationship-modal")?.addEventListener("click", closeRelationshipModal);
  document.getElementById("rel-edit-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (currentLeadId) {
      try {
        const lead = await fetchJson(`/api/leads/${currentLeadId}`);
        openEditLeadModal(lead);
      } catch (err) { alert(err.message); }
    }
  });
  document.getElementById("run-research-btn")?.addEventListener("click", handleResearch);

  // Notes auto-save
  const notesTextarea = document.getElementById("notes-textarea");
  if (notesTextarea) {
    notesTextarea.addEventListener("input", () => {
      autoResizeTextarea(notesTextarea);
      debouncedSaveNotes();
    });
  }

  // Stage Settings
  document.getElementById("open-stage-settings")?.addEventListener("click", openStageSettings);
  document.getElementById("close-stage-settings")?.addEventListener("click", closeStageSettings);
  document.getElementById("add-stage-form")?.addEventListener("submit", handleAddStageFormSubmit);

  // Email modal
  document.getElementById("close-email-modal")?.addEventListener("click", closeEmailModal);

  // Backdrop dismiss
  document.querySelectorAll("[data-modal-dismiss]").forEach(el => {
    el.addEventListener("click", dismissAllModals);
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlay = document.getElementById("profile-onboarding");
    if (overlay?.classList.contains("profile-onboarding--edit-open")) { closeProfileEditor(); e.preventDefault(); return; }
    dismissAllModals();
  });

  // Init
  if (document.documentElement.classList.contains("profile-ready")) {
    void loadAllData();
  }
});