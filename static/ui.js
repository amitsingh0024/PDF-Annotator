"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   PDF Annotation Studio — ui.js
   Label manager · Sidebar · Thumbnails · Modals · Theme
   ═══════════════════════════════════════════════════════════════════════════ */

const UI = (() => {

  // ── Colour palette for new labels ─────────────────────────────────────────
  const PALETTE = [
    "#22c55e","#f59e0b","#06b6d4","#a78bfa","#ef4444",
    "#f97316","#ec4899","#14b8a6","#eab308","#8b5cf6",
    "#3b82f6","#10b981","#f43f5e","#84cc16","#6366f1",
  ];

  let _colorPickerTarget = null;   // the label object being color-edited
  let _colorPickerCallback = null;

  // ── Theme ──────────────────────────────────────────────────────────────────
  function toggleTheme() {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    App.pyCall("save_prefs", { theme: isLight ? "light" : "dark" });
  }

  async function applyStoredTheme() {
    const prefs = await App.pyCall("get_prefs");
    if (!prefs.error && prefs.theme === "light") {
      document.body.classList.add("light");
    }
  }

  // ── File open ──────────────────────────────────────────────────────────────
  async function openFile() {
    const path = await App.pyCall("open_file_dialog");
    if (path) await App.openPdf(path);
    else showRecentModal();
  }

  // ── Label bar (top chip row) ───────────────────────────────────────────────
  function renderLabelBar() {
    // Remove existing chips (keep title + addBtn)
    const bar   = document.getElementById("labelbar");
    const title = document.getElementById("labelbarTitle");
    const addBtn = document.getElementById("addLabelBtn");
    // Remove chips
    bar.querySelectorAll(".label-chip").forEach(el => el.remove());

    const labels = App.state.annotations.labels;
    labels.forEach((lbl, i) => {
      const chip = document.createElement("div");
      chip.className = "label-chip" + (lbl.id === App.state.activeLabel ? " active" : "");
      chip.style.background = lbl.color + "28";
      chip.style.color      = lbl.color;
      chip.dataset.id = lbl.id;
      chip.innerHTML = `
        <span class="chip-dot"></span>
        ${escHtml(lbl.name)}
        <span class="label-key">${i < 9 ? i + 1 : ""}</span>
      `;
      chip.onclick = () => {
        App.state.activeLabel = lbl.id;
        renderLabelBar();
      };
      bar.insertBefore(chip, addBtn);
    });
  }

  // ── Label manager (sidebar) ────────────────────────────────────────────────
  function renderLabelManager() {
    const cont = document.getElementById("labelManager");
    cont.innerHTML = "";

    App.state.annotations.labels.forEach(lbl => {
      const item = document.createElement("div");
      item.className = "lm-item";

      const swatch = document.createElement("div");
      swatch.className   = "lm-swatch";
      swatch.style.background = lbl.color;
      swatch.title = "Click to change color";
      swatch.onclick = e => showColorPicker(e, lbl, () => {
        renderLabelManager();
        renderLabelBar();
        App.render();
        App.markDirty();
      });

      const nameInput = document.createElement("input");
      nameInput.className   = "lm-name-input";
      nameInput.value       = lbl.name;
      nameInput.placeholder = "Label name";
      nameInput.onchange = () => {
        lbl.name = nameInput.value.trim() || lbl.name;
        renderLabelBar();
        renderRegionList();
        App.render();
        App.markDirty();
      };

      const delBtn = document.createElement("button");
      delBtn.className = "lm-del";
      delBtn.textContent = "×";
      delBtn.title = "Delete label";
      delBtn.onclick = () => deleteLabel(lbl.id);

      item.appendChild(swatch);
      item.appendChild(nameInput);
      item.appendChild(delBtn);
      cont.appendChild(item);
    });
  }

  function addLabel() {
    const labels = App.state.annotations.labels;
    const color  = PALETTE[labels.length % PALETTE.length];
    const newLbl = {
      id:    `lbl_${Date.now()}`,
      name:  `Label ${labels.length + 1}`,
      color,
    };
    labels.push(newLbl);
    App.state.activeLabel = newLbl.id;
    renderLabelBar();
    renderLabelManager();
    switchTab("labels");
    App.markDirty();
  }

  function deleteLabel(id) {
    const labels = App.state.annotations.labels;
    if (labels.length === 1) { status("Must have at least one label"); return; }
    App.state.annotations.labels = labels.filter(l => l.id !== id);
    if (App.state.activeLabel === id) {
      App.state.activeLabel = App.state.annotations.labels[0].id;
    }
    renderLabelBar();
    renderLabelManager();
    App.markDirty();
  }

  // ── Color picker ───────────────────────────────────────────────────────────
  function buildColorGrid() {
    const grid = document.getElementById("colorGrid");
    grid.innerHTML = "";
    PALETTE.forEach(c => {
      const sw = document.createElement("div");
      sw.className = "color-swatch";
      sw.style.background = c;
      sw.onclick = () => {
        if (_colorPickerTarget) {
          _colorPickerTarget.color = c;
          document.getElementById("colorPicker").classList.remove("visible");
          if (_colorPickerCallback) _colorPickerCallback(c);
        }
      };
      grid.appendChild(sw);
    });
  }

  function showColorPicker(e, lbl, callback) {
    e.stopPropagation();
    _colorPickerTarget  = lbl;
    _colorPickerCallback = callback;
    const picker = document.getElementById("colorPicker");
    picker.classList.add("visible");
    // Position near click
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY + 8, window.innerHeight - 200);
    picker.style.left = x + "px";
    picker.style.top  = y + "px";
    document.getElementById("customColorInput").value = lbl.color;
  }

  function pickCustomColor(c) {
    if (_colorPickerTarget) {
      _colorPickerTarget.color = c;
      document.getElementById("colorPicker").classList.remove("visible");
      if (_colorPickerCallback) _colorPickerCallback(c);
    }
  }

  document.addEventListener("click", e => {
    if (!e.target.closest("#colorPicker") && !e.target.classList.contains("lm-swatch")) {
      document.getElementById("colorPicker").classList.remove("visible");
    }
  });

  // ── Region list (sidebar) ──────────────────────────────────────────────────
  function renderRegionList() {
    const list = document.getElementById("regionList");
    list.innerHTML = "";

    if (!App.state.regions.length) {
      list.innerHTML = '<div class="no-regions">No regions on this page yet.<br>Use the drawing tools to annotate.</div>';
      return;
    }

    App.state.regions.forEach((r, i) => {
      const lbl  = App.getLabel(r.label);
      const color = lbl ? lbl.color : "#6366f1";

      const item = document.createElement("div");
      item.className = "region-item" + (r.id === App.state.selectedId ? " selected" : "");

      item.innerHTML = `
        <div class="r-dot" style="background:${color}"></div>
        <div class="r-info">
          <div class="r-name">${escHtml(lbl ? lbl.name : r.label)} #${i + 1}</div>
          <div class="r-shape">${r.shape}${r.note ? " · " + escHtml(r.note.slice(0, 20)) : ""}</div>
        </div>
        <button class="r-del" title="Delete (select + Backspace)">×</button>
      `;
      item.querySelector(".r-del").onclick = e => {
        e.stopPropagation();
        App.state.regions = App.state.regions.filter(x => x.id !== r.id);
        if (App.state.selectedId === r.id) {
          App.state.selectedId = null;
          hideNoteArea();
        }
        App.markDirty();
        App.render();
        renderRegionList();
      };
      item.onclick = () => {
        App.state.selectedId = r.id;
        App.render();
        renderRegionList();
        showNoteArea(r);
      };
      list.appendChild(item);
    });
  }

  function showNoteArea(r) {
    const area = document.getElementById("noteArea");
    area.classList.remove("hidden");
    document.getElementById("regionNote").value = r.note || "";
  }

  function hideNoteArea() {
    document.getElementById("noteArea").classList.add("hidden");
    document.getElementById("regionNote").value = "";
  }

  // ── Sidebar tabs ───────────────────────────────────────────────────────────
  function switchTab(name) {
    ["regions","labels"].forEach(t => {
      document.getElementById(`tab-${t}`).classList.toggle("active", t === name);
      document.getElementById(`panel-${t}`).classList.toggle("active", t === name);
    });
  }

  // ── Thumbnail strip ────────────────────────────────────────────────────────
  const THUMB_BATCH = 8;   // load this many at a time

  async function buildThumbnails() {
    const strip = document.getElementById("thumbStrip");
    strip.innerHTML = "";

    const total = App.state.pageCount;
    for (let p = 1; p <= total; p++) {
      const item = document.createElement("div");
      item.className = "thumb-item";
      item.dataset.page = p;

      // Check if page already has annotations
      if ((App.state.annotations.pages[String(p)] || []).length > 0) {
        item.classList.add("annotated");
      }

      item.innerHTML = `
        <div class="thumb-img-wrap">
          <img src="" alt="Page ${p}" loading="lazy" style="min-height:80px;background:#222">
          <div class="thumb-annotated-dot"></div>
        </div>
        <span class="thumb-label">${p}</span>
      `;
      item.onclick = () => App.goPage(p);
      strip.appendChild(item);
    }

    // Load thumbnails lazily in batches
    lazyLoadThumbnails();
  }

  function lazyLoadThumbnails() {
    const strip = document.getElementById("thumbStrip");
    const items = strip.querySelectorAll(".thumb-item");

    const observer = new IntersectionObserver(async (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = entry.target;
        const img  = item.querySelector("img");
        if (img.src && img.src !== location.href) continue;  // already loaded

        const p = parseInt(item.dataset.page);
        observer.unobserve(item);

        const result = await App.pyCall("render_thumbnail", p - 1);
        if (!result.error) {
          img.src = `data:image/jpeg;base64,${result.image}`;
          img.style.minHeight = "";
        }
      }
    }, { root: strip, rootMargin: "200px" });

    items.forEach(item => observer.observe(item));
  }

  function highlightThumb(page) {
    document.querySelectorAll(".thumb-item").forEach(el => {
      el.classList.toggle("active", parseInt(el.dataset.page) === page);
    });
    // Scroll into view
    const active = document.querySelector(`.thumb-item[data-page="${page}"]`);
    if (active) active.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // Update annotated dot for the page we just came from
    document.querySelectorAll(".thumb-item").forEach(el => {
      const p = parseInt(el.dataset.page);
      const has = (App.state.annotations.pages[String(p)] || []).length > 0;
      el.classList.toggle("annotated", has);
    });
  }

  // ── Modals ─────────────────────────────────────────────────────────────────
  async function showRecentModal() {
    const recent = await App.pyCall("get_recent_files");
    const body   = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "Recent Files";

    if (!recent || !recent.length) {
      body.innerHTML = '<p style="color:var(--text3);font-size:13px">No recent files.</p>';
    } else {
      const ul = document.createElement("ul");
      ul.id = "recentList";
      recent.forEach(path => {
        const li = document.createElement("li");
        li.textContent = path;
        li.title = path;
        li.onclick = () => {
          closeModal();
          App.openPdf(path);
        };
        ul.appendChild(li);
      });
      body.innerHTML = "";
      body.appendChild(ul);
    }
    document.getElementById("modal").classList.add("visible");
  }

  function closeModal() {
    document.getElementById("modal").classList.remove("visible");
  }

  // Click outside modal box to close
  document.getElementById("modal").addEventListener("click", e => {
    if (e.target === document.getElementById("modal")) closeModal();
  });

  // ── Status flash ───────────────────────────────────────────────────────────
  let _statusTimer;
  function status(msg, duration = 3000) {
    const el = document.getElementById("statusMsg");
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.textContent = "", 300);
    }, duration);
  }

  // ── Escape key closes modal / cancels drawing ──────────────────────────────
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeModal();
      document.getElementById("colorPicker").classList.remove("visible");
    }
  });

  // ── Utility ────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    buildColorGrid();
    await applyStoredTheme();

    // Show recent files on startup if no PDF open
    const recent = await App.pyCall("get_recent_files");
    if (recent && recent.length) {
      // Auto-open the most recent file for convenience
      // await App.openPdf(recent[0]);
      // (commented out — let user choose deliberately)
    }
  }

  // Wait for pywebview to be ready before init
  window.addEventListener("pywebviewready", init);
  // Also try on DOM ready (for browser dev mode)
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.pywebview) setTimeout(init, 500);
  });

  // ── Settings modal ─────────────────────────────────────────────────────────

  async function showSettings() {
    const prefs = await App.pyCall("get_prefs");
    const isDark = !document.body.classList.contains("light");

    document.getElementById("settingsLang").value   = prefs.ocr_lang  || "hin+san+eng";
    document.getElementById("settingsDpi").value    = String(prefs.default_dpi || 150);
    document.getElementById("settingsOcrDpi").value = String(prefs.ocr_dpi    || 300);
    _refreshThemeButtons(isDark ? "dark" : "light");

    // Always open on the Settings tab
    switchSettingsTab("settings");
    document.getElementById("settingsModal").classList.add("visible");
  }

  function closeSettings() {
    document.getElementById("settingsModal").classList.remove("visible");
  }

  function switchSettingsTab(name) {
    ["settings", "guide"].forEach(t => {
      document.getElementById(`stab-${t}`).classList.toggle("active", t === name);
      document.getElementById(`settings-panel-${t}`).classList.toggle("active", t === name);
    });
  }

  function setTheme(theme) {
    if (theme === "light") document.body.classList.add("light");
    else                   document.body.classList.remove("light");
    _refreshThemeButtons(theme);
  }

  function _refreshThemeButtons(active) {
    document.getElementById("btnThemeDark").classList.toggle("active",  active === "dark");
    document.getElementById("btnThemeLight").classList.toggle("active", active === "light");
  }

  async function saveSettings() {
    const lang   = document.getElementById("settingsLang").value.trim() || "hin+san+eng";
    const dpi    = parseInt(document.getElementById("settingsDpi").value)    || 150;
    const ocrDpi = parseInt(document.getElementById("settingsOcrDpi").value) || 300;
    const theme  = document.body.classList.contains("light") ? "light" : "dark";

    await App.pyCall("save_prefs", { theme, default_dpi: dpi, ocr_lang: lang, ocr_dpi: ocrDpi });
    closeSettings();
    status("Settings saved.");
  }

  document.getElementById("settingsModal").addEventListener("click", e => {
    if (e.target.id === "settingsModal") closeSettings();
  });

  // ── Parse modal ────────────────────────────────────────────────────────────

  let _pollTimer = null;

  async function showParseModal() {
    // Auto-save first so the annotation file on disk is current
    if (App.state.dirty) await App.saveAnnotations(true);

    const pages = await App.pyCall("get_annotated_pages");
    const list  = document.getElementById("parsePageList");
    list.innerHTML = "";

    if (!pages || !pages.length) {
      list.innerHTML = '<p class="parse-empty">No annotated pages found.<br>Draw regions on pages first, then save.</p>';
      document.getElementById("btnStartParse").disabled = true;
    } else {
      document.getElementById("btnStartParse").disabled = false;
      pages.forEach(p => {
        const lbl = document.createElement("label");
        lbl.className = "parse-page-check";
        lbl.innerHTML = `<input type="checkbox" class="parse-page-cb" value="${p}" checked> Page ${p}`;
        list.appendChild(lbl);
      });
    }

    document.getElementById("parseModal").classList.add("visible");
  }

  function closeParseModal() {
    document.getElementById("parseModal").classList.remove("visible");
  }

  function selectAllParsePages(checked) {
    document.querySelectorAll(".parse-page-cb").forEach(cb => { cb.checked = checked; });
  }

  async function startParse() {
    const selected = [...document.querySelectorAll(".parse-page-cb:checked")].map(cb => parseInt(cb.value));
    if (!selected.length) { status("Select at least one page."); return; }

    const prefs   = await App.pyCall("get_prefs");
    const lang    = prefs.ocr_lang  || "hin+san+eng";
    const ocrDpi  = prefs.ocr_dpi   || 300;
    const wantTxt  = document.getElementById("fmtTxt").checked;
    const wantJson = document.getElementById("fmtJson").checked;
    if (!wantTxt && !wantJson) { status("Select at least one output format."); return; }

    closeParseModal();
    _openProgressModal(selected.length, wantTxt, wantJson);

    const res = await App.pyCall("start_ocr_parse", selected, lang, ocrDpi);
    if (res.error) {
      _setProgressError(res.error);
      return;
    }
    _pollTimer = setInterval(() => _pollProgress(wantTxt, wantJson), 500);
  }

  function _openProgressModal(total, wantTxt, wantJson) {
    document.getElementById("parseProgressTitle").textContent = "Parsing PDF…";
    document.getElementById("parseProgressFill").style.width  = "0%";
    document.getElementById("parseProgressStatus").textContent = "Starting…";
    document.getElementById("parseProgressCount").textContent  = `0 / ${total} pages`;
    const actions = document.getElementById("parseProgressActions");
    actions.innerHTML = '<button class="btn" id="btnCancelParse" onclick="UI.cancelParse()">Cancel</button>';
    document.getElementById("parseProgressModal").classList.add("visible");
  }

  async function _pollProgress(wantTxt, wantJson) {
    const p = await App.pyCall("get_parse_progress");
    if (!p) return;

    const pct = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
    document.getElementById("parseProgressFill").style.width  = pct + "%";
    document.getElementById("parseProgressStatus").textContent = p.status || "";
    document.getElementById("parseProgressCount").textContent  =
      p.total > 0 ? `${p.current} / ${p.total} pages` : "";

    if (p.error) {
      clearInterval(_pollTimer);
      _setProgressError(p.error);
      return;
    }

    if (p.done) {
      clearInterval(_pollTimer);
      document.getElementById("parseProgressFill").style.width = "100%";
      document.getElementById("parseProgressTitle").textContent = "Parse Complete";

      // Build save buttons for the formats requested
      const actions = document.getElementById("parseProgressActions");
      actions.innerHTML = "";

      const closeBtn = document.createElement("button");
      closeBtn.className   = "btn";
      closeBtn.textContent = "Close";
      closeBtn.onclick     = closeParseProgressModal;
      actions.appendChild(closeBtn);

      if (wantTxt) {
        const btn = document.createElement("button");
        btn.className   = "btn primary";
        btn.textContent = "Save as TXT";
        btn.onclick     = () => _saveParsedAs("txt", p.result_txt);
        actions.appendChild(btn);
      }
      if (wantJson) {
        const btn = document.createElement("button");
        btn.className   = "btn primary";
        btn.textContent = "Save as JSON";
        btn.onclick     = () => _saveParsedAs("json", p.result_json);
        actions.appendChild(btn);
      }
    }
  }

  function _setProgressError(msg) {
    document.getElementById("parseProgressTitle").textContent  = "Parse Failed";
    document.getElementById("parseProgressStatus").textContent = msg;
    document.getElementById("parseProgressFill").style.background = "var(--danger)";
    const actions = document.getElementById("parseProgressActions");
    actions.innerHTML = '<button class="btn" onclick="UI.closeParseProgressModal()">Close</button>';
  }

  function closeParseProgressModal() {
    clearInterval(_pollTimer);
    document.getElementById("parseProgressModal").classList.remove("visible");
    document.getElementById("parseProgressFill").style.background = "";
  }

  async function cancelParse() {
    await App.pyCall("cancel_ocr_parse");
    clearInterval(_pollTimer);
    document.getElementById("parseProgressTitle").textContent  = "Cancelled";
    document.getElementById("parseProgressStatus").textContent = "Parse was cancelled.";
    const actions = document.getElementById("parseProgressActions");
    actions.innerHTML = '<button class="btn" onclick="UI.closeParseProgressModal()">Close</button>';
  }

  async function _saveParsedAs(fmt, content) {
    const res = await App.pyCall("save_parsed_output", content, fmt);
    if (res.error)      { status("Save failed: " + res.error); return; }
    if (res.cancelled)  return;
    status(`Saved: ${res.path}`);
  }

  // Close parse overlays on outside click
  ["parseModal", "parseProgressModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", e => {
      if (e.target.id === id) {
        if (id === "parseModal") closeParseModal();
        else closeParseProgressModal();
      }
    });
  });

  // ── Public ─────────────────────────────────────────────────────────────────
  return {
    toggleTheme,
    openFile,
    renderLabelBar,
    renderLabelManager,
    renderRegionList,
    addLabel,
    deleteLabel,
    showNoteArea,
    hideNoteArea,
    switchTab,
    buildThumbnails,
    highlightThumb,
    showRecentModal,
    closeModal,
    pickCustomColor,
    status,
    // Settings
    showSettings,
    closeSettings,
    setTheme,
    saveSettings,
    switchSettingsTab,
    // Parse
    showParseModal,
    closeParseModal,
    selectAllParsePages,
    startParse,
    cancelParse,
    closeParseProgressModal,
  };

})();
