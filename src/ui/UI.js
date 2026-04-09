import { TOOLS } from '../tools/tools.js';

export class UI {
  constructor({ onToolChange, onBrushRadius, onBrushStrength, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onTreeDensity, onToggleWireframe }) {
    this.callbacks = { onToolChange, onBrushRadius, onBrushStrength, onSeaLevel, onBaseElevation, onUndo, onRedo, onReset, onTreeDensity, onToggleWireframe };
    this.activeToolKey = 'raise';
    this._build();
    this._bindKeys();
  }

  setUndoRedoState(canUndo, canRedo) {
    this.undoBtn.classList.toggle('disabled', !canUndo);
    this.redoBtn.classList.toggle('disabled', !canRedo);
  }

  _build() {
    const sidebar = document.getElementById('sidebar');

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

    // Brush settings
    const brushLabel = document.createElement('div');
    brushLabel.className = 'section-label';
    brushLabel.textContent = 'Brush';
    sidebar.appendChild(brushLabel);

    this.radiusSlider = this._slider(sidebar, 'Size', 1, 40, 8, (v) => {
      this.callbacks.onBrushRadius(v);
    });

    this.strengthSlider = this._slider(sidebar, 'Strength', 0.05, 2.0, 0.6, (v) => {
      this.callbacks.onBrushStrength(v);
    }, 0.05);

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
    const wireframeCheckbox = document.createElement('input');
    wireframeCheckbox.type = 'checkbox';
    wireframeCheckbox.addEventListener('change', (e) => {
      if (this.callbacks.onToggleWireframe) {
        this.callbacks.onToggleWireframe(e.target.checked);
      }
    });
    wireframeLabel.appendChild(wireframeCheckbox);
    wireframeRow.appendChild(wireframeLabel);
    sidebar.appendChild(wireframeRow);

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

    // Keyboard hint
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.innerHTML = '<b>Shortcuts</b><br>1-7 Tools · Ctrl+Z Undo<br>Ctrl+Shift+Z Redo · [ ] Brush Size';
    sidebar.appendChild(hint);
  }

  _selectTool(key) {
    this.activeToolKey = key;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tool-btn[data-tool="${key}"]`).classList.add('active');
    this.callbacks.onToolChange(key);
  }

  _slider(parent, label, min, max, initial, onChange, step = 1) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';

    const lbl = document.createElement('label');
    const valSpan = document.createElement('span');
    valSpan.className = 'slider-value';
    valSpan.textContent = initial;
    lbl.innerHTML = `${label} `;
    lbl.appendChild(valSpan);

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

    wrap.appendChild(lbl);
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
      // Brush size with [ ]
      if (e.key === '[') {
        const v = Math.max(1, parseFloat(this.radiusSlider.value) - 2);
        this.radiusSlider.value = v;
        this.radiusSlider.dispatchEvent(new Event('input'));
      }
      if (e.key === ']') {
        const v = Math.min(40, parseFloat(this.radiusSlider.value) + 2);
        this.radiusSlider.value = v;
        this.radiusSlider.dispatchEvent(new Event('input'));
      }
    });
  }
}
