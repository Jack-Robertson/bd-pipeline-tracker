/**
 * Pipeline — Relationship Workspace
 * Refined: universal profile, email in workspace, persisted research, cleaner cards.
 */

const PROFILE_STORAGE_KEY = "pipelineUserProfile";

// ── State ──────────────────────────────────────────────
let stages = [];
let currentLeadId = null;
let currentLeadData = null;
let saveTimer = null;

const STAGE_COLORS = ["#64748b", "#0d9488", "#d97706", "#7c3aed", "#059669"];
function getStageColor(pos) { return STAGE_COLORS[pos % STAGE_COLORS.length]; }

function $id(id) { return document.getElementById(id); }

// ── Profile (universal identity model) ─────────────────
function normalizeProfile(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    fullName: String(obj.fullName || obj.userName || "").trim(),
    roleTitle: String(obj.roleTitle || obj.jobTitle || "").trim(),
    organization: String(obj.organization || obj.companyName || "").trim(),
    location: String(obj.location || "").trim(),
    about: String(obj.about || obj.selling || "").trim(),
    goals: String(obj.goals || "").trim(),
    interests: String(obj.interests || "").trim(),
    communicationStyle: String(obj.communicationStyle || "").trim(),
  };
}

function loadUserProfile() {
  try { const raw = localStorage.getItem(PROFILE_STORAGE_KEY); return raw ? normalizeProfile(JSON.parse(raw)) : null; }
  catch { return null; }
}
function saveUserProfile(p) { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p)); }
function isProfileComplete(p) { return !!(p && p.fullName); }

function getUserContextForApi() {
  const p = loadUserProfile();
  if (!isProfileComplete(p)) return null;
  return {
    user_name: p.fullName,
    full_name: p.fullName,
    role_title: p.roleTitle,
    organization: p.organization,
    location: p.location,
    about: p.about,
    goals: p.goals,
    interests: p.interests,
    communication_style: p.communicationStyle,
  };
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
  const map = {
    profile_full_name: "fullName", profile_role_title: "roleTitle",
    profile_organization: "organization", profile_location: "location",
    profile_about: "about", profile_goals: "goals",
    profile_interests: "interests", profile_style: "communicationStyle",
  };
  Object.entries(map).forEach(([id, key]) => { const el = $id(id); if (el) el.value = p?.[key] || ""; });
}

