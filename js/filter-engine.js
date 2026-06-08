'use strict';

/**
 * FilterEngine — detects column types and applies multi-column filters.
 * Columns are dynamic (discovered from the CSV header row).
 */
const FilterEngine = (() => {

  // ── Number parsing (supports BR format: 1.234,56) ────────
  function toNumber(v) {
    if (v === null || v === undefined || v === '') return NaN;
    const s = String(v).trim()
      .replace(/\./g, '')   // remove thousand separator
      .replace(',', '.');   // convert decimal comma
    return parseFloat(s);
  }

  // ── Date parsing (ISO and BR dd/mm/yyyy) ──────────────────
  function toDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    // BR format: dd/mm/yyyy or d/m/yyyy
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) {
      const d = new Date(`${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}T00:00:00`);
      return isNaN(d) ? null : d;
    }
    // ISO or other parseable format
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // ── Column type detection ─────────────────────────────────
  function detectColumnType(data, column) {
    const sample = [];
    for (let i = 0; i < data.length && sample.length < 200; i++) {
      const v = data[i][column];
      if (v !== null && v !== undefined && v !== '') sample.push(v);
    }
    if (sample.length === 0) return 'text';

    const numOk = sample.filter(v => !isNaN(toNumber(v))).length;
    if (numOk / sample.length >= 0.8) return 'number';

    const dateOk = sample.filter(v => toDate(v) !== null).length;
    if (dateOk / sample.length >= 0.8) return 'date';

    return 'text';
  }

  function detectAllTypes(data, headers) {
    const types = {};
    for (const h of headers) types[h] = detectColumnType(data, h);
    return types;
  }

  // ── Single-cell filter matching ───────────────────────────
  function matchFilter(value, filter) {
    const { type, operator, value: fv, value2: fv2 } = filter;

    if (type === 'text') {
      const v = String(value ?? '').toLowerCase();
      const f = String(fv ?? '').toLowerCase();
      switch (operator) {
        case 'contains':     return v.includes(f);
        case 'not_contains': return !v.includes(f);
        case 'equals':       return v === f;
        case 'not_equals':   return v !== f;
        case 'starts_with':  return v.startsWith(f);
        case 'ends_with':    return v.endsWith(f);
        case 'regex':
          try { return new RegExp(fv, 'i').test(String(value ?? '')); }
          catch { return false; }
        default: return true;
      }
    }

    if (type === 'number') {
      const v  = toNumber(value);
      const f  = parseFloat(String(fv).replace(',', '.'));
      const f2 = parseFloat(String(fv2 ?? '').replace(',', '.'));
      if (isNaN(v) || isNaN(f)) return false;
      switch (operator) {
        case 'eq':      return v === f;
        case 'neq':     return v !== f;
        case 'gt':      return v > f;
        case 'lt':      return v < f;
        case 'gte':     return v >= f;
        case 'lte':     return v <= f;
        case 'between': return !isNaN(f2) && v >= f && v <= f2;
        default: return true;
      }
    }

    if (type === 'date') {
      const v  = toDate(value);
      const f  = toDate(fv);
      const f2 = toDate(fv2);
      if (!v || !f) return false;
      // Compare at day granularity
      const vt  = v.getTime();
      const ft  = f.getTime();
      const f2t = f2 ? f2.getTime() : NaN;
      switch (operator) {
        case 'before':  return vt < ft;
        case 'after':   return vt > ft;
        case 'equals':  return v.toDateString() === f.toDateString();
        case 'between': return !isNaN(f2t) && vt >= ft && vt <= f2t;
        default: return true;
      }
    }

    return true;
  }

  /**
   * Apply all active filters (AND logic between columns).
   * @param {object[]} data       - full dataset
   * @param {object}   filters    - { colName: { type, operator, value, value2 } }
   * @returns {number[]}          - indices of rows that pass all filters
   */
  function applyFilters(data, filters) {
    const active = Object.entries(filters).filter(([, f]) => f && f.value !== '' && f.value !== undefined);

    if (active.length === 0) {
      // No filters → return all indices
      return Array.from({ length: data.length }, (_, i) => i);
    }

    const result = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      let pass = true;
      for (const [col, filter] of active) {
        if (!matchFilter(row[col], filter)) { pass = false; break; }
      }
      if (pass) result.push(i);
    }
    return result;
  }

  /**
   * Retorna uma função (row) => bool combinando todos os filtros ativos.
   * Usada no streaming de arquivos grandes para filtrar on-the-fly.
   * Retorna null se não houver filtros ativos.
   */
  function buildPredicate(filters) {
    const active = Object.entries(filters)
      .filter(([, f]) => f && f.value !== '' && f.value !== undefined);
    if (active.length === 0) return null;
    return row => {
      for (const [col, filter] of active) {
        if (!matchFilter(row[col], filter)) return false;
      }
      return true;
    };
  }

  return { detectAllTypes, detectColumnType, applyFilters, buildPredicate };
})();
