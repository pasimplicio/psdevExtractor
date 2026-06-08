'use strict';

/**
 * TableView — renders a paginated, sortable table from dynamic column data.
 * Only renders the rows visible on the current page (~100 at a time).
 */
const TableView = (() => {

  let _onSortChange = null;
  let _onPageChange = null;

  // ── DOM helpers ───────────────────────────────────────────
  const $ = id => document.getElementById(id);

  function init({ onSortChange, onPageChange }) {
    _onSortChange = onSortChange;
    _onPageChange = onPageChange;
  }

  /**
   * Render the table for the given state snapshot.
   * @param {object} opts
   * @param {object[]} opts.data            - full dataset
   * @param {string[]} opts.headers         - column names (dynamic)
   * @param {number[]} opts.filteredIndices - row indices that passed filters
   * @param {number}   opts.page
   * @param {number}   opts.pageSize
   * @param {string}   opts.sortCol
   * @param {string}   opts.sortDir         - 'asc' | 'desc'
   */
  function render({ data, headers, filteredIndices, page, pageSize, sortCol, sortDir }) {
    const total    = data.length;
    const filtered = filteredIndices.length;
    const start    = page * pageSize;
    const end      = Math.min(start + pageSize, filtered);
    const pageRows = filteredIndices.slice(start, end);

    _renderTable(headers, pageRows, data, sortCol, sortDir);
    _renderPagination(filtered, page, pageSize);
    _renderCounter(total, filtered, start, end);

    $('table-container').classList.remove('hidden');
  }

  function hide() {
    $('table-container').classList.add('hidden');
  }

  // ── Table body ────────────────────────────────────────────
  function _renderTable(headers, pageRows, data, sortCol, sortDir) {
    const table = $('data-table');
    table.innerHTML = '';

    // thead
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');

    // Fixed row-number column
    const thNum = document.createElement('th');
    thNum.innerHTML = '<div class="th-inner"><span class="th-text">#</span></div>';
    thNum.className = 'col-rownum';
    thNum.title = 'Número da linha no CSV original';
    htr.appendChild(thNum);

    for (const h of headers) {
      const th = document.createElement('th');
      const isSorted = sortCol === h;
      const icon = isSorted
        ? `<span class="sort-icon active">${sortDir === 'asc' ? '▲' : '▼'}</span>`
        : `<span class="sort-icon">⇅</span>`;
      th.innerHTML = `<div class="th-inner"><span class="th-text">${_esc(h)}</span>${icon}</div>`;
      th.title = h;
      th.addEventListener('click', () => _onSortChange && _onSortChange(h));
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');

    if (pageRows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = headers.length + 1;
      td.className = 'empty-msg';
      td.textContent = 'Nenhuma linha corresponde aos filtros aplicados.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      // Use a DocumentFragment for performance
      const frag = document.createDocumentFragment();
      for (const idx of pageRows) {
        const row = data[idx];
        const tr = document.createElement('tr');

        // Row number cell (1-based index in original dataset)
        const tdNum = document.createElement('td');
        tdNum.textContent = idx + 1;
        tdNum.className = 'col-rownum';
        tr.appendChild(tdNum);

        for (const h of headers) {
          const td = document.createElement('td');
          const val = row[h] ?? '';
          td.textContent = val;
          if (String(val).length > 60) td.title = val;
          tr.appendChild(td);
        }
        frag.appendChild(tr);
      }
      tbody.appendChild(frag);
    }

    table.appendChild(tbody);
  }

  // ── Pagination ────────────────────────────────────────────
  function _renderPagination(total, page, pageSize) {
    const el = $('pagination');
    el.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (totalPages <= 1) return;

    // Prev
    const prev = _pageBtn('← Anterior', page === 0, () => _onPageChange && _onPageChange(page - 1));
    el.appendChild(prev);

    // Page numbers — show a window of up to 7 pages
    const winStart = Math.max(0, Math.min(page - 3, totalPages - 7));
    const winEnd   = Math.min(totalPages, winStart + 7);

    if (winStart > 0) {
      el.appendChild(_pageBtn('1', false, () => _onPageChange && _onPageChange(0)));
      if (winStart > 1) {
        const dots = document.createElement('span');
        dots.textContent = '…';
        dots.style.cssText = 'color:var(--text3);padding:0 0.3rem;align-self:center;';
        el.appendChild(dots);
      }
    }

    for (let p = winStart; p < winEnd; p++) {
      const b = _pageBtn(String(p + 1), false, () => _onPageChange && _onPageChange(p));
      if (p === page) b.classList.add('active');
      el.appendChild(b);
    }

    if (winEnd < totalPages) {
      if (winEnd < totalPages - 1) {
        const dots = document.createElement('span');
        dots.textContent = '…';
        dots.style.cssText = 'color:var(--text3);padding:0 0.3rem;align-self:center;';
        el.appendChild(dots);
      }
      el.appendChild(_pageBtn(String(totalPages), false, () => _onPageChange && _onPageChange(totalPages - 1)));
    }

    // Next
    const next = _pageBtn('Próxima →', page >= totalPages - 1, () => _onPageChange && _onPageChange(page + 1));
    el.appendChild(next);
  }

  function _pageBtn(label, disabled, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'page-btn';
    b.disabled = disabled;
    if (!disabled) b.addEventListener('click', onClick);
    return b;
  }

  // ── Counter ───────────────────────────────────────────────
  function _renderCounter(total, filtered, start, end) {
    const el = $('row-counter');
    if (!el) return;
    if (filtered === 0) {
      el.textContent = `Nenhuma linha encontrada · ${total.toLocaleString('pt-BR')} no total`;
    } else {
      el.textContent =
        `Mostrando ${(start + 1).toLocaleString('pt-BR')}–${end.toLocaleString('pt-BR')} ` +
        `de ${filtered.toLocaleString('pt-BR')} filtradas ` +
        `(${total.toLocaleString('pt-BR')} total)`;
    }
  }

  // ── Escape HTML ───────────────────────────────────────────
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, render, hide };
})();