function openProfileEditorFromHeader() {
  populateProfileForm();
  const overlay = $id("profile-onboarding");
  overlay?.classList.add("profile-onboarding--edit-open");
  $id("profile-cancel-btn")?.classList.remove("hidden");
  const titleEl = $id("profile-onboarding-title");
  if (titleEl) titleEl.textContent = "Edit Your Profile";
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
  const profile = {
    fullName: form.fullName?.value?.trim() || "",
    roleTitle: form.roleTitle?.value?.trim() || "",
    organization: form.organization?.value?.trim() || "",
    location: form.location?.value?.trim() || "",
    about: form.about?.value?.trim() || "",
    goals: form.goals?.value?.trim() || "",
    interests: form.interests?.value?.trim() || "",
    communicationStyle: form.communicationStyle?.value || "",
  };
  if (!profile.fullName) { alert("Please enter your name."); return; }
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
  if (m < 1) return "moments ago";
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
  catch (err) { console.error(err); stages = []; }
}
async function handleAddStage(name) {
  if (!name || !name.trim()) return;
  try {
    const s = await fetchJson("/api/stages", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    stages.push(s);
    await buildBoard(); await loadLeads();
    populateStageDropdowns(); renderStageSettingsList();
  } catch (err) { alert(err.message); }
}
async function handleRenameStage(stageId, newName) {
  if (!newName || !newName.trim()) return;
  try {
    await fetchJson(`/api/stages/${stageId}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) });
    const s = stages.find(x => x.id === stageId);
    if (s) s.name = newName.trim();
    await buildBoard(); await loadLeads(); populateStageDropdowns();
  } catch (err) { alert(err.message); }
}
async function handleDeleteStage(stageId) {
  try {
    await fetchJson(`/api/stages/${stageId}`, { method: "DELETE" });
    stages = stages.filter(s => s.id !== stageId);
    await buildBoard(); await loadLeads(); populateStageDropdowns(); renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

function populateStageDropdowns(preselectedStage) {
  document.querySelectorAll("select[name='stage']").forEach(select => {
    const currentValue = preselectedStage || select.value;
    select.innerHTML = "";
    stages.forEach(stage => {
      const option = document.createElement("option");
      option.value = stage.name; option.textContent = stage.name;
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
  leads.forEach(lead => { if (!leadsByStage[lead.stage]) leadsByStage[lead.stage] = []; leadsByStage[lead.stage].push(lead); });
  stages.forEach((stage, index) => {
    const list = document.getElementById(`stage-${index}`);
    const column = list?.closest(".kanban-column");
    const columnLeads = leadsByStage[stage.name] || [];
    const countBadge = column?.querySelector(".column-count");
    if (countBadge) countBadge.textContent = columnLeads.length;
    if (column) column.classList.toggle("kanban-column--empty", columnLeads.length === 0);
    columnLeads.forEach(lead => { list.appendChild(createLeadCard(lead, index)); });
  });
}

function createLeadCard(lead, stagePosition) {
  const article = document.createElement("article");
  article.className = "lead-card";
  article.dataset.leadId = String(lead.id);
  article.dataset.stage = lead.stage;
  article.draggable = true;
  article.style.setProperty("--card-accent", getStageColor(stagePosition));
  const lastActivity = lead.updated_at ? formatDate(lead.updated_at) : "";

  article.innerHTML = `
    <div class="lead-card__body">
      <h4 class="lead-card__company">${escapeHtml(lead.company_name)}</h4>
      <p class="lead-card__contact">${escapeHtml(lead.contact_name)}</p>
      <a class="lead-card__email" href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>
      ${lastActivity ? `<span class="lead-card__activity">${lastActivity}</span>` : ""}
    </div>
    <div class="lead-card__actions">
      <button type="button" class="card-btn card-btn--icon card-btn--danger" data-action="delete" data-lead-id="${lead.id}" title="Delete">🗑️</button>
    </div>
  `;

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
  try { const leads = await fetchJson("/api/leads"); renderLeads(leads); }
  catch (err) { console.error(err); alert(err.message); }
}
async function loadAllData() {
  await loadStages(); buildBoard(); populateStageDropdowns(); await loadLeads();
}
async function handleAddLeadSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    company_name: form.company_name.value.trim(), contact_name: form.contact_name.value.trim(),
    email: form.email.value.trim(), notes: form.notes.value.trim(), stage: form.stage.value,
  };
  try { await fetchJson("/api/leads", { method: "POST", body: JSON.stringify(payload) }); form.reset(); closeAddLeadModal(); await loadLeads(); }
  catch (err) { alert(err.message); }
}
async function handleDeleteClick(button) {
  const leadId = button.dataset.leadId;
  if (!leadId) return;
  if (!confirm("Delete this lead?")) return;
  button.disabled = true;
  try { await fetchJson(`/api/leads/${leadId}`, { method: "DELETE" }); await loadLeads(); }
  catch (err) { alert(err.message); }
  finally { button.disabled = false; }
}

// ── Relationship Workspace Modal ───────────────────────
function openRelationshipModal(lead) {
  currentLeadId = lead.id;
  currentLeadData = lead;

  const modal = $id("relationship-modal");
  const textarea = $id("notes-textarea");
  if (!modal || !textarea) return;

  // Header
  const elCompany = $id("rel-company"), elContact = $id("rel-contact"), elStage = $id("rel-stage"),
        elEmail = $id("rel-email");
  if (elCompany) elCompany.textContent = lead.company_name;
  if (elContact) elContact.textContent = lead.contact_name;
  if (elStage) { elStage.textContent = lead.stage; elStage.className = "badge badge--stage"; }
  if (elEmail) { elEmail.textContent = lead.email; elEmail.href = `mailto:${lead.email}`; }

  // Notes
  textarea.value = lead.notes || "";
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  const saveStatus = $id("notes-save-status");
  if (saveStatus) saveStatus.textContent = "";

  // Research — load persisted if available
  const researchPanel = $id("research-panel"), researchEmpty = $id("research-empty"),
        researchContent = $id("research-content");
  const savedResearch = lead.research || "";
  if (savedResearch) {
    if (researchEmpty) researchEmpty.classList.add("hidden");
    if (researchPanel) researchPanel.classList.remove("hidden");
    if (researchContent) { researchContent.innerHTML = parseResearchOutput(savedResearch); }
  } else {
    if (researchPanel) researchPanel.classList.add("hidden");
    if (researchEmpty) researchEmpty.classList.remove("hidden");
    if (researchContent) researchContent.innerHTML = "";
  }

  // Email — reset
  const emailArea = $id("email-output-area");
  const emailText = $id("email-output-text");
  if (emailArea) emailArea.classList.add("hidden");
  if (emailText) emailText.value = "";

  // Timeline
  const timeline = $id("timeline-list");
  if (timeline) {
    timeline.innerHTML = `
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Lead created</strong><br/><small>${formatFullDate(lead.created_at)}</small></div>
      </li>
      <li class="timeline-item">
        <span class="timeline-dot"></span>
        <div><strong>Current stage</strong><br/><small>${escapeHtml(lead.stage)}</small></div>
      </li>
      <li class="timeline-item">
        <span class="timeline-dot timeline-dot--activity"></span>
        <div><strong>Last activity</strong><br/><small>${lead.updated_at ? formatDate(lead.updated_at) : "—"}</small></div>
      </li>
    `;
  }

  const editBtn = $id("rel-edit-btn");
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
function autoResizeTextarea(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }

// ── Research ───────────────────────────────────────────
async function handleResearch() {
  if (!currentLeadId) return;
  const uc = getUserContextForApi();
  if (!uc) { alert("Please complete your profile first."); return; }
  const btn = $id("run-research-btn"), empty = $id("research-empty"),
        panel = $id("research-panel"), content = $id("research-content");
  if (btn) { btn.disabled = true; btn.textContent = "Researching…"; }
  if (empty) empty.classList.add("hidden");
  try {
    const result = await fetchJson(`/api/leads/${currentLeadId}/research`, { method: "POST", body: JSON.stringify({ user_context: uc }) });
    if (panel) panel.classList.remove("hidden");
    if (content) content.innerHTML = parseResearchOutput(result.research);
    if (currentLeadData) currentLeadData.research = result.research;
  } catch (err) { alert(err.message); if (empty) empty.classList.remove("hidden"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Run Research"; } }
}

function parseResearchOutput(text) {
  const sections = { overview: "", contact: "", opportunities: [], angles: [], notable: "" };
  let cur = null;
  text.split("\n").forEach(line => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith("── COMPANY OVERVIEW") || t.startsWith("• What they do:")) {
      cur = "overview";
    } else if (t.startsWith("── CONTACT CONTEXT") || t.startsWith("• Contact's role:")) {
      cur = "contact";
    } else if (t.startsWith("── POTENTIAL OPPORTUNITIES") || t.startsWith("• Their likely pain points:")) {
      cur = "opportunities";
    } else if (t.startsWith("── CONVERSATION ANGLES") || t.startsWith("• Talking points:")) {
      cur = "angles";
    } else if (t.startsWith("── NOTABLE CONTEXT")) {
      cur = "notable";
    } else if (cur === "opportunities" && t.startsWith("- ")) {
      sections.opportunities.push(t.substring(2));
    } else if (cur === "angles" && t.startsWith("- ")) {
      sections.angles.push(t.substring(2));
    } else if (cur === "overview" && t.length > 10) {
      sections.overview += (sections.overview ? " " : "") + t;
    } else if (cur === "contact" && t.length > 5) {
      sections.contact += (sections.contact ? " " : "") + t;
    } else if (cur === "notable" && t.length > 5 && t !== "No additional context available.") {
      sections.notable += (sections.notable ? " " : "") + t;
    }
  });
  // Also match old format
  if (!sections.overview) {
    const m = text.match(/•\s*What they do:\s*(.+)/);
    if (m) sections.overview = m[1];
  }
  if (!sections.contact) {
    const m = text.match(/•\s*Contact's role:\s*(.+)/);
    if (m) sections.contact = m[1];
  }

  let html = "";
  if (sections.overview) html += `<h4>Company Overview</h4><p>${escapeHtml(sections.overview)}</p>`;
  if (sections.contact) html += `<h4>Contact Context</h4><p>${escapeHtml(sections.contact)}</p>`;
  if (sections.opportunities.length) html += `<h4>Potential Opportunities</h4><ul>${sections.opportunities.map(o => `<li>${escapeHtml(o)}</li>`).join("")}</ul>`;
  if (sections.angles.length) html += `<h4>Conversation Angles</h4><ul>${sections.angles.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`;
  if (sections.notable) html += `<h4>Notable Context</h4><p>${escapeHtml(sections.notable)}</p>`;
  return html || `<p>${escapeHtml(text)}</p>`;
}

// ── Email Generation (in workspace) ────────────────────
async function handleGenerateEmailInWorkspace() {
  if (!currentLeadId) return;
  const uc = getUserContextForApi();
  if (!uc) { alert("Please complete your profile first."); return; }
  const btn = $id("generate-email-btn"), area = $id("email-output-area"), text = $id("email-output-text");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
  try {
    const result = await fetchJson(`/api/leads/${currentLeadId}/generate-follow-up`, { method: "POST", body: JSON.stringify({ user_context: uc }) });
    if (area) area.classList.remove("hidden");
    if (text) text.value = result.draft || "";
  } catch (err) { alert(err.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Generate Follow-Up"; } }
}

function copyEmailToClipboard() {
  const text = $id("email-output-text");
  if (!text || !text.value) return;
  navigator.clipboard.writeText(text.value).then(() => {
    const btn = $id("copy-email-btn");
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); }
  }).catch(() => alert("Could not copy to clipboard."));
}

// ── Edit Lead ──────────────────────────────────────────
function openEditLeadModal(lead) {
  const modal = $id("edit-lead-modal");
  if (!modal) return;
  const elCo = $id("edit_company_name"), elCt = $id("edit_contact_name"), elEm = $id("edit_email");
  if (elCo) elCo.value = lead.company_name || "";
  if (elCt) elCt.value = lead.contact_name || "";
  if (elEm) elEm.value = lead.email || "";
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
  try { await fetchJson(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(payload) }); closeEditLeadModal(); await loadLeads(); }
  catch (err) { alert(err.message); }
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

// ── Stage Settings (arrows) ────────────────────────────
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
      const color = getStageColor(index), leadCount = counts[stage.name] || 0, canDelete = leadCount === 0;
      const isFirst = index === 0, isLast = index === stages.length - 1;
      li.innerHTML = `
        <span class="stage-item__dot" style="background:${color}"></span>
        <input type="text" class="stage-item__input" value="${escapeHtml(stage.name)}" data-stage-id="${stage.id}" />
        <span class="stage-item__count">${leadCount} lead${leadCount !== 1 ? "s" : ""}</span>
        <div class="stage-item__arrows">
          <button type="button" class="stage-arrow stage-arrow--up" data-stage-id="${stage.id}" title="Move up" ${isFirst ? "disabled" : ""}>▲</button>
          <button type="button" class="stage-arrow stage-arrow--down" data-stage-id="${stage.id}" title="Move down" ${isLast ? "disabled" : ""}>▼</button>
        </div>
        <button type="button" class="stage-item__delete" data-stage-id="${stage.id}" ${!canDelete ? "disabled" : ""} title="${canDelete ? "Delete" : "Move leads first"}">🗑️</button>
      `;
      const input = li.querySelector(".stage-item__input");
      input.addEventListener("blur", () => {
        const newName = input.value.trim();
        if (newName && newName !== stage.name) handleRenameStage(stage.id, newName);
        else input.value = stage.name;
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      li.querySelector(".stage-item__delete").addEventListener("click", () => { if (canDelete) handleDeleteStage(stage.id); });
      li.querySelector(".stage-arrow--up").addEventListener("click", () => { if (index > 0) moveStage(stage.id, index - 1); });
      li.querySelector(".stage-arrow--down").addEventListener("click", () => { if (index < stages.length - 1) moveStage(stage.id, index + 1); });
      list.appendChild(li);
    });
  }).catch(err => console.error(err));
}

async function moveStage(stageId, newIndex) {
  const cur = stages.findIndex(s => s.id === stageId);
  if (cur === -1) return;
  const [moved] = stages.splice(cur, 1);
  stages.splice(newIndex, 0, moved);
  const order = stages.map(s => s.id);
  try {
    await fetchJson("/api/stages/reorder", { method: "POST", body: JSON.stringify({ order }) });
    await buildBoard(); await loadLeads(); renderStageSettingsList();
  } catch (err) { alert(err.message); }
}

async function handleAddStageFormSubmit(event) {
  event.preventDefault();
  const input = $id("new-stage-name");
  if (!input) return;
  const name = input.value.trim();
  if (name) { await handleAddStage(name); input.value = ""; }
}

// ── Global event delegation ────────────────────────────
function initGlobalDelegation() {
  const board = $id("kanban-board");
  if (!board) return;

  board.addEventListener("click", async (e) => {
    // Add Lead button
    const addBtn = e.target.closest(".add-lead-btn") || e.target.closest(".add-lead-area");
    if (addBtn) {
      e.preventDefault();
      const stage = addBtn.closest(".kanban-column")?.dataset.stage || addBtn.dataset.stage;
      openAddLeadModal(stage);
      return;
    }

    // Lead card click → open workspace
    const card = e.target.closest(".lead-card");
    if (card) {
      if (e.target.closest("button") || e.target.closest("a")) return;
      e.preventDefault();
      try { const lead = await fetchJson(`/api/leads/${card.dataset.leadId}`); openRelationshipModal(lead); }
      catch (err) { alert(err.message); }
      return;
    }

    // Delete button
    const delBtn = e.target.closest("[data-action='delete']");
    if (delBtn) { e.stopPropagation(); handleDeleteClick(delBtn); return; }
  });

  // Card drag/drop
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
    try { await fetchJson(`/api/leads/${leadId}/stage`, { method: "PATCH", body: JSON.stringify({ stage: newStage }) }); await loadLeads(); }
    catch (err) { alert(err.message); }
  });
}

function dismissAllModals() {
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
      try { const lead = await fetchJson(`/api/leads/${currentLeadId}`); openEditLeadModal(lead); }
      catch (err) { alert(err.message); }
    }
  });
  $id("run-research-btn")?.addEventListener("click", handleResearch);
  $id("generate-email-btn")?.addEventListener("click", handleGenerateEmailInWorkspace);
  $id("copy-email-btn")?.addEventListener("click", copyEmailToClipboard);

  // Notes auto-save
  const notesTextarea = $id("notes-textarea");
  if (notesTextarea) {
    notesTextarea.addEventListener("input", () => { autoResizeTextarea(notesTextarea); debouncedSaveNotes(); });
  }

  // Stage Settings
  $id("open-stage-settings")?.addEventListener("click", openStageSettings);
  $id("close-stage-settings")?.addEventListener("click", closeStageSettings);
  $id("add-stage-form")?.addEventListener("submit", handleAddStageFormSubmit);

  // Backdrop dismiss
  document.querySelectorAll("[data-modal-dismiss]").forEach(el => el.addEventListener("click", dismissAllModals));

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const overlay = $id("profile-onboarding");
    if (overlay?.classList.contains("profile-onboarding--edit-open")) { closeProfileEditor(); e.preventDefault(); return; }
    dismissAllModals();
  });

  if (document.documentElement.classList.contains("profile-ready")) void loadAllData();
});