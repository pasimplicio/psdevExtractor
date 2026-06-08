'use strict';

window.addEventListener('DOMContentLoaded', () => {

  // LocalidadeDB já carregado via localidade.js (dados embutidos)

  // Arquivos >= este limite usam o modo dois estágios (sample → processar)
  const LARGE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

  // ── Estado global ─────────────────────────────────────────
  const state = {
    rawData:         [],
    headers:         [],
    sampleRows:      [],   // primeiras 500 linhas (detecção de tipos)
    columnTypes:     {},
    filteredIndices: [],
    filters:         {},
    regionalFilter:  { regional: '', gerencia: null },
    localidadeField: null,
    gerenciaField:   null,
    exportCols:      [],
    page:            0,
    pageSize:        100,
    sortCol:         null,
    sortDir:         'asc',
    filename:        '',
    isLargeFile:     false,
    sampled:         false    // true após a fase de sample em arquivos grandes
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const dropZone          = $('drop-zone');
  const fileInput         = $('file-input');
  const fileInfo          = $('file-info');
  const fileNameDisplay   = $('file-name-display');
  const changeFileBtn     = $('change-file-btn');
  const encodingSelect    = $('encoding-select');
  const parseBtn          = $('parse-btn');
  const processBtn        = $('process-btn');
  const largeFileWarning  = $('large-file-warning');
  const progressWrap      = $('progress-container');
  const progressBar       = $('progress-bar');
  const progressLabel     = $('progress-label');
  const filtersPanel      = $('filters-panel');
  const pageSizeSelect    = $('page-size-select');
  const statusRows        = $('status-rows');
  const statusFiltered    = $('status-filtered');
  const statusTime        = $('status-time');
  const detectedDelim     = $('detected-delimiter');
  const themeToggle       = $('theme-toggle');
  const exportBtn         = $('export-btn');
  const colsPanel         = $('cols-panel');
  const colsTags          = $('cols-tags');
  const colsCount         = $('cols-count');
  const colsColSelector   = $('cols-col-selector');
  const colsAddBtn        = $('cols-add-btn');
  const colsClearBtn      = $('cols-clear-btn');
  const regionalSelect    = $('regional-select');
  const regionalInfo      = $('regional-info');
  const clearRegionalBtn  = $('clear-regional-btn');

  const helpBtn      = $('help-btn');
  const helpOverlay  = $('help-overlay');
  const helpClose    = $('help-close');
  const helpCloseBtn = $('help-close-btn');

  let selectedFile = null;

  // ── Ajuda ─────────────────────────────────────────────────
  function openHelp()  { helpOverlay.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeHelp() { helpOverlay.classList.add('hidden');    document.body.style.overflow = ''; }

  helpBtn.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);
  helpCloseBtn.addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHelp(); });

  // ── Tema ──────────────────────────────────────────────────
  // Default: CAEMA light theme. Dark mode toggles on demand.
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark-mode');
    themeToggle.textContent = '☀';
  }
  themeToggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark-mode');
    const isDark = document.documentElement.classList.contains('dark-mode');
    themeToggle.textContent = isDark ? '☀' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });

  // ── Seleção de arquivo ────────────────────────────────────
  dropZone.addEventListener('click', () => fileInput.click());
  changeFileBtn.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
    fileInput.value = '';
  });

  function setFile(file) {
    selectedFile   = file;
    state.filename = file.name;
    fileNameDisplay.textContent = `${file.name}  (${fmtSize(file.size)})`;
    dropZone.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    parseBtn.disabled = false;
    filtersPanel.classList.add('hidden');
    TableView.hide();
    _resetState();
  }

  function _resetState() {
    state.rawData         = [];
    state.headers         = [];
    state.sampleRows      = [];
    state.columnTypes     = {};
    state.filteredIndices = [];
    state.filters         = {};
    state.regionalFilter  = { regional: '', gerencia: null };
    state.localidadeField = null;
    state.gerenciaField   = null;
    state.exportCols      = [];
    state.page            = 0;
    state.sortCol         = null;
    state.sortDir         = 'asc';
    state.isLargeFile     = false;
    state.sampled         = false;
    colsTags.innerHTML    = '';
    colsCount.style.display = 'none';
    detectedDelim.textContent = '';
    largeFileWarning.classList.add('hidden');
    colsPanel.classList.add('hidden');
    filtersPanel.classList.add('hidden');
    ['status-sep1','status-sep2','status-filtered','status-time']
      .forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  }

  // ── Carregar CSV ──────────────────────────────────────────
  parseBtn.addEventListener('click', () => { if (selectedFile) startLoad(); });

  async function startLoad() {
    const t0 = performance.now();
    parseBtn.disabled = true;
    showProgress(0, 'Detectando encoding…');

    let encoding = encodingSelect.value;
    if (encoding === 'auto') encoding = await CsvParser.detectEncoding(selectedFile);

    state.isLargeFile = selectedFile.size >= LARGE_FILE_BYTES;

    if (state.isLargeFile) {
      // ── Arquivo grande: fase 1 — sample ──────────────────
      showProgress(0.1, 'Lendo cabeçalho e amostra…');
      CsvParser.sample({
        file: selectedFile, encoding,
        maxRows: 500,
        onComplete: ({ data, headers, delimiter }) => {
          state.sampleRows  = data;
          state.headers     = headers;
          state.columnTypes = FilterEngine.detectAllTypes(data, headers);
          state.sampled     = true;
          if (delimiter) detectedDelim.textContent = `"${delimiter}"`;

          statusRows.textContent = `${fmtSize(selectedFile.size)} · configure filtros e processe`;
          _showStatusSeparators();

          showProgress(1, 'Amostra carregada — configure filtros e clique em Processar');
          setTimeout(() => {
            hideProgress();
            parseBtn.disabled   = false;
            processBtn.disabled = true; // começa desabilitado até ter filtro
            _setupFiltersUI();
            largeFileWarning.classList.remove('hidden');
          }, 300);
        },
        onError: err => { hideProgress(); parseBtn.disabled = false; showToast('Erro ao carregar: ' + err.message, 'error'); }
      });
    } else {
      // ── Arquivo pequeno: carga completa ───────────────────
      showProgress(0.05, `Lendo CSV (${encoding})…`);
      CsvParser.parse({
        file: selectedFile, encoding,
        filterFn: null,   // sem filtro — carrega tudo na memória
        onProgress: p => showProgress(p * 0.9, 'Parseando…'),
        onComplete: ({ data, headers, delimiter }) => {
          const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
          state.rawData     = data;
          state.headers     = headers;
          state.columnTypes = FilterEngine.detectAllTypes(data, headers);
          if (delimiter) detectedDelim.textContent = `"${delimiter}"`;
          statusRows.textContent = `${data.length.toLocaleString('pt-BR')} linhas`;
          statusTime.textContent = `${elapsed}s`;
          _showStatusSeparators();
          showProgress(1, 'Concluído!');
          setTimeout(() => {
            hideProgress();
            parseBtn.disabled = false;
            _setupFiltersUI();
            _applyAndRender();
          }, 300);
        },
        onError: err => { hideProgress(); parseBtn.disabled = false; showToast('Erro ao carregar: ' + err.message, 'error'); }
      });
    }
  }

  // ── Processar (arquivo grande) ────────────────────────────

  // Atualiza estado do botão Processar conforme filtros ativos
  function _updateProcessBtn() {
    const hasFilter = !!state.regionalFilter.regional;
    processBtn.disabled = !hasFilter;
    processBtn.title    = hasFilter
      ? 'Processar arquivo com o filtro de Regional ativo'
      : 'Selecione uma Regional antes de processar';
  }

  processBtn.addEventListener('click', () => {
    if (!selectedFile) return;
    if (state.isLargeFile && state.sampled) {
      startProcess();
    } else if (!state.isLargeFile) {
      _applyAndRender();
    }
  });

  async function startProcess() {
    if (!state.regionalFilter.regional) return; // segurança extra

    const t0 = performance.now();
    processBtn.disabled = true;
    parseBtn.disabled   = true;
    showProgress(0, 'Preparando filtros…');

    let encoding = encodingSelect.value;
    if (encoding === 'auto') encoding = await CsvParser.detectEncoding(selectedFile);

    // Constrói predicate combinado (filtros de coluna + Regional + Gerência São Luís)
    const colPredicate = FilterEngine.buildPredicate(state.filters);
    const reg          = state.regionalFilter.regional;
    const locField     = state.localidadeField;
    const validIds     = reg ? LocalidadeDB.getIdsByRegional(reg) : null;
    const gerField     = (reg === 'SAO LUIS') ? state.gerenciaField : null;
    const gerCode      = state.regionalFilter.gerencia;

    let filterFn = null;
    if (colPredicate || validIds || gerField) {
      filterFn = row => {
        if (validIds && !validIds.has(String(row[locField] ?? '').trim())) return false;
        if (gerField  && !_matchesSaoLuisGerencia(row[gerField], gerCode)) return false;
        if (colPredicate && !colPredicate(row)) return false;
        return true;
      };
    }

    showProgress(0.02, 'Processando arquivo…');

    CsvParser.parse({
      file: selectedFile, encoding, filterFn,
      onProgress: p => showProgress(p, `Processando… ${Math.round(p * 100)}%`),
      onComplete: ({ data, headers, delimiter }) => {
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
        state.rawData = data;
        if (!state.headers.length) state.headers = headers; // fallback
        if (delimiter) detectedDelim.textContent = `"${delimiter}"`;
        statusRows.textContent = `${(state.isLargeFile ? fmtSize(selectedFile.size) + ' — ' : '') + data.length.toLocaleString('pt-BR')} linhas processadas`;
        statusTime.textContent = `${elapsed}s`;
        _showStatusSeparators();
        showProgress(1, 'Concluído!');
        setTimeout(() => {
          hideProgress();
          processBtn.disabled = false;
          parseBtn.disabled   = false;
          // Índices: aponta para rawData (já filtrado)
          state.filteredIndices = state.rawData.map((_, i) => i);
          statusFiltered.textContent = `${data.length.toLocaleString('pt-BR')} filtradas`;
          _renderTable();
        }, 300);
      },
      onError: err => {
        hideProgress();
        processBtn.disabled = false;
        parseBtn.disabled   = false;
        showToast('Erro ao processar: ' + err.message, 'error');
      }
    });
  }

  // ── Progress ──────────────────────────────────────────────
  function showProgress(pct, label) {
    progressWrap.classList.remove('hidden');
    progressBar.style.width = Math.round(Math.min(1, pct) * 100) + '%';
    if (label) progressLabel.textContent = label;
  }
  function hideProgress() { progressWrap.classList.add('hidden'); }

  function _showStatusSeparators() {
    ['status-sep1','status-sep2','status-filtered','status-time']
      .forEach(id => { const el = $(id); if (el) el.style.display = ''; });
  }

  // ── Filter UI ─────────────────────────────────────────────
  function _setupFiltersUI() {
    _setupColsUI();
    state.localidadeField = _detectLocalidadeField(state.headers);
    state.gerenciaField   = _detectGerenciaField(state.headers);
    state.regionalFilter  = { regional: '' };
    _setupRegionalFilter();
  }

  // ── Campos para exportação ────────────────────────────────
  function _setupColsUI() {
    state.exportCols = [];
    colsTags.innerHTML = '<span class="cols-empty-hint">Nenhum campo selecionado — todos serão exportados</span>';
    colsCount.style.display = 'none';

    colsColSelector.innerHTML = '<option value="">Selecionar campo…</option>';
    for (const h of state.headers) {
      const opt = document.createElement('option');
      opt.value = h; opt.textContent = h;
      colsColSelector.appendChild(opt);
    }
    colsAddBtn.disabled = false;
    colsPanel.classList.remove('hidden');
  }

  colsAddBtn.addEventListener('click', () => {
    const col = colsColSelector.value;
    if (!col || state.exportCols.includes(col)) { colsColSelector.value = ''; return; }
    _addColChip(col);
    colsColSelector.value = '';
  });
  colsColSelector.addEventListener('change', function () { colsAddBtn.disabled = !this.value; });
  colsColSelector.addEventListener('keydown', e => { if (e.key === 'Enter' && colsColSelector.value) colsAddBtn.click(); });

  colsClearBtn.addEventListener('click', () => {
    state.exportCols = [];
    colsTags.innerHTML = '<span class="cols-empty-hint">Nenhum campo selecionado — todos serão exportados</span>';
    colsCount.style.display = 'none';
    colsColSelector.value = '';
    colsAddBtn.disabled = true;
    _renderTable();
  });

  function _addColChip(col) {
    const hint = colsTags.querySelector('.cols-empty-hint');
    if (hint) hint.remove();
    state.exportCols.push(col);

    const tag = document.createElement('span');
    tag.className   = 'col-tag';
    tag.dataset.col = col;
    tag.title       = col;
    tag.innerHTML   = `<span class="tag-hash">#</span><span class="tag-label">${_esc(col)}</span><button class="tag-remove" title="Remover">×</button>`;
    tag.querySelector('.tag-remove').addEventListener('click', () => {
      state.exportCols = state.exportCols.filter(c => c !== col);
      tag.remove();
      if (state.exportCols.length === 0) {
        colsTags.innerHTML = '<span class="cols-empty-hint">Nenhum campo selecionado — todos serão exportados</span>';
        colsCount.style.display = 'none';
      } else {
        colsCount.textContent = state.exportCols.length;
      }
      _renderTable();
    });

    colsTags.appendChild(tag);
    colsCount.textContent   = state.exportCols.length;
    colsCount.style.display = '';
    colsCount.className     = 'badge active';
    _renderTable();
  }

  // ── Regional filter ───────────────────────────────────────
  function _detectLocalidadeField(headers) {
    const norm = s => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    const targets = new Set([
      'localidade', 'codigolocalidade', 'cdlocalidade',
      'codlocalidade', 'idlocalidade', 'codigodolocalidade'
    ]);
    for (const h of headers) {
      if (targets.has(norm(h))) return h;
    }
    return null;
  }

  function _detectGerenciaField(headers) {
    const norm = s => s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
    for (const h of headers) {
      if (norm(h) === 'gerencia') return h;
    }
    return null;
  }

  // Gerências da regional SAO LUIS (prefixo numérico do campo GERENCIA no CSV)
  const _SAO_LUIS_GER = new Set(['11','12','13','14','15']);
  const _SAO_LUIS_GER_OPTS = [
    { code: '11', label: '11-CENTRO' },
    { code: '12', label: '12-VINHAIS' },
    { code: '13', label: '13-COHAB' },
    { code: '14', label: '14-CIDADE OPERARIA' },
    { code: '15', label: '15-ANJO DA GUARDA' },
  ];

  function _matchesSaoLuisGerencia(val, specificCode) {
    const m = String(val ?? '').trim().match(/^(\d+)/);
    if (!m) return false;
    return specificCode ? m[1] === specificCode : _SAO_LUIS_GER.has(m[1]);
  }

  function _setupRegionalFilter() {
    if (!state.localidadeField) { filtersPanel.classList.add('hidden'); return; }
    regionalSelect.innerHTML = '<option value="">Todas as Regionais</option>';
    for (const r of LocalidadeDB.getRegionais()) {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      regionalSelect.appendChild(opt);
      if (r === 'SAO LUIS') {
        for (const { code, label } of _SAO_LUIS_GER_OPTS) {
          const sub = document.createElement('option');
          sub.value = `SAO LUIS;${code}`;
          sub.textContent = `  ↳ ${label}`;
          regionalSelect.appendChild(sub);
        }
      }
    }
    regionalSelect.value = '';
    filtersPanel.classList.remove('hidden');
    _updateRegionalInfo();
    _updateProcessBtn();
  }

  function _parseRegionalValue(val) {
    if (!val) return { regional: '', gerencia: null };
    if (val.includes(';')) {
      const [reg, ger] = val.split(';');
      return { regional: reg, gerencia: ger };
    }
    return { regional: val, gerencia: null };
  }

  regionalSelect.addEventListener('change', function () {
    const parsed = _parseRegionalValue(this.value);
    state.regionalFilter.regional = parsed.regional;
    state.regionalFilter.gerencia = parsed.gerencia;
    _updateRegionalInfo();
    state.page = 0;
    if (!state.isLargeFile) _applyAndRender();
    _updateProcessBtn();
  });

  clearRegionalBtn.addEventListener('click', () => {
    state.regionalFilter.regional = '';
    state.regionalFilter.gerencia = null;
    regionalSelect.value = '';
    _updateRegionalInfo();
    state.page = 0;
    if (!state.isLargeFile) _applyAndRender();
    _updateProcessBtn();
  });

  function _updateRegionalInfo() {
    const reg = state.regionalFilter.regional;
    const ger = state.regionalFilter.gerencia;
    if (reg) {
      const count = LocalidadeDB.getIdsByRegional(reg).size;
      const gerLabel = ger ? ` — Gerência ${ger}` : '';
      regionalInfo.textContent       = `${count} localidade${count !== 1 ? 's' : ''}${gerLabel}`;
      regionalInfo.style.display     = '';
      clearRegionalBtn.style.display = '';
    } else {
      regionalInfo.style.display     = 'none';
      clearRegionalBtn.style.display = 'none';
    }
  }

  // ── Sort & Page ───────────────────────────────────────────
  TableView.init({
    onSortChange(col) {
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = 'asc';
      }
      state.page = 0;
      if (state.isLargeFile) _renderTable(); else _applyAndRender();
    },
    onPageChange(p) { state.page = p; _renderTable(); }
  });

  pageSizeSelect.addEventListener('change', () => {
    state.pageSize = parseInt(pageSizeSelect.value, 10);
    state.page     = 0;
    _renderTable();
  });

  // ── Aplicar filtros em memória (arquivos pequenos) ────────
  function _applyAndRender() {
    if (!state.rawData.length) return;

    let indices = FilterEngine.applyFilters(state.rawData, state.filters);

    const reg = state.regionalFilter.regional;
    if (state.localidadeField && reg) {
      const validIds = LocalidadeDB.getIdsByRegional(reg);
      indices = indices.filter(i =>
        validIds.has(String(state.rawData[i][state.localidadeField] ?? '').trim())
      );
    }

    if (reg === 'SAO LUIS' && state.gerenciaField) {
      const gerCode = state.regionalFilter.gerencia;
      indices = indices.filter(i =>
        _matchesSaoLuisGerencia(state.rawData[i][state.gerenciaField], gerCode)
      );
    }

    if (state.sortCol) {
      const col  = state.sortCol;
      const type = state.columnTypes[col] || 'text';
      const dir  = state.sortDir === 'asc' ? 1 : -1;
      indices.sort((a, b) => {
        const va = state.rawData[a][col] ?? '';
        const vb = state.rawData[b][col] ?? '';
        if (type === 'number') {
          const na = parseFloat(String(va).replace(/\./g, '').replace(',', '.'));
          const nb = parseFloat(String(vb).replace(/\./g, '').replace(',', '.'));
          if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
        }
        return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir;
      });
    }

    state.filteredIndices = indices;
    statusFiltered.textContent = `${indices.length.toLocaleString('pt-BR')} filtradas`;
    _renderTable();
  }

  function _renderTable() {
    // Para arquivos grandes, sort é aplicado sobre rawData diretamente
    let filteredIndices = state.filteredIndices;
    if (state.isLargeFile && state.sortCol) {
      const col  = state.sortCol;
      const type = state.columnTypes[col] || 'text';
      const dir  = state.sortDir === 'asc' ? 1 : -1;
      filteredIndices = [...state.filteredIndices].sort((a, b) => {
        const va = state.rawData[a][col] ?? '';
        const vb = state.rawData[b][col] ?? '';
        if (type === 'number') {
          const na = parseFloat(String(va).replace(/\./g, '').replace(',', '.'));
          const nb = parseFloat(String(vb).replace(/\./g, '').replace(',', '.'));
          if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
        }
        return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir;
      });
    }

    const visibleHeaders = state.exportCols.length > 0 ? state.exportCols : state.headers;
    TableView.render({
      data:            state.rawData,
      headers:         visibleHeaders,
      filteredIndices: filteredIndices,
      page:            state.page,
      pageSize:        state.pageSize,
      sortCol:         state.sortCol,
      sortDir:         state.sortDir
    });
  }

  // ── Export ────────────────────────────────────────────────
  const exportProgress      = $('export-progress');
  const exportProgressBar   = $('export-progress-bar');
  const exportProgressLabel = $('export-progress-label');

  function _setExportProgress(p) {
    const pct = Math.round(p * 100);
    exportProgressBar.style.setProperty('--export-pct', pct + '%');
    exportProgressLabel.textContent = pct + '%';
  }

  function _showExportProgress() {
    _setExportProgress(0);
    exportProgress.classList.remove('hidden');
  }

  function _hideExportProgress() {
    exportProgress.classList.add('hidden');
    _setExportProgress(0);
  }

  exportBtn.addEventListener('click', async () => {
    if (!state.filteredIndices.length) {
      showToast('Nenhuma linha para exportar.', 'warning');
      return;
    }
    exportBtn.disabled  = true;
    exportBtn.innerHTML = '⏳ Exportando…';
    _showExportProgress();

    const headersToExport = state.exportCols.length > 0 ? state.exportCols : state.headers;
    try {
      await Exporter.exportToXlsx({
        data:            state.rawData,
        headers:         headersToExport,
        filteredIndices: state.filteredIndices,
        filename:        state.filename,
        onProgress:      p => _setExportProgress(p)
      });
      setTimeout(() => {
        _hideExportProgress();
        exportBtn.disabled  = false;
        exportBtn.innerHTML = '⬇ Exportar para Excel';
      }, 600);
    } catch (err) {
      showToast('Erro ao exportar: ' + (err.message || err), 'error');
      _hideExportProgress();
      exportBtn.disabled  = false;
      exportBtn.innerHTML = '⬇ Exportar para Excel';
    }
  });

  // ── Helpers ───────────────────────────────────────────────
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtSize(bytes) {
    if (bytes < 1024)          return bytes + ' B';
    if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024**3)       return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024**3).toFixed(2) + ' GB';
  }

});
