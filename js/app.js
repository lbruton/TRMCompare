// UI orchestrator — wires parse → compare → display → export

import { parseTerminalOutput } from './parser.js';
import { classifyPorts, buildAuditEntries } from './diff.js';
import { exportToExcel, exportToPDF } from './export.js';

let currentAuditEntries = null;
let currentSortCol = null;
let currentSortAsc = true;
const activeFilters = new Set(['all', 'trunk', 'voice', 'access']);

const ISSUE_LABELS = {
  vlan: 'VLAN',
  type: 'Type',
  desc: 'Desc',
  cdp: 'CDP',
  new: 'New',
  missing: 'Missing',
};

// --- Messages ---

function showMessage(type, textOrNode) {
  const messagesDiv = document.getElementById('messages');
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  if (typeof textOrNode === 'string') {
    msg.textContent = textOrNode;
  } else {
    msg.appendChild(textOrNode);
  }
  messagesDiv.appendChild(msg);
}

function clearMessages() {
  const messagesDiv = document.getElementById('messages');
  while (messagesDiv.firstChild) {
    messagesDiv.removeChild(messagesDiv.firstChild);
  }
}

function buildParseWarning(label, entryCount, errors) {
  const frag = document.createDocumentFragment();
  const summary = document.createElement('span');
  summary.textContent = `${label}: Parsed ${entryCount} entries, ${errors.length} lines could not be parsed.`;
  frag.appendChild(summary);

  const details = document.createElement('details');
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Show failed lines';
  details.appendChild(detailsSummary);

  const ul = document.createElement('ul');
  for (const err of errors) {
    const li = document.createElement('li');
    li.textContent = err;
    ul.appendChild(li);
  }
  details.appendChild(ul);
  frag.appendChild(details);
  return frag;
}

// --- Audit table rendering ---

function renderAuditTable(entries) {
  const tbody = document.getElementById('audit-body');
  while (tbody.firstChild) {
    tbody.removeChild(tbody.firstChild);
  }
  const fragment = document.createDocumentFragment();
  const dash = '\u2014';

  for (const entry of entries) {
    const tr = document.createElement('tr');
    const hasRealIssues = entry.issues.some(i => i !== 'new' && i !== 'missing');

    // Data attributes for filtering and sorting
    tr.dataset.mac = entry.mac;
    tr.dataset.oldPort = entry.old.port || '';
    tr.dataset.oldVlan = entry.old.vlan ?? '';
    tr.dataset.oldType = entry.old.type || 'access';
    tr.dataset.oldDesc = entry.old.desc || '';
    tr.dataset.oldCdp = entry.old.cdp || '';
    tr.dataset.newPort = entry.new.port || '';
    tr.dataset.newVlan = entry.new.vlan ?? '';
    tr.dataset.newType = entry.new.type || 'access';
    tr.dataset.newDesc = entry.new.desc || '';
    tr.dataset.newCdp = entry.new.cdp || '';
    tr.dataset.issues = entry.issues.join(',');
    tr.dataset.hasIssues = hasRealIssues || entry.issues.includes('new') || entry.issues.includes('missing') ? '1' : '0';
    tr.dataset.portType = entry.old.type || entry.new.type || 'access';

    const fields = ['port', 'vlan', 'type', 'desc', 'cdp'];
    const mismatchFields = new Set(entry.issues);

    // Old switch cells
    for (const field of fields) {
      const td = document.createElement('td');
      const val = entry.old[field];
      if (val != null) {
        if (field === 'type' && val !== 'access') {
          const tag = document.createElement('span');
          tag.className = `port-tag port-tag-${val}`;
          tag.textContent = val;
          td.appendChild(tag);
        } else if (field === 'type') {
          td.textContent = dash;
        } else {
          td.textContent = val;
        }
      } else {
        td.textContent = dash;
      }
      tr.appendChild(td);
    }

    // MAC address center column
    const tdMac = document.createElement('td');
    tdMac.className = 'audit-mac';
    tdMac.textContent = entry.mac;
    tr.appendChild(tdMac);

    // New switch cells — highlight mismatches
    const fieldToIssue = { vlan: 'vlan', type: 'type', desc: 'desc', cdp: 'cdp' };
    for (const field of fields) {
      const td = document.createElement('td');
      const val = entry.new[field];
      if (val != null) {
        if (field === 'type' && val !== 'access') {
          const tag = document.createElement('span');
          tag.className = `port-tag port-tag-${val}`;
          tag.textContent = val;
          td.appendChild(tag);
        } else if (field === 'type') {
          td.textContent = dash;
        } else {
          td.textContent = val;
        }
      } else {
        td.textContent = dash;
      }
      if (fieldToIssue[field] && mismatchFields.has(fieldToIssue[field])) {
        td.classList.add('cell-mismatch');
      }
      tr.appendChild(td);
    }

    // Issues column
    const tdIssues = document.createElement('td');
    tdIssues.className = 'audit-row-issues';
    if (entry.issues.length === 0) {
      const badge = document.createElement('span');
      badge.className = 'issue-badge issue-badge-ok';
      badge.textContent = 'OK';
      tdIssues.appendChild(badge);
    } else {
      for (const issue of entry.issues) {
        const badge = document.createElement('span');
        badge.className = `issue-badge issue-badge-${issue}`;
        badge.textContent = ISSUE_LABELS[issue] || issue;
        tdIssues.appendChild(badge);
      }
    }
    tr.appendChild(tdIssues);

    if (hasRealIssues) {
      tr.className = 'audit-mismatch-row';
    } else if (entry.issues.length === 0) {
      tr.className = 'audit-ok';
    }

    fragment.appendChild(tr);
  }

  tbody.appendChild(fragment);
}

