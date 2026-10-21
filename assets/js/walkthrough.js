// Walkthrough view: step-by-step guide (by zaraxeon) with items linked to the
// checklist data, Map Genie locations, auto-completion from the save file and
// manual ticks synced through the cloud.
const WT = {
  data: null,
  sheet: "base",
  manual: { base: {}, dlc: {} },
  owned: null, // Set of "category|name" from the loaded save
  hideDone: false,
  query: "",
  saveTimer: null,
};
const WT_PROGRESS_PATH = "walkthrough.json";
const WT_NO_IMAGE = new Set(["bosses", "graces"]);

function wtEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function wtLoadData() {
  if (WT.data) return;
  fetchJson("assets/json/walkthrough.json?v=2", (d) => (WT.data = d));
  if (item_locations === null) createLocationHtml("");
}

// ---------- progress (manual ticks) ----------
function wtLoadLocalProgress() {
  try {
    const raw = localStorage.getItem("er_walkthrough");
    if (raw) WT.manual = Object.assign({ base: {}, dlc: {} }, JSON.parse(raw));
  } catch (e) {}
}

async function wtLoadCloudProgress() {
  if (typeof sb === "undefined" || !sb) return;
  try {
    const { data } = await sb.storage.from(SAVE_BUCKET).download(WT_PROGRESS_PATH);
    if (!data) return;
    const cloud = JSON.parse(await data.text());
    WT.manual = Object.assign({ base: {}, dlc: {} }, cloud);
    try { localStorage.setItem("er_walkthrough", JSON.stringify(WT.manual)); } catch (e) {}
    wtRender();
  } catch (e) {}
}

function wtSaveProgress() {
  try { localStorage.setItem("er_walkthrough", JSON.stringify(WT.manual)); } catch (e) {}
  clearTimeout(WT.saveTimer);
  WT.saveTimer = setTimeout(async () => {
    if (typeof sb === "undefined" || !sb) return;
    const blob = new Blob([JSON.stringify(WT.manual)], { type: "application/json" });
    await sb.storage.from(SAVE_BUCKET).upload(WT_PROGRESS_PATH, blob, { upsert: true, cacheControl: "0" });
  }, 800);
}

// ---------- owned items from the save ----------
function wtCollectOwned() {
  if (typeof results_by_source === "undefined" || !results_by_source.main) return null;
  const set = new Set();
  const add = (cat, v) => {
    if (Array.isArray(v)) v.forEach((n) => set.add(cat + "|" + n));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => add(cat, x));
  };
  for (const key in results_by_source) {
    const owned = results_by_source[key]?.owned;
    if (owned) for (const cat in owned) add(cat, owned[cat]);
  }
  return set;
}

function wtAutoDone(step) {
  if (!WT.owned || !step.i) return false;
  const has = (it) => WT.owned.has(it[0] + "|" + it[1]);
  return step.c.startsWith("Armor Set") ? step.i.every(has) : step.i.some(has);
}

function wtIsDone(step) {
  return wtAutoDone(step) || !!WT.manual[WT.sheet][step.n];
}

