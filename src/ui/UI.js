import { TOOLS } from '../tools/tools.js';

export class UI {
  constructor({ onToolChange, onBrushRadius, onBrushStrength, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds }) {
    this.callbacks = { onToolChange, onBrushRadius, onBrushStrength, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onSave, onLoad, onTreeDensity, onToggleWireframe, onToggleSnow, onToggleClouds };
    this.activeToolKey = 'raise';
    this._build();
    this._bindKeys();
  }

  setUndoRedoState(canUndo, canRedo) {
    this.undoBtn.classList.toggle('disabled', !canUndo);
    this.redoBtn.classList.toggle('disabled', !canRedo);
  }

  setSeaLevelSlider(val) {
    this.seaLevelSlider.value = val;
    if (this.seaLevelSlider.valSpan) {
      this.seaLevelSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(2);
    }
  }

  setBaseElevationSlider(val) {
    this.baseElevationSlider.value = val;
    if (this.baseElevationSlider.valSpan) {
      this.baseElevationSlider.valSpan.textContent = Number.isInteger(val) ? val : parseFloat(val).toFixed(2);
    }
  }

  _build() {
    const sidebar = document.getElementById('sidebar');

    // Create topbar
    const topbar = document.createElement('div');
    topbar.id = 'topbar';
    document.body.appendChild(topbar);

    const topbarSliders = document.createElement('div');
    topbarSliders.style.display = 'flex';
    topbarSliders.style.flexDirection = 'row';
    topbarSliders.style.gap = '32px';
    topbar.appendChild(topbarSliders);

    // Title
    const title = document.createElement('div');
    title.className = 'sidebar-title';
    title.innerHTML = '<span class="logo-icon">🏔️</span> LandScraper';
    sidebar.appendChild(title);

    // Subtitle
    const sub = document.createElement('div');
    sub.className = 'sidebar-subtitle';
    sub.textContent = 'Terrain Sculptor';
    sidebar.appendChild(sub);

    // Divider
    sidebar.appendChild(this._divider());

    // Tool grid
    const toolLabel = document.createElement('div');
    toolLabel.className = 'section-label';
    toolLabel.textContent = 'Tools';
    sidebar.appendChild(toolLabel);

    const toolGrid = document.createElement('div');
    toolGrid.className = 'tool-grid';
    const toolKeys = Object.keys(TOOLS);
    toolKeys.forEach((key, idx) => {
      const t = TOOLS[key];
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (key === this.activeToolKey ? ' active' : '');
      btn.dataset.tool = key;
      btn.innerHTML = `<span class="tool-icon">${t.icon}</span><span class="tool-name">${t.name}</span>`;
      btn.style.setProperty('--tool-color', t.color);
      btn.title = `${t.name} (${idx + 1})`;
      btn.addEventListener('click', () => this._selectTool(key));
      toolGrid.appendChild(btn);
    });
    sidebar.appendChild(toolGrid);

    sidebar.appendChild(this._divider());

    // Brush settings (in topbar)
    this.radiusSlider = this._slider(topbarSliders, 'Brush Size', 1, 100, 16, (v) => {
      this.callbacks.onBrushRadius(v);
    }, 1, '<b>[</b> and <b>]</b>');

    this.strengthSlider = this._slider(topbarSliders, 'Strength', 0.05, 2.0, 0.6, (v) => {
      this.callbacks.onBrushStrength(v);
    }, 0.05, '<b>Cmd/Ctrl + [</b> and <b>]</b>');

    // Tree settings (in sidebar)
    const brushLabel = document.createElement('div');
    brushLabel.className = 'section-label';
    brushLabel.textContent = 'Tree Tool Options';
    sidebar.appendChild(brushLabel);

    this.treeDensitySlider = this._slider(sidebar, 'Tree Density', 1, 10, 5, (v) => {
      this.callbacks.onTreeDensity(v);
    });

    sidebar.appendChild(this._divider());

    // Sea level
    const waterLabel = document.createElement('div');
    waterLabel.className = 'section-label';
    waterLabel.textContent = 'Global Height';
    sidebar.appendChild(waterLabel);

    this.baseElevationSlider = this._slider(sidebar, 'Base Elevation', -30, 60, 0, (v) => {
      this.callbacks.onBaseElevation(v);
    }, 1);

    this.seaLevelSlider = this._slider(sidebar, 'Sea Level', -10, 20, -1, (v) => {
      this.callbacks.onSeaLevel(v);
    }, 0.5);

    // Wireframe Toggle
    const wireframeRow = document.createElement('div');
    wireframeRow.className = 'slider-group';
    const wireframeLabel = document.createElement('label');
    wireframeLabel.style.display = 'flex';
    wireframeLabel.style.justifyContent = 'space-between';
    wireframeLabel.style.width = '100%';
    wireframeLabel.style.cursor = 'pointer';
    wireframeLabel.innerHTML = '<span>Show Grid</span>';
    this.wireframeCheckbox = document.createElement('input');
    this.wireframeCheckbox.type = 'checkbox';
    this.wireframeCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleWireframe) {
        this.callbacks.onToggleWireframe(e.target.checked);
      }
    });
    wireframeLabel.appendChild(this.wireframeCheckbox);
    wireframeRow.appendChild(wireframeLabel);
    sidebar.appendChild(wireframeRow);

    // Snow Toggle
    const snowRow = document.createElement('div');
    snowRow.className = 'slider-group';
    const snowLabel = document.createElement('label');
    snowLabel.style.display = 'flex';
    snowLabel.style.justifyContent = 'space-between';
    snowLabel.style.width = '100%';
    snowLabel.style.cursor = 'pointer';
    snowLabel.innerHTML = '<span>❄️ Let it Snow!</span>';
    const snowCheckbox = document.createElement('input');
    snowCheckbox.type = 'checkbox';
    snowCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleSnow) {
        this.callbacks.onToggleSnow(e.target.checked);
      }
    });
    snowLabel.appendChild(snowCheckbox);
    snowRow.appendChild(snowLabel);
    sidebar.appendChild(snowRow);

    // Clouds Toggle
    const cloudsRow = document.createElement('div');
    cloudsRow.className = 'slider-group';
    const cloudsLabel = document.createElement('label');
    cloudsLabel.style.display = 'flex';
    cloudsLabel.style.justifyContent = 'space-between';
    cloudsLabel.style.width = '100%';
    cloudsLabel.style.cursor = 'pointer';
    cloudsLabel.innerHTML = '<span>☁️ Snow Clouds</span>';
    const cloudsCheckbox = document.createElement('input');
    cloudsCheckbox.type = 'checkbox';
    cloudsCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleClouds) {
        this.callbacks.onToggleClouds(e.target.checked);
      }
    });
    cloudsLabel.appendChild(cloudsCheckbox);
    cloudsRow.appendChild(cloudsLabel);
    sidebar.appendChild(cloudsRow);

    sidebar.appendChild(this._divider());

    // Undo / Redo
    const historyRow = document.createElement('div');
    historyRow.className = 'history-row';

    this.undoBtn = document.createElement('button');
    this.undoBtn.className = 'history-btn disabled';
    this.undoBtn.innerHTML = '↩ Undo';
    this.undoBtn.addEventListener('click', () => this.callbacks.onUndo());

    this.redoBtn = document.createElement('button');
    this.redoBtn.className = 'history-btn disabled';
    this.redoBtn.innerHTML = 'Redo ↪';
    this.redoBtn.addEventListener('click', () => this.callbacks.onRedo());

    historyRow.appendChild(this.undoBtn);
    historyRow.appendChild(this.redoBtn);
    sidebar.appendChild(historyRow);

    // Start Fresh button
    sidebar.appendChild(this._divider());

    const resetBtn = document.createElement('button');
    resetBtn.className = 'reset-btn';
    resetBtn.innerHTML = '🔄 Start Fresh';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset everything? This will clear the terrain and all trees.')) {
        this.callbacks.onReset();
      }
    });
    sidebar.appendChild(resetBtn);

    sidebar.appendChild(this._divider());

    // Save / Load Map
    const saveLoadRow = document.createElement('div');
    saveLoadRow.className = 'history-row';

    this.saveBtn = document.createElement('button');
    this.saveBtn.className = 'history-btn';
    this.saveBtn.innerHTML = '💾 Save';
    this.saveBtn.title = 'Saves to current file (Ctrl+S)';
    this.saveBtn.addEventListener('click', () => {
      if (this.callbacks.onSave) this.callbacks.onSave(false);
    });

    const saveAsBtn = document.createElement('button');
    saveAsBtn.className = 'history-btn';
    saveAsBtn.innerHTML = '💾 Save As...';
    saveAsBtn.style.fontSize = '0.75rem'; // Make it slightly smaller to fit
    saveAsBtn.addEventListener('click', () => {
      if (this.callbacks.onSave) this.callbacks.onSave(true);
    });

    const loadBtn = document.createElement('button');
    loadBtn.className = 'history-btn';
    loadBtn.innerHTML = '📂 Load';
    loadBtn.addEventListener('click', () => {
      if (this.callbacks.onLoad) this.callbacks.onLoad();
    });

    saveLoadRow.appendChild(this.saveBtn);
    saveLoadRow.appendChild(saveAsBtn);
    saveLoadRow.appendChild(loadBtn);
    sidebar.appendChild(saveLoadRow);

    // Instructions & Shortcuts
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = `
      <b>Camera Navigation</b><br>
      • <b>Right Drag:</b> Pan<br>
      • <b>Alt/Cmd + Left Drag:</b> Rotate<br>
      • <b>Scroll Wheel:</b> Zoom<br>
      • <b>Arrows / W / S:</b> Keyboard Pan<br><br>
      <b>Building & Tools</b><br>
      • <b>Chairlift:</b> Click once for base, again for top<br>
      • <b>Shortcuts:</b> 1-9 Tools · [ ] Size · Cmd+[ ] Strength<br>
      • <b>System:</b> Ctrl+Z Undo · Ctrl+S Save
    `;
    sidebar.appendChild(hint);
  }

  _selectTool(key) {
    this.activeToolKey = key;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tool-btn[data-tool="${key}"]`).classList.add('active');
    this.callbacks.onToolChange(key);
  }

  _slider(parent, label, min, max, initial, onChange, step = 1, hintText = null) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';

    const lblWrap = document.createElement('div');
    lblWrap.style.display = 'flex';
    lblWrap.style.flexDirection = 'column';
    lblWrap.style.gap = '2px';
    lblWrap.style.alignItems = 'flex-start';

    const lbl = document.createElement('label');
    lbl.style.gap = '8px'; // Add space between label and value
    const valSpan = document.createElement('span');
    valSpan.className = 'slider-value';
    valSpan.textContent = initial;
    lbl.innerHTML = `<span>${label}</span>`;
    lbl.appendChild(valSpan);
    lblWrap.appendChild(lbl);

    if (hintText) {
      const hint = document.createElement('div');
      hint.innerHTML = hintText;
      hint.style.fontSize = '0.65rem';
      hint.style.color = 'var(--text-dim)';
      lblWrap.appendChild(hint);
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = initial;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = Number.isInteger(v) ? v : v.toFixed(2);
      onChange(v);
    });

    input.valSpan = valSpan;

    wrap.appendChild(lblWrap);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }

  _divider() {
    const d = document.createElement('div');
    d.className = 'divider';
    return d;
  }

  _bindKeys() {
    const toolKeys = Object.keys(TOOLS);
    window.addEventListener('keydown', (e) => {
      // Number keys 1-9, plus 0 for tool 10
      let num = parseInt(e.key);
      if (num === 0) num = 10;
      if (!isNaN(num) && num >= 1 && num <= toolKeys.length) {
        this._selectTool(toolKeys[num - 1]);
        return;
      }
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.callbacks.onRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.callbacks.onUndo();
      }
      // Save Shortcut
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.callbacks.onSave();
      }
      // Grid Toggle Shortcut
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (this.wireframeCheckbox) {
          this.wireframeCheckbox.checked = !this.wireframeCheckbox.checked;
          this.wireframeCheckbox.dispatchEvent(new Event('change'));
        }
      }
      // Brush size with [ ] or strength with Cmd+[ ]
      if (e.metaKey && e.key === '[') {
        e.preventDefault();
        const v = Math.max(0.05, parseFloat(this.strengthSlider.value) - 0.1);
        this.strengthSlider.value = v;
        this.strengthSlider.dispatchEvent(new Event('input'));
      } else if (e.metaKey && e.key === ']') {
        e.preventDefault();
        const v = Math.min(2.0, parseFloat(this.strengthSlider.value) + 0.1);
        this.strengthSlider.value = v;
        this.strengthSlider.dispatchEvent(new Event('input'));
      } else if (e.key === '[') {
        const v = Math.max(1, parseFloat(this.radiusSlider.value) - 4);
        this.radiusSlider.value = v;
        this.radiusSlider.dispatchEvent(new Event('input'));
      } else if (e.key === ']') {
        const v = Math.min(100, parseFloat(this.radiusSlider.value) + 4);
        this.radiusSlider.value = v;
        this.radiusSlider.dispatchEvent(new Event('input'));
      }
    });
  }

  showSaveSuccess() {
    if (this.saveBtn) {
      const oldText = this.saveBtn.innerHTML;
      this.saveBtn.innerHTML = '✅ Saved!';
      setTimeout(() => {
        this.saveBtn.innerHTML = oldText;
      }, 2000);
    }
  }
}
