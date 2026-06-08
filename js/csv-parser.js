'use strict';

/**
 * CsvParser
 *
 * Dois modos:
 *  sample() — lê as primeiras N linhas (rápido, para detectar headers/tipos)
 *  parse()  — lê o arquivo inteiro em streaming, aplicando filterFn opcionalmente
 *
 * Ambos usam PapaParse diretamente no File (Blob), com encoding nativo,
 * evitando carregar o arquivo inteiro como string na memória.
 */
const CsvParser = (() => {

  // ── Detecção de encoding ──────────────────────────────────
  function detectEncoding(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result.includes('\uFFFD') ? 'windows-1252' : 'UTF-8');
      reader.onerror = () => resolve('UTF-8');
      reader.readAsText(file.slice(0, 8192), 'UTF-8');
    });
  }

  // ── Sample: primeiras maxRows linhas ─────────────────────
  /**
   * @param {object} opts
   * @param {File}     opts.file
   * @param {string}   opts.encoding
   * @param {number}   [opts.maxRows=500]
   * @param {function} opts.onComplete ({ data, headers, delimiter })
   * @param {function} opts.onError
   */
  function sample({ file, encoding, maxRows = 500, onComplete, onError }) {
    const rows = [];
    let headers   = null;
    let delimiter = null;

    Papa.parse(file, {
      header:          true,
      skipEmptyLines:  true,
      dynamicTyping:   false,
      encoding,                       // PapaParse lê o File em chunks com encoding correto
      transformHeader: h => h.trim(),

      step(result, parser) {
        if (!headers && result.meta.fields) {
          headers   = result.meta.fields;
          delimiter = result.meta.delimiter;
        }
        if (result.data && typeof result.data === 'object' &&
            !Array.isArray(result.data) &&
            Object.keys(result.data).length > 0) {
          rows.push(result.data);
        }
        if (rows.length >= maxRows) parser.abort();
      },

      complete() {
        onComplete({ data: rows, headers: headers || [], delimiter });
      },

      error: onError
    });
  }

  // ── Parse: arquivo inteiro, com filterFn opcional ─────────
  /**
   * @param {object}   opts
   * @param {File}     opts.file
   * @param {string}   opts.encoding
   * @param {function} [opts.filterFn]  (row) => bool — mantém só as linhas true
   * @param {function} opts.onProgress  (0–1) => void
   * @param {function} opts.onComplete  ({ data, headers, delimiter })
   * @param {function} opts.onError
   */
  function parse({ file, encoding, filterFn, onProgress, onComplete, onError }) {
    const rows = [];
    let headers   = null;
    let delimiter = null;

    Papa.parse(file, {
      header:          true,
      skipEmptyLines:  true,
      dynamicTyping:   false,
      encoding,
      transformHeader: h => h.trim(),

      chunk(results) {
        if (!headers && results.meta.fields) {
          headers   = results.meta.fields;
          delimiter = results.meta.delimiter;
        }
        for (const row of results.data) {
          if (!filterFn || filterFn(row)) rows.push(row);
        }
        // Progresso por posição de byte (cursor exposto pelo PapaParse)
        if (results.meta.cursor && file.size > 0) {
          onProgress(Math.min(0.92, results.meta.cursor / file.size));
        }
      },

      complete() {
        onProgress(1);
        onComplete({ data: rows, headers: headers || [], delimiter });
      },

      error: onError
    });
  }

  return { detectEncoding, sample, parse };
})();