// ---------- rendering ----------
function wtStepHtml(step) {
  const auto = wtAutoDone(step);
  const done = auto || !!WT.manual[WT.sheet][step.n];
  const first = step.i ? step.i[0] : null;

  let url;
  if (first) url = getCardMetadata(first[1], first[0]).url;
  else url = "https://eldenring.wiki.gg/wiki/" + normalizeWikiName(step.t.replace(/\s*\(.*?\)\s*$/, ""));

  let img = "";
  if (first && !WT_NO_IMAGE.has(first[0])) {
    const clean = first[1].replace(/[:?"*|<>\\/]+/g, "");
    img = `<img class="wt-thumb" loading="lazy" alt="" src="assets/img/${first[0]}/${encodeURIComponent(clean)}.webp" onerror="this.style.visibility='hidden'">`;
  }

  let map = "";
  if (step.m) {
    const [mk, id, region] = step.m;
    map = ` <a class="wt-map" href="${MAPGENIE[mk].url}?locationIds=${id}" target="_blank" rel="noopener" title="Xem trên Map Genie">
      <svg viewBox="0 0 11 13" aria-hidden="true"><path d="M5.5 0A5.5 5.5 0 0 0 0 5.5C0 9.3 5.5 13 5.5 13S11 9.3 11 5.5A5.5 5.5 0 0 0 5.5 0zm0 7.6a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z" fill="currentColor"/></svg>Map</a>`;
  }

  return `<div class="wt-step${done ? " done" : ""}${auto ? " auto" : ""}" data-n="${step.n}">
    <label class="wt-check" title="${auto ? "Đã có trong save" : "Đánh dấu đã xong"}">
      <input type="checkbox" ${done ? "checked" : ""} ${auto ? "disabled" : ""} data-n="${step.n}"><span></span>
    </label>
    <span class="wt-num">${step.n}</span>
    <div class="wt-thumb-wrap">${img}</div>
    <div class="wt-body">
      <div class="wt-title">
        <a href="${url}" target="_blank" rel="noopener">${wtEsc(step.t)}</a>
        ${step.c ? `<span class="wt-cat">${wtEsc(step.c)}</span>` : ""}
        ${auto ? `<span class="wt-auto">từ save</span>` : ""}
      </div>
      <div class="wt-meta">${wtEsc(step.l)}${map}</div>
      ${step.d ? `<div class="wt-note">${wtEsc(step.d)}</div>` : ""}
    </div>
  </div>`;
}

function wtMatches(step) {
  if (!WT.query) return true;
  const q = WT.query;
  return (step.t + " " + step.c + " " + step.l + " " + (step.d || "")).toLowerCase().includes(q);
}

function wtSheet() {
  return WT.data.sheets.find((s) => s.key === WT.sheet);
}

function wtCounts(sheet) {
  let done = 0, total = 0;
  const prev = WT.sheet;
  WT.sheet = sheet.key;
  sheet.chapters.forEach((c) => c.steps.forEach((s) => { total++; if (wtIsDone(s)) done++; }));
  WT.sheet = prev;
  return { done, total };
}

function wtRender() {
  const root = document.getElementById("wt-root");
  if (!root || !WT.data) return;
  const openSet = new Set([...root.querySelectorAll("details.wt-chapter[open]")].map((d) => d.dataset.idx));

  const tabs = WT.data.sheets.map((s) => {
    const c = wtCounts(s);
    const label = s.key === "base" ? "Main Game" : "Shadow of the Erdtree";
    return `<button type="button" class="source-tab${s.key === WT.sheet ? " active" : ""}" data-sheet="${s.key}">
      <span class="source-label">${label}</span>
      <span class="source-count">${c.done}<span>/${c.total}</span></span></button>`;
  }).join("");

  const sheet = wtSheet();
  const chapters = sheet.chapters.map((ch, idx) => {
    const steps = ch.steps.filter(wtMatches);
    if (WT.query && !steps.length) return "";
    const total = ch.steps.length;
    const done = ch.steps.filter(wtIsDone).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const open = WT.query || openSet.has(String(idx));
    const body = open ? steps.map(wtStepHtml).join("") : "";
    return `<details class="wt-chapter${done === total ? " complete" : ""}" data-idx="${idx}" ${open ? "open" : ""}>
      <summary>
        <span class="wt-ch-title">${wtEsc(ch.title)}</span>
        <span class="wt-ch-bar"><span style="width:${pct}%"></span></span>
        <span class="wt-ch-count">${done}/${total}</span>
      </summary>
      ${ch.note ? `<div class="wt-ch-note">${wtEsc(ch.note)}</div>` : ""}
      <div class="wt-steps">${body}</div>
    </details>`;
  }).join("");

  const tips = sheet.tips && sheet.tips.length
    ? `<details class="wt-tips"><summary>Ghi chú chung của tác giả</summary><ul>${sheet.tips.map((t) => `<li>${wtEsc(t)}</li>`).join("")}</ul></details>`
    : "";

  root.innerHTML = `
    <div class="source-tabs wt-sheets" style="display:grid">${tabs}</div>
    <div class="wt-tools">
      <input type="search" class="er-input" id="wt-search" placeholder="Tìm bước, item, khu vực…" value="${wtEsc(WT.query)}">
      <label class="toggle"><input type="checkbox" id="wt-hide" ${WT.hideDone ? "checked" : ""}><span>Ẩn bước đã xong</span></label>
      <button type="button" class="er-button wt-next" id="wt-next"><span class="er-button-mark"></span><span>Tới bước tiếp theo</span></button>
    </div>
    ${WT.owned ? "" : `<div class="wt-hint">Chưa có save: các bước chỉ được đánh dấu bằng tay. Chọn save và Calculate để tự tick item đã có.</div>`}
    ${tips}
    <div class="wt-chapters${WT.hideDone ? " hide-done" : ""}">${chapters}</div>
    <div class="wt-credit">Walkthrough: <a href="${WT.data.source.url}" target="_blank" rel="noopener">${WT.data.source.author} (Google Sheet)</a></div>`;

  wtBind(root);
}

function wtBind(root) {
  root.querySelectorAll(".wt-sheets .source-tab").forEach((b) =>
    b.addEventListener("click", () => {
      WT.sheet = b.dataset.sheet;
      try { localStorage.setItem("er_wt_sheet", WT.sheet); } catch (e) {}
      wtRender();
    })
  );
  const search = root.querySelector("#wt-search");
  search.addEventListener("input", () => {
    clearTimeout(WT.searchTimer);
    WT.searchTimer = setTimeout(() => {
      WT.query = search.value.trim().toLowerCase();
      wtRender();
      const s = document.getElementById("wt-search");
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }, 250);
  });
  root.querySelector("#wt-hide").addEventListener("change", (e) => {
    WT.hideDone = e.target.checked;
    root.querySelector(".wt-chapters").classList.toggle("hide-done", WT.hideDone);
  });
  root.querySelector("#wt-next").addEventListener("click", wtGoNext);
  root.querySelectorAll("details.wt-chapter").forEach((d) =>
    d.addEventListener("toggle", () => {
      const box = d.querySelector(".wt-steps");
      if (d.open && !box.innerHTML) {
        const ch = wtSheet().chapters[+d.dataset.idx];
        box.innerHTML = ch.steps.filter(wtMatches).map(wtStepHtml).join("");
      }
    })
  );
  root.querySelector(".wt-chapters").addEventListener("change", (e) => {
    const cb = e.target;
    if (!cb.matches(".wt-check input")) return;
    const n = cb.dataset.n;
    if (cb.checked) WT.manual[WT.sheet][n] = 1;
    else delete WT.manual[WT.sheet][n];
    cb.closest(".wt-step").classList.toggle("done", cb.checked);
    wtSaveProgress();
    wtUpdateCounts(cb.closest("details.wt-chapter"));
  });
}

function wtUpdateCounts(details) {
  const sheet = wtSheet();
  if (details) {
    const ch = sheet.chapters[+details.dataset.idx];
    const done = ch.steps.filter(wtIsDone).length;
    details.querySelector(".wt-ch-count").textContent = `${done}/${ch.steps.length}`;
    details.querySelector(".wt-ch-bar span").style.width = `${Math.round((done / ch.steps.length) * 100)}%`;
    details.classList.toggle("complete", done === ch.steps.length);
  }
  document.querySelectorAll(".wt-sheets .source-tab").forEach((b) => {
    const s = WT.data.sheets.find((x) => x.key === b.dataset.sheet);
    const c = wtCounts(s);
    b.querySelector(".source-count").innerHTML = `${c.done}<span>/${c.total}</span>`;
  });
}

function wtGoNext() {
  const sheet = wtSheet();
  for (let idx = 0; idx < sheet.chapters.length; idx++) {
    const step = sheet.chapters[idx].steps.find((s) => !wtIsDone(s));
    if (!step) continue;
    if (WT.query) { WT.query = ""; wtRender(); }
    const d = document.querySelector(`details.wt-chapter[data-idx="${idx}"]`);
    if (!d.open) d.open = true;
    const box = d.querySelector(".wt-steps");
    if (!box.innerHTML) box.innerHTML = sheet.chapters[idx].steps.map(wtStepHtml).join("");
    const el = d.querySelector(`.wt-step[data-n="${step.n}"]`);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
    return;
  }
}

// Called by the checklist after a save has been analysed
function wtOnResults() {
  WT.owned = wtCollectOwned();
  if (document.getElementById("view-walkthrough").style.display !== "none") wtRender();
}

function showView(view) {
  document.querySelectorAll(".view-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("view-checklist").style.display = view === "checklist" ? "" : "none";
  document.getElementById("view-walkthrough").style.display = view === "walkthrough" ? "" : "none";
  try { localStorage.setItem("er_view", view); } catch (e) {}
  if (view === "walkthrough") {
    wtLoadData();
    WT.owned = wtCollectOwned();
    wtRender();
  }
}

$(function () {
  try { WT.sheet = localStorage.getItem("er_wt_sheet") || "base"; } catch (e) {}
  wtLoadLocalProgress();
  document.querySelectorAll(".view-tab").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  let view = "checklist";
  try { view = localStorage.getItem("er_view") || "checklist"; } catch (e) {}
  showView(view);
  wtLoadCloudProgress();
});
