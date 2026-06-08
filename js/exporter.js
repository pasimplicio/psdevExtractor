'use strict';
const Exporter = (() => {

  const EXCEL_MAX = 1_048_575;
  const BATCH     = 2_000;
  const _enc      = new TextEncoder();

  // ── XML ───────────────────────────────────────────────────────────────────

  function _ex(s) {
    return String(s ?? '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  function _col(n) {
    let s = '';
    while (true) {
      s = String.fromCharCode(65 + n % 26) + s;
      if (n < 26) break;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  // ── CRC-32 ────────────────────────────────────────────────────────────────

  const _CRCT = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();

  function _crc(bytes, init = 0xFFFFFFFF) {
    let c = init;
    for (const b of bytes) c = (c >>> 8) ^ _CRCT[(c ^ b) & 0xFF];
    return c;
  }

  // ── ZIP helpers ───────────────────────────────────────────────────────────

  function _le16(n, b, o) { b[o]=n&0xFF; b[o+1]=(n>>>8)&0xFF; }
  function _le32(n, b, o) {
    n=n>>>0; b[o]=n&0xFF; b[o+1]=(n>>>8)&0xFF; b[o+2]=(n>>>16)&0xFF; b[o+3]=(n>>>24)&0xFF;
  }

  // Local header — tamanho/crc conhecidos (STORED ou DEFLATE sem streaming)
  function _lh(name, method, crc, cz, uz) {
    const nb = _enc.encode(name);
    const b  = new Uint8Array(30 + nb.length);
    _le32(0x04034b50,b,0); _le16(20,b,4);  _le16(0,b,6);
    _le16(method,b,8);     _le16(0,b,10);  _le16(0x5665,b,12);
    _le32(crc,b,14);       _le32(cz,b,18); _le32(uz,b,22);
    _le16(nb.length,b,26); _le16(0,b,28);  b.set(nb,30);
    return b;
  }

  function _cd(name, method, crc, cz, uz, off) {
    const nb = _enc.encode(name);
    const b  = new Uint8Array(46 + nb.length);
    _le32(0x02014b50,b,0); _le16(20,b,4);  _le16(20,b,6);  _le16(0,b,8);
    _le16(method,b,10);    _le16(0,b,12);  _le16(0x5665,b,14);
    _le32(crc,b,16);       _le32(cz,b,20); _le32(uz,b,24);
    _le16(nb.length,b,28); _le16(0,b,30);  _le16(0,b,32);  _le16(0,b,34);
    _le16(0,b,36);         _le32(0,b,38);  _le32(off,b,42); b.set(nb,46);
    return b;
  }

  function _eocd(n, cdSz, cdOff) {
    const b = new Uint8Array(22);
    _le32(0x06054b50,b,0); _le16(0,b,4); _le16(0,b,6);
    _le16(n,b,8); _le16(n,b,10); _le32(cdSz,b,12); _le32(cdOff,b,16); _le16(0,b,20);
    return b;
  }

  // ── XLSX arquivos fixos ───────────────────────────────────────────────────

  const _FIXED = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      +'<Default Extension="xml" ContentType="application/xml"/>'
      +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      +'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      +'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      +'</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      +'</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      +'<sheets><sheet name="Dados" sheetId="1" r:id="rId1"/></sheets>'
      +'</workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      +'</Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      +'<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
      +'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      +'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      +'<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      +'</styleSheet>'
  };

  // ── Geração do XML da planilha (comum às duas estratégias) ────────────────

  async function _genSheet({ data, headers, filteredIndices, total, colAddr, notify, onChunk }) {
    const cs      = new CompressionStream('deflate-raw');
    const cWriter = cs.writable.getWriter();
    const cReader = cs.readable.getReader();

    let crc   = 0xFFFFFFFF;
    let uncz  = 0;
    let compz = 0;

    // Lê chunks comprimidos e os entrega ao callback
    const readLoop = (async () => {
      while (true) {
        const { done, value } = await cReader.read();
        if (done) break;
        compz += value.length;
        await onChunk(value);
      }
    })();

    const feed = async str => {
      const b = _enc.encode(str);
      crc  = _crc(b, crc);
      uncz += b.length;
      await cWriter.write(b);
    };

    const dimMax = `${_col(headers.length - 1)}${total + 1}`;
    await feed(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<dimension ref="A1:${dimMax}"/>`
      + '<sheetData>'
    );

    let hRow = '<row r="1">';
    for (let ci = 0; ci < headers.length; ci++)
      hRow += `<c r="${colAddr[ci]}1" t="inlineStr"><is><t>${_ex(headers[ci])}</t></is></c>`;
    await feed(hRow + '</row>');

    for (let i = 0; i < total; i += BATCH) {
      const end = Math.min(i + BATCH, total);
      let xml = '';
      for (let j = i; j < end; j++) {
        const row = data[filteredIndices[j]];
        const ri  = j + 2;
        xml += `<row r="${ri}">`;
        for (let ci = 0; ci < headers.length; ci++) {
          const addr = colAddr[ci] + ri;
          const raw  = row[headers[ci]] ?? '';
          const s    = String(raw).trim();
          if (s === '') continue;
          if (/^-?[\d.,]+$/.test(s)) {
            const n = parseFloat(s.replace(/\./g,'').replace(',','.'));
            if (!isNaN(n)) { xml += `<c r="${addr}"><v>${n}</v></c>`; continue; }
          }
          xml += `<c r="${addr}" t="inlineStr"><is><t>${_ex(raw)}</t></is></c>`;
        }
        xml += '</row>';
      }
      await feed(xml);
      notify(0.04 + (end / total) * 0.56);
      await new Promise(r => setTimeout(r, 0));
    }

    await feed('</sheetData></worksheet>');
    await cWriter.close();
    await readLoop;

    return { crc: (crc ^ 0xFFFFFFFF) >>> 0, uncz, compz };
  }

  async function _exportBlob({ data, headers, filteredIndices, filename, notify, total }) {
    const colAddr  = Array.from({ length: headers.length }, (_, i) => _col(i));
    const zipParts = [];
    const cdParts  = [];
    let zipOff = 0;

    const addEntry = (name, chunks, method, crc, uz) => {
      const cz = chunks.reduce((s, c) => s + c.length, 0);
      cdParts.push(_cd(name, method, crc, cz, uz, zipOff));
      const lh = _lh(name, method, crc, cz, uz);
      zipParts.push(lh);
      for (const c of chunks) zipParts.push(c);
      zipOff += lh.length + cz;
    };

    for (const [name, content] of Object.entries(_FIXED)) {
      const b   = _enc.encode(content);
      const crc = (_crc(b) ^ 0xFFFFFFFF) >>> 0;
      addEntry(name, [b], 0, crc, b.length);
    }

    const compChunks = [];
    const sh = await _genSheet({
      data, headers, filteredIndices, total, colAddr, notify,
      onChunk: async chunk => compChunks.push(chunk)
    });
    addEntry('xl/worksheets/sheet1.xml', compChunks, 8, sh.crc, sh.uncz);
    compChunks.length = 0; // chunks já estão em zipParts — libera referências

    notify(0.92);

    const cdOff = zipOff;
    for (const cd of cdParts) { zipParts.push(cd); zipOff += cd.length; }
    zipParts.push(_eocd(cdParts.length, zipOff - cdOff, cdOff));

    const baseName = (filename || 'export').replace(/\.csv$/i, '');
    const blob = new Blob(zipParts, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    // Blob já copiou os dados — libera as arrays intermediárias imediatamente
    zipParts.length = 0;
    cdParts.length  = 0;

    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = `${baseName}_filtrado.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Aguarda o download iniciar antes de revogar a URL do Blob
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    notify(1);
  }

  // ── Principal ─────────────────────────────────────────────────────────────

  async function exportToXlsx({ data, headers, filteredIndices, filename, onProgress }) {
    const notify = typeof onProgress === 'function' ? onProgress : () => {};
    const total  = Math.min(filteredIndices.length, EXCEL_MAX);

    if (typeof CompressionStream === 'undefined') {
      throw new Error('Atualize o Chrome/Edge/Firefox para exportar como .xlsx.');
    }

    await _exportBlob({ data, headers, filteredIndices, filename, notify, total });
  }

  return { exportToXlsx };
})();
