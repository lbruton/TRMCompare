// Excel and PDF export functions
// Implements: exportToExcel(), exportToPDF()
// Libraries loaded via classic script tags: SheetJS (window.XLSX), jsPDF (window.jspdf), jsPDF-AutoTable

/**
 * Derive a display status from an audit entry's issues array.
 */
function entryStatus(entry) {
  if (entry.issues.includes('new')) return 'NEW';
  if (entry.issues.includes('missing')) return 'MISSING';
  if (entry.issues.length > 0) return 'CHANGED';
  return 'OK';
}

/**
 * Compute summary counts from audit entries.
 */
function computeSummary(entries) {
  let changed = 0, newCount = 0, missing = 0, ok = 0;
  for (const e of entries) {
    const s = entryStatus(e);
    if (s === 'CHANGED') changed++;
    else if (s === 'NEW') newCount++;
    else if (s === 'MISSING') missing++;
    else ok++;
  }
  return { changed, new: newCount, missing, ok, total: entries.length };
}

/**
 * Detect which enrichment columns have data across all entries.
 */
function detectEnrichment(entries) {
  return {
    hasDesc: entries.some(e => e.old.desc || e.new.desc),
    hasCdp: entries.some(e => e.old.cdp || e.new.cdp),
  };
}

/**
 * Export audit entries to an Excel (.xlsx) file.
 * @param {Object} results - { entries: AuditEntry[] }
 * @param {string} [filename] - Output filename (default: "mac-audit.xlsx")
 */
export function exportToExcel(results, filename) {
  const XLSX = window.XLSX;
  const entries = results.entries;
  const summary = computeSummary(entries);
  const { hasDesc, hasCdp } = detectEnrichment(entries);

  // Build header row dynamically
  const headers = [
    'Status', 'MAC Address',
    'Old Port', 'Old VLAN', 'Old Type',
    'New Port', 'New VLAN', 'New Type',
    'Issues',
  ];
  if (hasDesc) headers.push('Old Desc', 'New Desc');
  if (hasCdp) headers.push('Old CDP', 'New CDP');

  const titleText = 'MAC Address Audit Comparison';

  const summaryParts = [
    `Changed: ${summary.changed}`,
    `New: ${summary.new}`,
    `Missing: ${summary.missing}`,
    `OK: ${summary.ok}`,
    `Total: ${summary.total}`,
  ];

  const aoa = [
    [titleText, '', '', '', new Date().toLocaleString()],
    summaryParts,
    [],
    headers,
  ];

  for (const entry of entries) {
    const row = [
      entryStatus(entry),
      entry.mac,
      entry.old.port || '\u2014',
      entry.old.vlan ?? '\u2014',
      entry.old.type && entry.old.type !== 'access' ? entry.old.type : '\u2014',
      entry.new.port || '\u2014',
      entry.new.vlan ?? '\u2014',
      entry.new.type && entry.new.type !== 'access' ? entry.new.type : '\u2014',
      entry.issues.join(', ') || 'OK',
    ];
    if (hasDesc) {
      row.push(entry.old.desc || '\u2014');
      row.push(entry.new.desc || '\u2014');
    }
    if (hasCdp) {
      row.push(entry.old.cdp || '\u2014');
      row.push(entry.new.cdp || '\u2014');
    }
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  const colWidths = [
    { wch: 10 }, // Status
    { wch: 20 }, // MAC
    { wch: 14 }, // Old Port
    { wch: 8 },  // Old VLAN
    { wch: 8 },  // Old Type
    { wch: 14 }, // New Port
    { wch: 8 },  // New VLAN
    { wch: 8 },  // New Type
    { wch: 18 }, // Issues
  ];
  if (hasDesc) { colWidths.push({ wch: 22 }, { wch: 22 }); }
  if (hasCdp) { colWidths.push({ wch: 20 }, { wch: 20 }); }
  ws['!cols'] = colWidths;

  // Attempt cell fill colors (SheetJS Pro only — community edition ignores .s)
  const fillColors = {
    CHANGED: { fgColor: { rgb: 'FFF3CD' } },
    NEW: { fgColor: { rgb: 'D4EDDA' } },
    MISSING: { fgColor: { rgb: 'F8D7DA' } },
  };

  const totalCols = headers.length;
  try {
    for (let r = 4; r < aoa.length; r++) {
      const status = aoa[r][0];
      const fill = fillColors[status];
      if (!fill) continue;
      for (let c = 0; c < totalCols; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = ws[cellRef];
        if (cell) {
          cell.s = { fill };
        }
      }
    }
  } catch (_) {
    // Cell styling not supported in community edition
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MAC Audit');
  XLSX.writeFile(wb, filename || 'mac-audit.xlsx');
}

/**
 * Export audit entries to a PDF file.
 * @param {Object} results - { entries: AuditEntry[] }
 * @param {string} [filename] - Output filename (default: "mac-audit.pdf")
 */
export function exportToPDF(results, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const entries = results.entries;
  const summary = computeSummary(entries);
  const { hasDesc, hasCdp } = detectEnrichment(entries);
  const hasEnrichment = hasDesc || hasCdp;

  const titleText = 'MAC Address Audit Comparison';

  doc.setFontSize(16);
  doc.text(titleText, 14, 20);

  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 28);

  doc.text(
    `Changed: ${summary.changed} | New: ${summary.new} | Missing: ${summary.missing} | OK: ${summary.ok} | Total: ${summary.total}`,
    14,
    34
  );

  // Build header row — abbreviated for PDF space
  const headers = ['Status', 'MAC', 'Old Port', 'Old VLAN', 'Old Type', 'New Port', 'New VLAN', 'New Type', 'Issues'];
  if (hasDesc) headers.push('Old Desc', 'New Desc');
  if (hasCdp) headers.push('Old CDP', 'New CDP');

  const body = entries.map((e) => {
    const row = [
      entryStatus(e),
      e.mac,
      e.old.port || '\u2014',
      e.old.vlan ?? '\u2014',
      e.old.type && e.old.type !== 'access' ? e.old.type : '\u2014',
      e.new.port || '\u2014',
      e.new.vlan ?? '\u2014',
      e.new.type && e.new.type !== 'access' ? e.new.type : '\u2014',
      e.issues.join(', ') || 'OK',
    ];
    if (hasDesc) {
      row.push(e.old.desc || '\u2014');
      row.push(e.new.desc || '\u2014');
    }
    if (hasCdp) {
      row.push(e.old.cdp || '\u2014');
      row.push(e.new.cdp || '\u2014');
    }
    return row;
  });

  doc.autoTable({
    startY: 40,
    head: [headers],
    body: body,
    styles: { fontSize: 7, cellPadding: 2, font: 'courier' },
    headStyles: { fillColor: [15, 52, 96], textColor: [224, 224, 224] },
    didParseCell: function (data) {
      if (data.section === 'body') {
        const status = data.row.raw[0];
        if (status === 'CHANGED') {
          data.cell.styles.fillColor = [255, 243, 205];
          data.cell.styles.textColor = [0, 0, 0];
        } else if (status === 'NEW') {
          data.cell.styles.fillColor = [212, 237, 218];
          data.cell.styles.textColor = [0, 0, 0];
        } else if (status === 'MISSING') {
          data.cell.styles.fillColor = [248, 215, 218];
          data.cell.styles.textColor = [0, 0, 0];
        }
      }
    },
  });

  doc.save(filename || 'mac-audit.pdf');
}