// --- Sorting ---

function sortAuditEntries(entries, col, asc) {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    let valA, valB;
    switch (col) {
      case 'old-port':
        valA = a.old.port || ''; valB = b.old.port || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'old-vlan':
        valA = String(a.old.vlan ?? ''); valB = String(b.old.vlan ?? '');
        return asc ? valA.localeCompare(valB, undefined, {numeric: true}) : valB.localeCompare(valA, undefined, {numeric: true});
      case 'old-type':
        valA = a.old.type || ''; valB = b.old.type || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'old-desc':
        valA = a.old.desc || ''; valB = b.old.desc || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'old-cdp':
        valA = a.old.cdp || ''; valB = b.old.cdp || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'mac':
        return asc ? a.mac.localeCompare(b.mac) : b.mac.localeCompare(a.mac);
      case 'new-port':
        valA = a.new.port || ''; valB = b.new.port || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'new-vlan':
        valA = String(a.new.vlan ?? ''); valB = String(b.new.vlan ?? '');
        return asc ? valA.localeCompare(valB, undefined, {numeric: true}) : valB.localeCompare(valA, undefined, {numeric: true});
      case 'new-type':
        valA = a.new.type || ''; valB = b.new.type || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'new-desc':
        valA = a.new.desc || ''; valB = b.new.desc || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'new-cdp':
        valA = a.new.cdp || ''; valB = b.new.cdp || '';
        return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      case 'issues':
        valA = a.issues.length; valB = b.issues.length;
        if (valA !== valB) return asc ? valB - valA : valA - valB;
        return a.mac.localeCompare(b.mac);
      default:
        return 0;
    }
  });
  return sorted;
}

function updateSortArrows() {
  document.querySelectorAll('.sortable-audit .sort-arrow').forEach(arrow => {
    arrow.textContent = '';
  });
  if (currentSortCol) {
    const th = document.querySelector(`.sortable-audit[data-audit-sort="${currentSortCol}"]`);
    if (th) {
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = currentSortAsc ? '\u25B2' : '\u25BC';
    }
  }
}

// --- Filtering ---

