/**
 * Sales Pipeline Tracker - Dynamic Stages Edition
 * Handles stages, leads, notes, research, and AI email generation.
 */

const PROFILE_STORAGE_KEY = "pipelineUserProfile";

// Application state
let stages = [];
let currentNotesLeadId = null;
let currentNotesLeadData = null;
let stageSettingsInitialized = false;

// Stage colors for card borders
const STAGE_COLORS = [
  "#64748b", "#0d9488", "#d97706", "#7c3aed", "#059669",
];

function getStageColor(position) {
  return STAGE_COLORS[position % STAGE_COLORS.length];
}

// Profile functions
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
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch { return null; }
}

function saveUserProfile(profile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function isProfileComplete(profile) {
  return !!(profile && profile.userName && profile.jobTitle && profile.companyName && profile.selling);
}

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
  const fields = { profile_user_name: "userName", profile_job_title: "jobTitle", profile_company_name: "companyName", profile_selling: "selling" };
  Object.entries(fields).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.value = p?.[key] || "";
  });
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
  const profile = {
    userName: form.userName.value.trim(),
    jobTitle: form.jobTitle.value.trim(),
    companyName: form.companyName.value.trim(),
    selling: form.selling.value.trim(),
  };
  if (!isProfileComplete(profile)) { alert("Please fill in all fields."); return; }
  saveUserProfile(profile);
  document.documentElement.classList.add("profile-ready");
  closeProfileEditor();
  await loadAllData();
}

// API helper
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
  return data;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

// Stages management
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
    await loadLeads(); // Fix Bug 2: load leads after building board
    populateStageDropdowns();
    renderStageSettingsList(); // Use separate render function
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
    order.forEach((stageId, position) => {
      const stage = stages.find(s => s.id === stageId);
      if (stage) stage.position = position;
    });
    await buildBoard();
    await loadLeads();
    renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

