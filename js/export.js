// Excel and PDF export functions
// Implements: exportToExcel(), exportToPDF()
// Libraries loaded via classic script tags: SheetJS (window.XLSX), jsPDF (window.jspdf), jsPDF-AutoTable

/**
 * Export comparison results to an Excel (.xlsx) file.
 * @param {Object} results - CompareResult with entries[] and summary{}
 * @param {string} [filename] - Output filename (default: "mac-compare.xlsx")
 */
export function exportToExcel(results, filename) {
  const XLSX = window.XLSX;
  const { moved, new: newCount, removed, unchanged, total } = results.summary;

  // Detect which enrichment columns have data
  const hasDescription = results.entries.some(e => e.beforeDescription || e.afterDescription);
  const hasCdp = results.entries.some(e => e.beforeCdpNeighbor || e.afterCdpNeighbor);
  const hasVlanName = results.entries.some(e => e.vlanName);

  // Build header row dynamically
  const headers = ['Status', 'VLAN', 'MAC Address', 'Before Port', 'After Port'];
  if (hasDescription) headers.push('Description');
  if (hasCdp) headers.push('CDP Neighbor');
  if (hasVlanName) headers.push('VLAN Name');

  // Title row — include hostname if available
  const titleText = results.hostname
    ? `MAC Address Table Comparison — ${results.hostname}`
    : 'MAC Address Table Comparison';

  // Summary row — include hostname context
  const summaryParts = [`Moved: ${moved}`, `New: ${newCount}`, `Removed: ${removed}`, `Unchanged: ${unchanged}`, `Total: ${total}`];

  // Build array-of-arrays for the worksheet
  const aoa = [
    [titleText, '', '', '', new Date().toLocaleString()],
    summaryParts,
    [], // blank row
    headers,
  ];

  // Data rows
  for (const entry of results.entries) {
    let beforeLabel = entry.beforePort || '\u2014';
    if (entry.beforePort && entry.beforePortTag) {
      beforeLabel += ` [${entry.beforePortTag.toUpperCase()}]`;
    }
    let afterLabel = entry.afterPort || '\u2014';
    if (entry.afterPort && entry.afterPortTag) {
      afterLabel += ` [${entry.afterPortTag.toUpperCase()}]`;
    }
    const row = [
      entry.status.toUpperCase(),
      entry.vlan,
      entry.mac,
      beforeLabel,
      afterLabel,
    ];
    if (hasDescription) row.push(entry.afterDescription || entry.beforeDescription || '\u2014');
    if (hasCdp) row.push(entry.afterCdpNeighbor || entry.beforeCdpNeighbor || '\u2014');
    if (hasVlanName) row.push(entry.vlanName || '\u2014');
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths — base columns plus enrichment
  const colWidths = [
    { wch: 12 },
    { wch: 8 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
  ];
  if (hasDescription) colWidths.push({ wch: 25 });
  if (hasCdp) colWidths.push({ wch: 20 });
  if (hasVlanName) colWidths.push({ wch: 15 });
  ws['!cols'] = colWidths;

  // Attempt cell fill colors (SheetJS Pro only — community edition ignores .s)
  const fillColors = {
    moved: { fgColor: { rgb: 'FFF3CD' } },
    new: { fgColor: { rgb: 'D4EDDA' } },
    removed: { fgColor: { rgb: 'F8D7DA' } },
  };

  const totalCols = headers.length;
  try {
    for (let r = 4; r < aoa.length; r++) {
      const status = aoa[r][0].toLowerCase();
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
    // Cell styling not supported in community edition — data exports fine without colors
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MAC Comparison');
  XLSX.writeFile(wb, filename || 'mac-compare.xlsx');
}

/**
 * Export comparison results to a PDF file.
 * @param {Object} results - CompareResult with entries[] and summary{}
 * @param {string} [filename] - Output filename (default: "mac-compare.pdf")
 */
export function exportToPDF(results, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const { moved, new: newCount, removed, unchanged, total } = results.summary;

  // Detect which enrichment columns have data
  const hasDescription = results.entries.some(e => e.beforeDescription || e.afterDescription);
  const hasCdp = results.entries.some(e => e.beforeCdpNeighbor || e.afterCdpNeighbor);
  const hasVlanName = results.entries.some(e => e.vlanName);
  const hasEnrichment = hasDescription || hasCdp || hasVlanName;

  // Title — include hostname if available
  const titleText = results.hostname
    ? `MAC Address Table Comparison \u2014 ${results.hostname}`
    : 'MAC Address Table Comparison';

  doc.setFontSize(16);
  doc.text(titleText, 14, 20);

  // Timestamp
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 28);

  // Summary
  doc.text(
    `Moved: ${moved} | New: ${newCount} | Removed: ${removed} | Unchanged: ${unchanged} | Total: ${total}`,
    14,
    34
  );

  // Build header row dynamically — abbreviated names for PDF space
  const headers = ['Status', 'VLAN', 'MAC Address', 'Before Port', 'After Port'];
  if (hasDescription) headers.push('Desc');
  if (hasCdp) headers.push('CDP');
  if (hasVlanName) headers.push('VName');

  // Build body rows dynamically
  const body = results.entries.map((e) => {
    let beforeLabel = e.beforePort || '\u2014';
    if (e.beforePort && e.beforePortTag) {
      beforeLabel += ` [${e.beforePortTag.toUpperCase()}]`;
    }
    let afterLabel = e.afterPort || '\u2014';
    if (e.afterPort && e.afterPortTag) {
      afterLabel += ` [${e.afterPortTag.toUpperCase()}]`;
    }
    const row = [e.status.toUpperCase(), String(e.vlan), e.mac, beforeLabel, afterLabel];
    if (hasDescription) row.push(e.afterDescription || e.beforeDescription || '\u2014');
    if (hasCdp) row.push(e.afterCdpNeighbor || e.beforeCdpNeighbor || '\u2014');
    if (hasVlanName) row.push(e.vlanName || '\u2014');
    return row;
  });

  // Comparison table via AutoTable
  doc.autoTable({
    startY: 40,
    head: [headers],
    body: body,
    styles: { fontSize: hasEnrichment ? 7 : 8, cellPadding: 2, font: 'courier' },
    headStyles: { fillColor: [15, 52, 96], textColor: [224, 224, 224] },
    didParseCell: function (data) {
      if (data.section === 'body') {
        const status = data.row.raw[0].toLowerCase();
        if (status === 'moved') {
          data.cell.styles.fillColor = [255, 243, 205];
          data.cell.styles.textColor = [0, 0, 0];
        } else if (status === 'new') {
          data.cell.styles.fillColor = [212, 237, 218];
          data.cell.styles.textColor = [0, 0, 0];
        } else if (status === 'removed') {
          data.cell.styles.fillColor = [248, 215, 218];
          data.cell.styles.textColor = [0, 0, 0];
        }
      }
    },
  });

  doc.save(filename || 'mac-compare.pdf');
}