function applyFilters() {
  const term = (document.getElementById('filter-input').value || '').toLowerCase();
  const rows = document.getElementById('audit-body').querySelectorAll('tr');
  const issuesOnly = activeFilters.has('issues');
  const showNew = activeFilters.has('new');
  const showMissing = activeFilters.has('missing');
  const showTrunk = activeFilters.has('trunk');
  const showVoice = activeFilters.has('voice');
  const showAccess = activeFilters.has('access');

  for (const row of rows) {
    const textMatch = !term || row.textContent.toLowerCase().includes(term);
    const issues = row.dataset.issues;
    const hasIssues = row.dataset.hasIssues === '1';
    const portType = row.dataset.portType;

    // Issues Only: hide OK rows
    if (issuesOnly && !hasIssues) {
      row.style.display = 'none';
      continue;
    }

    // Port type filter
    let typeMatch = false;
    if (portType === 'trunk' && showTrunk) typeMatch = true;
    else if (portType === 'voice' && showVoice) typeMatch = true;
    else if ((portType === 'access' || !portType) && showAccess) typeMatch = true;
    if (issues === 'new' && showNew) typeMatch = true;
    if (issues === 'missing' && showMissing) typeMatch = true;

    row.style.display = (textMatch && typeMatch) ? '' : 'none';
  }
}