function populateStageDropdowns(preselectedStage) {
  const selects = document.querySelectorAll("select[name='stage']");
  selects.forEach(select => {
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

// Board rendering
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
        <span class="column-count" data-stage="${escapeHtml(stage.name)}" aria-live="polite">0</span>
      </div>
      <div class="lead-list" id="stage-${index}" data-stage="${escapeHtml(stage.name)}"></div>
      <button type="button" class="add-lead-inline-btn" data-stage="${escapeHtml(stage.name)}" title="Add lead to ${escapeHtml(stage.name)}">+</button>
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

// Fix Bug 3: Make entire card draggable
function createLeadCard(lead, stagePosition) {
  const article = document.createElement("article");
  article.className = "lead-card";
  article.dataset.leadId = String(lead.id);
  article.dataset.stage = lead.stage;
  article.draggable = true; // Make entire card draggable

  const color = getStageColor(stagePosition);
  article.style.borderLeftColor = color;

  const updatedDate = lead.updated_at ? formatDate(lead.updated_at) : "";

  article.innerHTML = `
    <div class="lead-card__head">
      <h4>${escapeHtml(lead.company_name)}</h4>
    </div>
    <p>${escapeHtml(lead.contact_name)}</p>
    <p><a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a></p>
    ${updatedDate ? `<p class="lead-card__updated">Updated ${updatedDate}</p>` : ""}
    <div class="card-actions">
      <button type="button" class="notes-btn" data-lead-id="${lead.id}" title="Notes">Notes</button>
      <button type="button" class="email-btn" data-lead-id="${lead.id}" title="Generate email">Generate Email</button>
      <button type="button" class="edit-btn" data-lead-id="${lead.id}" title="Edit lead">✏️</button>
      <button type="button" class="delete-btn" data-lead-id="${lead.id}" title="Delete">🗑️</button>
    </div>
  `;

  // Card drag handlers
  article.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(lead.id));
    e.dataTransfer.effectAllowed = "move";
    article.classList.add("lead-card--dragging");
  });

  article.addEventListener("dragend", () => {
    article.classList.remove("lead-card--dragging");
    document.querySelectorAll(".kanban-column").forEach(col => {
      col.classList.remove("column--drag-over");
    });
  });

  return article;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diff = Date.now() - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// Lead operations
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
  initKanbanDragAndDrop(); // Re-init after board rebuild
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

async function handleStageChange(select) {
  const leadId = select.dataset.leadId;
  const newStage = select.value;
  select.disabled = true;
  try {
    await fetchJson(`/api/leads/${leadId}/stage`, { method: "PATCH", body: JSON.stringify({ stage: newStage }) });
    await loadLeads();
  } catch (err) {
    alert(err.message);
    select.value = currentNotesLeadData?.stage || stages[0]?.name;
  } finally { select.disabled = false; }
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

// Fix Bug 4: Auto-save notes on close
async function autoSaveNotes() {
  if (!currentNotesLeadId) return;
  const textarea = document.getElementById("notes-textarea");
  if (!textarea) return;
  const content = textarea.value;

  // Check if research was generated and append it
  const researchOutput = document.getElementById("research-output");
  let finalContent = content;
  if (researchOutput && !researchOutput.classList.contains("hidden") && researchOutput.dataset.researchText) {
    const researchText = researchOutput.dataset.researchText;
    if (content && !content.includes(researchText)) {
      finalContent = content + "\n\n---\n\n" + researchText;
    } else if (!content) {
      finalContent = researchText;
    }
  }

  try {
    await fetchJson(`/api/leads/${currentNotesLeadId}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ content: finalContent }),
    });
    await loadLeads();
  } catch (err) {
    console.error("Auto-save failed:", err);
  }
}

// Notes modal
function openNotesModal(lead) {
  currentNotesLeadId = lead.id;
  currentNotesLeadData = lead;

  const modal = document.getElementById("notes-modal");
  const leadInfo = document.getElementById("notes-modal-lead-info");
  const textarea = document.getElementById("notes-textarea");
  const researchOutput = document.getElementById("research-output");

  if (!modal || !leadInfo || !textarea) return;

  leadInfo.innerHTML = `
    <p><strong>${escapeHtml(lead.company_name)}</strong> — ${escapeHtml(lead.contact_name)}</p>
    <p style="color: var(--text-secondary); font-size: 0.8rem;">Stage: ${escapeHtml(lead.stage)}</p>
  `;

  textarea.value = lead.notes || "";
  researchOutput.classList.add("hidden");
  researchOutput.innerHTML = "";
  researchOutput.dataset.researchText = "";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeNotesModal() {
  // Auto-save before closing
  void autoSaveNotes();

  const modal = document.getElementById("notes-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  currentNotesLeadId = null;
  currentNotesLeadData = null;
}

async function handleResearch() {
  if (!currentNotesLeadId) return;
  const uc = getUserContextForApi();
  if (!uc) { alert("Please complete your profile before using AI research."); return; }

  const btn = document.getElementById("run-research-btn");
  const output = document.getElementById("research-output");

  if (btn) { btn.disabled = true; btn.textContent = "Researching…"; }

  try {
    const result = await fetchJson(`/api/leads/${currentNotesLeadId}/research`, {
      method: "POST",
      body: JSON.stringify({ user_context: uc }),
    });

    output.classList.remove("hidden");
    output.innerHTML = parseResearchOutput(result.research);
    output.dataset.researchText = result.research;

  } catch (err) { alert(err.message); }
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

// Email modal
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

async function handleGenerateEmail(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Generating…";
  try {
    const genBody = {};
    const uc = getUserContextForApi();
    if (uc) genBody.user_context = uc;
    const result = await fetchJson(`/api/leads/${leadId}/generate-follow-up`, { method: "POST", body: JSON.stringify(genBody) });
    openEmailModal(result.draft || "");
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; button.textContent = original; }
}

// Edit lead modal
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
    await loadLeads();
  } catch (err) { alert(err.message); }
}

// Add Lead Modal
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

// Stage Settings - Fix Bug 1: Only render once, don't re-attach listeners
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

  // Remove old event listener
  const newList = list.cloneNode(false);
  list.parentNode.replaceChild(newList, list);

  // Get lead counts
  fetchJson("/api/leads").then(leads => {
    const counts = {};
    leads.forEach(lead => { counts[lead.stage] = (counts[lead.stage] || 0) + 1; });

    stages.forEach((stage, index) => {
      const li = document.createElement("li");
      li.dataset.stageId = stage.id;
      li.draggable = true;

      const color = getStageColor(index);
      const leadCount = counts[stage.name] || 0;
      const canDelete = leadCount === 0;

      li.innerHTML = `
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <span class="stage-color-dot" style="background: ${color}"></span>
        <input type="text" class="stage-name-input" value="${escapeHtml(stage.name)}" data-stage-id="${stage.id}" />
        <span class="stage-lead-count">${leadCount} lead${leadCount !== 1 ? "s" : ""}</span>
        <button type="button" class="stage-delete-btn" data-stage-id="${stage.id}" ${!canDelete ? "disabled" : ""} title="${canDelete ? "Delete stage" : "Move leads first"}">🗑️</button>
      `;

      // Rename on blur
      const input = li.querySelector(".stage-name-input");
      input.addEventListener("blur", () => {
        const newName = input.value.trim();
        if (newName && newName !== stage.name) handleRenameStage(stage.id, newName);
        else input.value = stage.name;
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });

      // Delete
      li.querySelector(".stage-delete-btn").addEventListener("click", () => {
        if (canDelete) handleDeleteStage(stage.id);
      });

      // Drag
      li.addEventListener("dragstart", (e) => {
        li.classList.add("dragging");
        e.dataTransfer.setData("text/plain", String(stage.id));
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = newList.querySelector(".dragging");
        if (dragging && dragging !== li) newList.insertBefore(dragging, li);
      });

      newList.appendChild(li);
    });

    // Single drop handler
    newList.addEventListener("dragend", async () => {
      const items = newList.querySelectorAll("li");
      const order = Array.from(items).map(li => parseInt(li.dataset.stageId));
      await handleReorderStages(order);
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

// Kanban drag and drop
function initKanbanDragAndDrop() {
  document.querySelectorAll(".kanban-column").forEach(column => {
    column.addEventListener("dragenter", (e) => { e.preventDefault(); column.classList.add("column--drag-over"); });
    column.addEventListener("dragleave", (e) => { if (!column.contains(e.relatedTarget)) column.classList.remove("column--drag-over"); });
    column.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
    column.addEventListener("drop", async (e) => {
      e.preventDefault();
      column.classList.remove("column--drag-over");
      const leadId = e.dataTransfer.getData("text/plain");
      if (!leadId) return;
      const newStage = column.dataset.stage;
      if (!newStage) return;
      try {
        await fetchJson(`/api/leads/${leadId}/stage`, { method: "PATCH", body: JSON.stringify({ stage: newStage }) });
        await loadLeads();
      } catch (err) { alert(err.message); }
    });
  });
}

function dismissAllModals() {
  closeEmailModal();
  closeNotesModal();
  closeAddLeadModal();
  closeStageSettings();
  closeEditLeadModal();
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  populateProfileForm();
  setProfileAriaStates();

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

  // Stage Settings
  document.getElementById("open-stage-settings")?.addEventListener("click", openStageSettings);
  document.getElementById("close-stage-settings")?.addEventListener("click", closeStageSettings);
  document.getElementById("add-stage-form")?.addEventListener("submit", handleAddStageFormSubmit);

  // Board
  const board = document.getElementById("kanban-board");
  if (board) {
    board.addEventListener("click", (e) => {
      // Add lead inline button
      const addBtn = e.target.closest(".add-lead-inline-btn");
      if (addBtn) {
        e.preventDefault();
        openAddLeadModal(addBtn.dataset.stage);
        return;
      }

      const notesBtn = e.target.closest(".notes-btn");
      if (notesBtn) {
        e.preventDefault();
        fetchJson(`/api/leads/${notesBtn.dataset.leadId}`).then(lead => openNotesModal(lead)).catch(err => alert(err.message));
        return;
      }

      const emailBtn = e.target.closest(".email-btn");
      if (emailBtn) { e.preventDefault(); handleGenerateEmail(emailBtn); return; }

      const editBtn = e.target.closest(".edit-btn");
      if (editBtn) {
        e.preventDefault();
        fetchJson(`/api/leads/${editBtn.dataset.leadId}`).then(lead => openEditLeadModal(lead)).catch(err => alert(err.message));
        return;
      }

      const delBtn = e.target.closest(".delete-btn");
      if (delBtn) { e.preventDefault(); handleDeleteClick(delBtn); }
    });
  }

  // Notes modal
  document.getElementById("close-notes-modal")?.addEventListener("click", closeNotesModal);
  document.getElementById("run-research-btn")?.addEventListener("click", handleResearch);

  // Email modal
  document.getElementById("close-email-modal")?.addEventListener("click", closeEmailModal);

  // Modal backdrop dismiss
  document.querySelectorAll("[data-modal-dismiss]").forEach(el => { el.addEventListener("click", dismissAllModals); });

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