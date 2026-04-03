"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   PDF Annotation Studio — app.js
   Canvas engine · Tool system · Undo/Redo · State management
   ═══════════════════════════════════════════════════════════════════════════ */

const App = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    // PDF
    pdfOpen:    false,
    pdfName:    "",
    pageCount:  0,
    page:       1,           // 1-based

    // View transform
    zoom:       1.0,
    panX:       0,
    panY:       0,
    pageW:      0,           // page image natural width (px)
    pageH:      0,

    // Tool
    tool:       "select",    // select | rect | polygon | freehand | pan | eraser
    prevTool:   "select",    // for space-bar pan toggle

    // Annotations (whole document)
    annotations: {
      pdf: "",
      pdf_hash: "",
      created: "",
      last_modified: "",
      labels: [],
      pages: {},
    },

    // Active label id
    activeLabel: null,

    // Regions on current page
    regions: [],             // [{id,label,shape,pts,note}]
    selectedId: null,

    dirty: false,
    autoSaveTimer: null,
  };

  // ── Undo stack ─────────────────────────────────────────────────────────────
  const MAX_UNDO = 60;
  let undoStack = [];
  let redoStack = [];

  function pushUndo() {
    undoStack.push(JSON.stringify(state.regions));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    refreshUndoButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state.regions));
    state.regions = JSON.parse(undoStack.pop());
    state.selectedId = null;
    markDirty();
    render();
    UI.renderRegionList();
    refreshUndoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state.regions));
    state.regions = JSON.parse(redoStack.pop());
    state.selectedId = null;
    markDirty();
    render();
    UI.renderRegionList();
    refreshUndoButtons();
  }

  function refreshUndoButtons() {
    document.getElementById("btnUndo").disabled = undoStack.length === 0;
    document.getElementById("btnRedo").disabled = redoStack.length === 0;
  }

  // ── Canvas setup ───────────────────────────────────────────────────────────
  const canvas = document.getElementById("mainCanvas");
  const ctx    = canvas.getContext("2d");
  let pageImg  = null;       // HTMLImageElement of the current page

  function resizeCanvas() {
    const area = document.getElementById("canvasArea");
    canvas.width  = area.clientWidth;
    canvas.height = area.clientHeight;
    render();
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ── Coordinate transforms ──────────────────────────────────────────────────
  // Screen → page (normalised 0-1)
  function screenToNorm(sx, sy) {
    const px = (sx - state.panX) / (state.zoom * state.pageW);
    const py = (sy - state.panY) / (state.zoom * state.pageH);
    return { x: px, y: py };
  }
  // Page (normalised) → screen
  function normToScreen(nx, ny) {
    return {
      x: nx * state.pageW * state.zoom + state.panX,
      y: ny * state.pageH * state.zoom + state.panY,
    };
  }
  // Clamp normalized coords
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ── Render loop ────────────────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pageImg || !state.pdfOpen) return;

    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);

    // Page image
    ctx.drawImage(pageImg, 0, 0, state.pageW, state.pageH);

    // Dim if needed (when a region is selected)
    if (state.selectedId) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, state.pageW, state.pageH);
    }

    // Draw all regions
    state.regions.forEach(r => drawRegion(r, r.id === state.selectedId));

    // In-progress shape preview
    drawPreview();

    ctx.restore();

    // Status bar cursor coords updated in mousemove
    updateStatusBar();
  }

  // ── Draw a region ──────────────────────────────────────────────────────────
  function drawRegion(r, selected) {
    const lbl   = getLabel(r.label);
    const color = lbl ? lbl.color : "#6366f1";
    const pts   = denormPts(r.pts);  // [{x,y}] in page px

    if (!pts.length) return;

    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.82;

    // Fill
    ctx.beginPath();
    moveToPts(pts);
    ctx.closePath();
    ctx.fillStyle = color + (selected ? "38" : "20");
    ctx.fill();

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth   = (selected ? 2.2 : 1.6) / state.zoom;
    ctx.setLineDash(selected ? [6 / state.zoom, 3 / state.zoom] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner handles (selected only)
    if (selected && r.shape === "rect") {
      drawHandles(pts, color);
    }

    // Label badge on top-left of bounding box
    const bb  = boundingBox(pts);
    const fz  = Math.max(10, 12 / state.zoom);
    ctx.font  = `600 ${fz}px sans-serif`;
    const txt = lbl ? lbl.name : r.label;
    const tw  = ctx.measureText(txt).width;
    const bx  = bb.x;
    const by  = bb.y - fz - 3 / state.zoom;

    ctx.fillStyle = color;
    ctx.fillRect(bx, by - 1 / state.zoom, tw + 8 / state.zoom, fz + 4 / state.zoom);
    ctx.fillStyle = "#000";
    ctx.fillText(txt, bx + 4 / state.zoom, by + fz - 1 / state.zoom);

    ctx.restore();
  }

  function drawHandles(pts, color) {
    const r = 5 / state.zoom;
    ctx.fillStyle = color;
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function moveToPts(pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  // ── In-progress shape preview ──────────────────────────────────────────────
  let previewPts   = [];     // for polygon — confirmed vertices
  let previewMouse = null;   // current mouse position (page coords)
  let drawing      = false;
  let freehandPts  = [];

  function drawPreview() {
    if (!drawing && !previewPts.length) return;

    const lbl   = getLabel(state.activeLabel);
    const color = lbl ? lbl.color : "#6366f1";

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color + "22";
    ctx.lineWidth   = 1.8 / state.zoom;
    ctx.setLineDash([5 / state.zoom, 3 / state.zoom]);

    if (state.tool === "rect" && drawing && previewMouse) {
      const [a, b] = rectFromTwo(previewPts[0], previewMouse);
      ctx.beginPath();
      ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fill();
      ctx.stroke();
    }

    if (state.tool === "polygon") {
      if (previewPts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(previewPts[0].x, previewPts[0].y);
        previewPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        if (previewMouse) ctx.lineTo(previewMouse.x, previewMouse.y);
        ctx.stroke();
        // Draw point handles
        previewPts.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 / state.zoom, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        });
      }
    }

    if (state.tool === "freehand" && drawing && freehandPts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(freehandPts[0].x, freehandPts[0].y);
      freehandPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Mouse event routing ────────────────────────────────────────────────────
  canvas.addEventListener("mousedown",  onMouseDown);
  canvas.addEventListener("mousemove",  onMouseMove);
  canvas.addEventListener("mouseup",    onMouseUp);
  canvas.addEventListener("dblclick",   onDblClick);
  canvas.addEventListener("contextmenu", e => { e.preventDefault(); cancelDrawing(); });
  canvas.addEventListener("wheel",      onWheel, { passive: false });

  // Middle-click pan
  canvas.addEventListener("mousedown", e => {
    if (e.button === 1) { e.preventDefault(); startPan(e); }
  });

  let panStartX = 0, panStartY = 0, panStartPanX = 0, panStartPanY = 0;
  let isPanning = false;

  function startPan(e) {
    isPanning = true;
    panStartX   = e.clientX;
    panStartY   = e.clientY;
    panStartPanX = state.panX;
    panStartPanY = state.panY;
    document.getElementById("canvasArea").classList.add("panning");
  }

  function getPageCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const n  = screenToNorm(sx, sy);
    // Page pixel coords (for drawing)
    return {
      sx, sy,
      px: n.x * state.pageW,
      py: n.y * state.pageH,
      nx: n.x,
      ny: n.y,
    };
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (!state.pdfOpen) return;
    const c = getPageCoords(e);

    if (state.tool === "pan") { startPan(e); return; }
    if (state.tool === "select") { handleSelectDown(c); return; }
    if (state.tool === "eraser") { handleEraser(c); return; }
    if (state.tool === "rect")    { handleRectDown(c); return; }
    if (state.tool === "polygon") { handlePolygonDown(c); return; }
    if (state.tool === "freehand"){ handleFreehandDown(c); return; }
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Update cursor coordinates in status bar
    const n = screenToNorm(sx, sy);
    const inPage = n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1;
    document.getElementById("stCursor").textContent = inPage
      ? `${Math.round(n.x * state.pageW)}, ${Math.round(n.y * state.pageH)}`
      : "—";

    // Pan
    if (isPanning) {
      state.panX = panStartPanX + (e.clientX - panStartX);
      state.panY = panStartPanY + (e.clientY - panStartY);
      render();
      return;
    }

    if (!state.pdfOpen) return;
    const c = getPageCoords(e);
    previewMouse = { x: c.px, y: c.py };

    if (state.tool === "select" && isDraggingRegion) { handleSelectDrag(c); return; }
    if (state.tool === "rect" && drawing)             { render(); return; }
    if (state.tool === "polygon")                     { render(); return; }
    if (state.tool === "freehand" && drawing)         { handleFreehandMove(c); return; }
  }

  function onMouseUp(e) {
    if (isPanning) {
      isPanning = false;
      document.getElementById("canvasArea").classList.remove("panning");
      return;
    }
    if (!state.pdfOpen || e.button !== 0) return;
    const c = getPageCoords(e);

    if (state.tool === "select" && isDraggingRegion) { handleSelectUp(c); return; }
    if (state.tool === "rect" && drawing)             { handleRectUp(c); return; }
    if (state.tool === "freehand" && drawing)         { handleFreehandUp(c); return; }
  }

  function onDblClick(e) {
    if (!state.pdfOpen) return;
    if (state.tool === "polygon" && previewPts.length >= 3) closePolygon();
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const delta  = e.deltaY > 0 ? -0.08 : 0.08;
    const newZ   = Math.min(5, Math.max(0.1, state.zoom + delta));
    const factor = newZ / state.zoom;

    state.panX = sx - factor * (sx - state.panX);
    state.panY = sy - factor * (sy - state.panY);
    state.zoom = newZ;

    updateZoomUI();
    render();
  }

  // ── Tool: Select / Move ────────────────────────────────────────────────────
  let isDraggingRegion = false;
  let dragOffsets      = [];    // per-point offset from initial click
  let dragRegion       = null;
  let dragStart        = null;
  let originalPts      = [];

  function handleSelectDown(c) {
    const hit = hitTest(c.px, c.py);
    if (hit) {
      if (state.selectedId !== hit.id) {
        state.selectedId = hit.id;
        UI.renderRegionList();
        UI.showNoteArea(hit);
      }
      // Setup drag
      dragRegion     = hit;
      dragStart      = { px: c.px, py: c.py };
      originalPts    = JSON.parse(JSON.stringify(hit.pts));
      isDraggingRegion = true;
    } else {
      state.selectedId = null;
      UI.renderRegionList();
      UI.hideNoteArea();
    }
    render();
  }

  function handleSelectDrag(c) {
    if (!dragRegion) return;
    const dx = (c.px - dragStart.px) / state.pageW;
    const dy = (c.py - dragStart.py) / state.pageH;
    dragRegion.pts = originalPts.map(p => ({
      x: clamp01(p.x + dx),
      y: clamp01(p.y + dy),
    }));
    render();
  }

  function handleSelectUp(c) {
    if (dragRegion) {
      pushUndo();
      markDirty();
    }
    isDraggingRegion = false;
    dragRegion = null;
  }

  // ── Tool: Eraser ───────────────────────────────────────────────────────────
  function handleEraser(c) {
    const hit = hitTest(c.px, c.py);
    if (hit) {
      pushUndo();
      state.regions = state.regions.filter(r => r.id !== hit.id);
      if (state.selectedId === hit.id) state.selectedId = null;
      markDirty();
      render();
      UI.renderRegionList();
    }
  }

  // ── Tool: Rectangle ────────────────────────────────────────────────────────
  function handleRectDown(c) {
    drawing = true;
    previewPts = [{ x: c.px, y: c.py }];
  }

  function handleRectUp(c) {
    drawing = false;
    if (!previewPts.length) return;
    const [a, b] = rectFromTwo(previewPts[0], { x: c.px, y: c.py });
    const ww = b.x - a.x;
    const hh = b.y - a.y;
    if (ww < 4 || hh < 4) { previewPts = []; render(); return; }

    pushUndo();
    const region = {
      id:    uid(),
      label: state.activeLabel || (state.annotations.labels[0] || {}).id,
      shape: "rect",
      pts: [
        { x: clamp01(a.x / state.pageW), y: clamp01(a.y / state.pageH) },
        { x: clamp01(b.x / state.pageW), y: clamp01(a.y / state.pageH) },
        { x: clamp01(b.x / state.pageW), y: clamp01(b.y / state.pageH) },
        { x: clamp01(a.x / state.pageW), y: clamp01(b.y / state.pageH) },
      ],
      note: "",
    };
    state.regions.push(region);
    state.selectedId = region.id;
    previewPts = [];
    markDirty();
    render();
    UI.renderRegionList();
  }

  // ── Tool: Polygon ──────────────────────────────────────────────────────────
  function handlePolygonDown(c) {
    // First point check — close if near start
    if (previewPts.length >= 3) {
      const first = previewPts[0];
      const dist  = Math.hypot(c.px - first.x, c.py - first.y);
      if (dist < 12 / state.zoom) { closePolygon(); return; }
    }
    previewPts.push({ x: c.px, y: c.py });
    render();
  }

  function closePolygon() {
    if (previewPts.length < 3) { cancelDrawing(); return; }
    pushUndo();
    const region = {
      id:    uid(),
      label: state.activeLabel || (state.annotations.labels[0] || {}).id,
      shape: "polygon",
      pts:   previewPts.map(p => ({
        x: clamp01(p.x / state.pageW),
        y: clamp01(p.y / state.pageH),
      })),
      note: "",
    };
    state.regions.push(region);
    state.selectedId = region.id;
    previewPts = [];
    markDirty();
    render();
    UI.renderRegionList();
  }

  // ── Tool: Freehand ─────────────────────────────────────────────────────────
  const FREEHAND_MIN_DIST = 4; // px, skip jitter

  function handleFreehandDown(c) {
    drawing = true;
    freehandPts = [{ x: c.px, y: c.py }];
  }

  function handleFreehandMove(c) {
    const last = freehandPts[freehandPts.length - 1];
    const dist = Math.hypot(c.px - last.x, c.py - last.y);
    if (dist >= FREEHAND_MIN_DIST / state.zoom) {
      freehandPts.push({ x: c.px, y: c.py });
      render();
    }
  }

  function handleFreehandUp(c) {
    drawing = false;
    if (freehandPts.length < 3) { freehandPts = []; render(); return; }

    // Simplify: keep every Nth point (Douglas-Peucker would be nicer but overkill)
    const simplified = simplifyPts(freehandPts, 2 / state.zoom);
    if (simplified.length < 3) { freehandPts = []; render(); return; }

    pushUndo();
    const region = {
      id:    uid(),
      label: state.activeLabel || (state.annotations.labels[0] || {}).id,
      shape: "freehand",
      pts:   simplified.map(p => ({
        x: clamp01(p.x / state.pageW),
        y: clamp01(p.y / state.pageH),
      })),
      note: "",
    };
    state.regions.push(region);
    state.selectedId = region.id;
    freehandPts = [];
    markDirty();
    render();
    UI.renderRegionList();
  }

  // ── Cancel in-progress drawing (Escape / right-click) ─────────────────────
  function cancelDrawing() {
    drawing      = false;
    previewPts   = [];
    freehandPts  = [];
    previewMouse = null;
    render();
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────
  function rectFromTwo(a, b) {
    return [
      { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
      { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    ];
  }

  function denormPts(pts) {
    return pts.map(p => ({ x: p.x * state.pageW, y: p.y * state.pageH }));
  }

  function boundingBox(pts) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // Point-in-polygon (ray casting) — works for all shapes
  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      const intersect = (yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function hitTest(px, py) {
    // Test in reverse order (top region first)
    for (let i = state.regions.length - 1; i >= 0; i--) {
      const r   = state.regions[i];
      const pts = denormPts(r.pts);
      if (pointInPolygon(px, py, pts)) return r;
    }
    return null;
  }

  // Douglas-Peucker simplification
  function simplifyPts(pts, eps) {
    if (pts.length <= 2) return pts;
    let maxDist = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > eps) {
      const l = simplifyPts(pts.slice(0, idx + 1), eps);
      const r = simplifyPts(pts.slice(idx), eps);
      return [...l.slice(0, -1), ...r];
    }
    return [pts[0], pts[pts.length - 1]];
  }

  function perpendicularDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dx * (a.y - p.y) - (a.x - p.x) * dy) / len;
  }

  // ── Tools ──────────────────────────────────────────────────────────────────
  function setTool(name) {
    cancelDrawing();
    state.prevTool = state.tool;
    state.tool     = name;

    // Update toolbar active states
    ["select","rect","polygon","freehand","pan","eraser"].forEach(t => {
      const btn = document.getElementById(`tool-${t}`);
      if (btn) btn.classList.toggle("active", t === name);
    });

    const area = document.getElementById("canvasArea");
    area.className = `tool-${name}`;

    document.getElementById("stTool").textContent =
      { select:"Select", rect:"Rectangle", polygon:"Polygon",
        freehand:"Freehand Lasso", pan:"Pan", eraser:"Eraser" }[name] || name;
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────
  function zoom(delta) {
    state.zoom = Math.min(5, Math.max(0.1, state.zoom + delta));
    updateZoomUI();
    render();
  }

  function fitPage() {
    if (!state.pdfOpen) return;
    const area = document.getElementById("canvasArea");
    const margin = 40;
    const scaleX = (area.clientWidth  - margin) / state.pageW;
    const scaleY = (area.clientHeight - margin) / state.pageH;
    state.zoom = Math.min(scaleX, scaleY);
    state.panX = (area.clientWidth  - state.pageW * state.zoom) / 2;
    state.panY = (area.clientHeight - state.pageH * state.zoom) / 2;
    updateZoomUI();
    render();
  }

  function updateZoomUI() {
    const pct = Math.round(state.zoom * 100) + "%";
    document.getElementById("zoomLabel").textContent = pct;
    document.getElementById("stZoom").textContent    = pct;
  }

  // ── Page loading ───────────────────────────────────────────────────────────
  async function goPage(n) {
    if (!state.pdfOpen) return;
    n = Math.max(1, Math.min(state.pageCount, n));
    if (n === state.page && pageImg) return;

    // Auto-save current page before switching
    if (state.dirty) await saveAnnotations(true);

    state.page = n;
    state.selectedId = null;
    cancelDrawing();

    document.getElementById("pageInput").value = n;
    document.getElementById("btnPrev").disabled = n === 1;
    document.getElementById("btnNext").disabled = n === state.pageCount;
    document.getElementById("stPage").textContent = `${n} / ${state.pageCount}`;

    // Load page regions
    const pageKey = String(n);
    state.regions = JSON.parse(JSON.stringify(
      (state.annotations.pages[pageKey] || [])
    ));
    undoStack = []; redoStack = [];
    refreshUndoButtons();

    // Show spinner
    document.getElementById("pageSpinner").classList.add("visible");

    try {
      const result = await pyCall("render_page", n - 1, 150);
      if (result.error) { console.error(result.error); return; }

      const img   = new Image();
      img.src     = `data:image/jpeg;base64,${result.image}`;
      await new Promise(res => { img.onload = res; });

      pageImg      = img;
      state.pageW  = result.width;
      state.pageH  = result.height;

      fitPage();
      render();
      UI.renderRegionList();
      UI.highlightThumb(n);
    } finally {
      document.getElementById("pageSpinner").classList.remove("visible");
    }
  }

  // ── Annotations ────────────────────────────────────────────────────────────
  function commitCurrentPage() {
    const pageKey = String(state.page);
    state.annotations.pages[pageKey] = JSON.parse(JSON.stringify(state.regions));
    // Mark thumb as annotated
    const thumb = document.querySelector(`.thumb-item[data-page="${state.page}"]`);
    if (thumb) thumb.classList.toggle("annotated", state.regions.length > 0);
  }

  async function saveAnnotations(silent = false) {
    commitCurrentPage();
    if (!silent) {
      setSaveState("saving");
    }
    const result = await pyCall("save_annotations", state.annotations);
    if (!result.error) {
      state.dirty = false;
      if (!silent) setSaveState("saved");
    }
    document.getElementById("btnSave").disabled = false;
  }

  function markDirty() {
    state.dirty = true;
    setSaveState("unsaved");
    document.getElementById("stRegions").textContent = state.regions.length;
    // Auto-save debounce (60 s)
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => saveAnnotations(true), 60_000);
  }

  function setSaveState(s) {
    const el   = document.getElementById("saveIndicator");
    const span = document.getElementById("saveText");
    el.className = s;
    span.textContent = { saving: "Saving…", saved: "Saved", unsaved: "Unsaved" }[s] || "";
  }

  function setRegionNote(txt) {
    const r = state.regions.find(r => r.id === state.selectedId);
    if (r) { r.note = txt; markDirty(); }
  }

  // ── Open PDF ───────────────────────────────────────────────────────────────
  async function openPdf(path) {
    document.getElementById("pageSpinner").classList.add("visible");
    const info = await pyCall("open_pdf", path);
    if (info.error) {
      alert("Could not open PDF:\n" + info.error);
      document.getElementById("pageSpinner").classList.remove("visible");
      return;
    }

    state.pdfOpen    = true;
    state.pdfName    = info.name;
    state.pageCount  = info.page_count;
    state.page       = 0;           // force reload
    state.regions    = [];
    state.selectedId = null;

    // Load annotations
    const ann = await pyCall("load_annotations");
    state.annotations = ann.error ? state.annotations : ann;
    if (!state.annotations.labels || !state.annotations.labels.length) {
      state.annotations.labels = defaultLabels();
    }
    state.activeLabel = state.annotations.labels[0].id;

    document.getElementById("pageTotalLabel").textContent = `/ ${info.page_count}`;
    document.getElementById("pageInput").max = info.page_count;
    document.getElementById("btnSave").disabled  = false;
    document.getElementById("btnParse").disabled = false;
    document.getElementById("dropZone").classList.add("hidden");

    UI.renderLabelBar();
    UI.renderLabelManager();
    await UI.buildThumbnails();
    await goPage(1);
  }

  // ── Label helpers ──────────────────────────────────────────────────────────
  function getLabel(id) {
    return state.annotations.labels.find(l => l.id === id) || null;
  }

  function defaultLabels() {
    return [
      { id: "text",    name: "Text",    color: "#22c55e" },
      { id: "heading", name: "Heading", color: "#f59e0b" },
      { id: "table",   name: "Table",   color: "#06b6d4" },
      { id: "image",   name: "Image",   color: "#a78bfa" },
      { id: "ignore",  name: "Ignore",  color: "#ef4444" },
    ];
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  let _uidCtr = 0;
  function uid() { return `r_${Date.now()}_${_uidCtr++}`; }

  function updateStatusBar() {
    if (!state.pdfOpen) return;
    document.getElementById("stRegions").textContent = state.regions.length;
  }

  // ── Python bridge ──────────────────────────────────────────────────────────
  async function pyCall(method, ...args) {
    try {
      if (window.pywebview && window.pywebview.api) {
        return await window.pywebview.api[method](...args);
      }
      // Dev mode — mock
      console.warn(`[DEV] pyCall: ${method}`, args);
      return { error: "pywebview not available" };
    } catch (err) {
      console.error("pyCall error:", err);
      return { error: String(err) };
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Space = temporarily pan
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      if (state.tool !== "pan") {
        state.prevTool = state.tool;
        setTool("pan");
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z") { e.preventDefault(); undo(); return; }
      if (e.key === "y") { e.preventDefault(); redo(); return; }
      if (e.key === "s") { e.preventDefault(); saveAnnotations(); return; }
      if (e.key === "o") { e.preventDefault(); UI.openFile(); return; }
    }

    switch (e.key) {
      case "v": case "V": setTool("select");   break;
      case "r": case "R": setTool("rect");     break;
      case "g": case "G": setTool("polygon");  break;
      case "f": case "F": setTool("freehand"); break;
      case "e": case "E": setTool("eraser");   break;
      case "t": case "T": UI.toggleTheme();   break;
      case "0":           fitPage();           break;
      case "+": case "=": zoom(0.1);           break;
      case "-":           zoom(-0.1);          break;
      case "ArrowRight": case "ArrowDown": goPage(state.page + 1); break;
      case "ArrowLeft":  case "ArrowUp":   goPage(state.page - 1); break;
      case "Escape":      cancelDrawing();      break;
      case "Delete": case "Backspace":
        if (state.selectedId) {
          pushUndo();
          state.regions = state.regions.filter(r => r.id !== state.selectedId);
          state.selectedId = null;
          markDirty(); render(); UI.renderRegionList();
        }
        break;
      default:
        // Number keys → switch label
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < state.annotations.labels.length) {
          state.activeLabel = state.annotations.labels[idx].id;
          UI.renderLabelBar();
        }
    }
  });

  document.addEventListener("keyup", e => {
    if (e.code === "Space" && state.tool === "pan") {
      setTool(state.prevTool || "select");
    }
  });

  // ── Drag & drop PDF ───────────────────────────────────────────────────────
  const canvasArea = document.getElementById("canvasArea");
  canvasArea.addEventListener("dragover", e => {
    e.preventDefault();
    canvasArea.classList.add("drag-over");
  });
  canvasArea.addEventListener("dragleave", () => canvasArea.classList.remove("drag-over"));
  canvasArea.addEventListener("drop", async e => {
    e.preventDefault();
    canvasArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".pdf")) {
      await openPdf(file.path || file.name);
    }
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    state,
    setTool,
    zoom,
    fitPage,
    goPage,
    undo,
    redo,
    saveAnnotations,
    openPdf,
    markDirty,
    commitCurrentPage,
    getLabel,
    render,
    pyCall,
    setRegionNote,
    cancelDrawing,
  };

})();