function updatePillStyles() {
  document.querySelectorAll('.filter-pill').forEach(pill => {
    const filter = pill.dataset.auditFilter;
    if (activeFilters.has(filter)) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

// --- Main ---

document.addEventListener('DOMContentLoaded', () => {
  const beforeInput = document.getElementById('before-input');
  const afterInput = document.getElementById('after-input');
  const compareBtn = document.getElementById('compare-btn');
  const resultsSection = document.getElementById('results-section');
  const filterInput = document.getElementById('filter-input');
  const exportExcelBtn = document.getElementById('export-excel-btn');
  const exportPdfBtn = document.getElementById('export-pdf-btn');

  compareBtn.addEventListener('click', () => {
    clearMessages();

    const beforeText = beforeInput.value;
    const afterText = afterInput.value;

    if (!beforeText || !beforeText.trim()) {
      showMessage('error', 'Please paste MAC address table output in both text areas.');
      return;
    }
    if (!afterText || !afterText.trim()) {
      showMessage('error', 'Please paste MAC address table output in both text areas.');
      return;
    }

    const beforeParsed = parseTerminalOutput(beforeText);
    const afterParsed = parseTerminalOutput(afterText);

    if (beforeParsed.macErrors && beforeParsed.macErrors.length > 0) {
      showMessage('warning', buildParseWarning('Before', beforeParsed.macEntries.length, beforeParsed.macErrors));
    }
    if (afterParsed.macErrors && afterParsed.macErrors.length > 0) {
      showMessage('warning', buildParseWarning('After', afterParsed.macEntries.length, afterParsed.macErrors));
    }

    if (beforeParsed.macEntries.length === 0) {
      showMessage('error', 'Could not parse any MAC entries from the Before input. Expected Cisco IOS or NX-OS show mac address-table output.');
      return;
    }
    if (afterParsed.macEntries.length === 0) {
      showMessage('error', 'Could not parse any MAC entries from the After input. Expected Cisco IOS or NX-OS show mac address-table output.');
      return;
    }

    // Build enrichment maps
    const enrichment = {
      before: {
        descriptions: beforeParsed.interfaceDesc,
        cdp: beforeParsed.cdpNeighbors,
        vlanNames: beforeParsed.vlanData?.names || null,
      },
      after: {
        descriptions: afterParsed.interfaceDesc,
        cdp: afterParsed.cdpNeighbors,
        vlanNames: afterParsed.vlanData?.names || null,
      },
    };

    // Port profiles with layered classification (MAC heuristic → show vlan → CDP)
    const portProfiles = {
      before: classifyPorts(beforeParsed.macEntries, {
        vlanPorts: beforeParsed.vlanData?.portVlans || null,
        cdp: beforeParsed.cdpNeighbors || null,
      }),
      after: classifyPorts(afterParsed.macEntries, {
        vlanPorts: afterParsed.vlanData?.portVlans || null,
        cdp: afterParsed.cdpNeighbors || null,
      }),
    };

    // Build and render audit entries
    currentAuditEntries = buildAuditEntries(
      beforeParsed.macEntries, afterParsed.macEntries, portProfiles, enrichment
    );

    // Reset sort and filters
    currentSortCol = null;
    currentSortAsc = true;
    activeFilters.clear();
    ['all', 'trunk', 'voice', 'access'].forEach(f => activeFilters.add(f));
    updatePillStyles();

    renderAuditTable(currentAuditEntries);
    applyFilters();
    resultsSection.style.display = '';

    // Show commands-found/missing info
    const allFound = new Set([...beforeParsed.commandsFound, ...afterParsed.commandsFound]);
    const allMissing = new Set([...beforeParsed.commandsMissing, ...afterParsed.commandsMissing]);
    for (const cmd of allFound) { allMissing.delete(cmd); }
    if (allFound.size > 1 || allMissing.size > 0) {
      const foundList = [...allFound].join(', ');
      let infoText = `Commands found: ${foundList}.`;
      if (allMissing.size > 0) {
        infoText += ` Missing: ${[...allMissing].join(', ')} \u2014 results enriched with available data.`;
      }
      showMessage('info', infoText);
    }

    // Classification confidence disclaimer
    const hasVlanData = beforeParsed.vlanData !== null || afterParsed.vlanData !== null;
    const hasCdpData = beforeParsed.cdpNeighbors !== null || afterParsed.cdpNeighbors !== null;
    const hasPortTags = currentAuditEntries.some(e =>
      (e.old.type && e.old.type !== 'access') || (e.new.type && e.new.type !== 'access')
    );
    let disclaimer = document.getElementById('port-tag-disclaimer');
    if (hasPortTags) {
      let msg;
      if (!hasVlanData) {
        msg = 'Trunk/Voice labels are estimates based on MAC table density. Add "show vlan" and "show cdp neighbors" output for higher accuracy.';
      } else {
        const layers = ['show vlan'];
        if (hasCdpData) layers.push('CDP neighbors');
        msg = `Port classification verified with ${layers.join(' + ')}. Trunk = not in VLAN table. Voice = multi-VLAN access port${hasCdpData ? ' or CDP-confirmed phone' : ''}.`;
      }
      if (!disclaimer) {
        disclaimer = document.createElement('div');
        disclaimer.id = 'port-tag-disclaimer';
        disclaimer.className = 'message info';
        document.getElementById('messages').after(disclaimer);
      }
      disclaimer.textContent = msg;
      disclaimer.style.display = '';
    } else if (disclaimer) {
      disclaimer.style.display = 'none';
    }
  });

  // Text filter
  filterInput.addEventListener('keyup', () => applyFilters());

  // Sort handlers
  document.querySelectorAll('.sortable-audit').forEach(th => {
    th.addEventListener('click', () => {
      if (!currentAuditEntries) return;
      const col = th.dataset.auditSort;
      if (col === currentSortCol) {
        currentSortAsc = !currentSortAsc;
      } else {
        currentSortCol = col;
        currentSortAsc = true;
      }
      currentAuditEntries = sortAuditEntries(currentAuditEntries, currentSortCol, currentSortAsc);
      renderAuditTable(currentAuditEntries);
      updateSortArrows();
      applyFilters();
    });
  });

  // Filter pill handlers
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const filter = pill.dataset.auditFilter;

      if (filter === 'all') {
        if (!activeFilters.has('all')) {
          activeFilters.clear();
          activeFilters.add('all');
          activeFilters.add('trunk');
          activeFilters.add('voice');
          activeFilters.add('access');
        }
      } else if (filter === 'issues') {
        if (activeFilters.has('issues')) {
          activeFilters.delete('issues');
          activeFilters.add('all');
        } else {
          activeFilters.add('issues');
          activeFilters.delete('all');
        }
      } else {
        if (activeFilters.has(filter)) {
          activeFilters.delete(filter);
        } else {
          activeFilters.add(filter);
        }
        const hasAll = activeFilters.has('trunk') && activeFilters.has('voice') && activeFilters.has('access');
        if (hasAll && !activeFilters.has('issues')) {
          activeFilters.add('all');
        } else {
          activeFilters.delete('all');
        }
      }

      updatePillStyles();
      applyFilters();
    });
  });

  // Export
  exportExcelBtn.addEventListener('click', () => {
    if (currentAuditEntries) exportToExcel({ entries: currentAuditEntries });
  });

  exportPdfBtn.addEventListener('click', () => {
    if (currentAuditEntries) exportToPDF({ entries: currentAuditEntries });
  });
});
