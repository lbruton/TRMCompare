// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const beforeText = fs.readFileSync(
  path.resolve(__dirname, '..', 'samples', 'before-ie3000.txt'),
  'utf-8'
);
const afterText = fs.readFileSync(
  path.resolve(__dirname, '..', 'samples', 'after-ie3300.txt'),
  'utf-8'
);

/**
 * Run the full parse → classify → diff pipeline inside the browser context.
 * Extracted to avoid duplicating the evaluate block across tests.
 */
async function runPipeline(page, bText, aText) {
  return page.evaluate(async ({ bText, aText }) => {
    const { parseTerminalOutput } = await import('./js/parser.js');
    const { buildAuditEntries, classifyPorts } = await import('./js/diff.js');
    const bp = parseTerminalOutput(bText);
    const ap = parseTerminalOutput(aText);
    const enrichment = {
      before: { descriptions: bp.interfaceDesc, cdp: bp.cdpNeighbors, vlanNames: bp.vlanData?.names || null },
      after: { descriptions: ap.interfaceDesc, cdp: ap.cdpNeighbors, vlanNames: ap.vlanData?.names || null },
    };
    const portProfiles = {
      before: classifyPorts(bp.macEntries, { vlanPorts: bp.vlanData?.portVlans || null, cdp: bp.cdpNeighbors || null }),
      after: classifyPorts(ap.macEntries, { vlanPorts: ap.vlanData?.portVlans || null, cdp: ap.cdpNeighbors || null }),
    };
    return buildAuditEntries(bp.macEntries, ap.macEntries, portProfiles, enrichment);
  }, { bText, aText });
}

test.describe.serial('TRMCompare Smoke Tests', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Test 1: Page loads correctly', async () => {
    await page.goto('./');
    // Assert heading or title contains app-related text
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    // Assert compare button exists
    const compareBtn = page.locator('#compare-btn');
    await expect(compareBtn).toBeVisible();
  });

  test('Test 2: Paste sample data and compare', async () => {
    // Fill textareas with sample data
    await page.locator('#before-input').fill(beforeText);
    await page.locator('#after-input').fill(afterText);

    // Click compare
    await page.locator('#compare-btn').click();

    // Wait for results section to be visible
    await expect(page.locator('#results-section')).toBeVisible();

    // Count audit table rows
    const rowCount = await page.locator('#audit-table tbody tr').count();
    expect(rowCount).toBeGreaterThan(0);

    // Assert no error messages are visible
    const errorMessages = page.locator('.message.error');
    const errorCount = await errorMessages.count();
    for (let i = 0; i < errorCount; i++) {
      await expect(errorMessages.nth(i)).not.toBeVisible();
    }
  });

  test('Test 3: Parser extracts all command types', async () => {
    // Test before sample
    const beforeResult = await page.evaluate(async (text) => {
      const { parseTerminalOutput } = await import('./js/parser.js');
      const result = parseTerminalOutput(text);
      return {
        macCount: result.macEntries.length,
        commandsFound: result.commandsFound,
        commandsMissing: result.commandsMissing,
      };
    }, beforeText);

    expect(beforeResult.macCount).toBe(23);
    expect(beforeResult.commandsFound).toContain('mac address-table');
    expect(beforeResult.commandsFound).toContain('interfaces description');
    expect(beforeResult.commandsFound).toContain('cdp neighbors');
    expect(beforeResult.commandsFound).toContain('vlan');
    expect(beforeResult.commandsFound.length).toBe(4);
    expect(beforeResult.commandsMissing).toHaveLength(0);

    // Test after sample
    const afterResult = await page.evaluate(async (text) => {
      const { parseTerminalOutput } = await import('./js/parser.js');
      const result = parseTerminalOutput(text);
      return { macCount: result.macEntries.length };
    }, afterText);

    expect(afterResult.macCount).toBe(22);
  });

  test('Test 4: Specific mismatch detection', async () => {
    const entries = await runPipeline(page, beforeText, afterText);

    // dead.beef.0002 — should show "missing" (on old switch VLAN 20, absent from new)
    const missingEntry = entries.find(e => e.mac === 'dead.beef.0002');
    expect(missingEntry).toBeDefined();
    expect(missingEntry.issues).toContain('missing');

    // aabb.cc00.0201 — should show VLAN mismatch (was VLAN 10, now VLAN 20)
    const vlanEntry = entries.find(e => e.mac === 'aabb.cc00.0201');
    expect(vlanEntry).toBeDefined();
    expect(vlanEntry.issues).toContain('vlan');
  });

  test('Test 5: Audit entry shape validation', async () => {
    const entries = await runPipeline(page, beforeText, afterText);

    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      // mac is a string
      expect(typeof entry.mac).toBe('string');
      expect(entry.mac.length).toBeGreaterThan(0);

      // old has required keys
      expect(entry.old).toBeDefined();
      expect(entry.old).toHaveProperty('port');
      expect(entry.old).toHaveProperty('vlan');
      expect(entry.old).toHaveProperty('type');
      expect(entry.old).toHaveProperty('desc');
      expect(entry.old).toHaveProperty('cdp');

      // new has required keys
      expect(entry.new).toBeDefined();
      expect(entry.new).toHaveProperty('port');
      expect(entry.new).toHaveProperty('vlan');
      expect(entry.new).toHaveProperty('type');
      expect(entry.new).toHaveProperty('desc');
      expect(entry.new).toHaveProperty('cdp');

      // issues is an array
      expect(Array.isArray(entry.issues)).toBe(true);
    }
  });

  test('Test 6: Excel export produces valid file', async () => {
    // Set up download listener BEFORE clicking
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-excel-btn').click();
    const download = await downloadPromise;

    // Assert filename ends with .xlsx
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.xlsx$/);

    // Save to temp path and verify file size > 0
    const tmpPath = path.join(__dirname, '..', 'test-results', 'download-' + filename);
    await download.saveAs(tmpPath);
    const stat = fs.statSync(tmpPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  test('Test 7: PDF export produces valid file', async () => {
    // Set up download listener BEFORE clicking
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-pdf-btn').click();
    const download = await downloadPromise;

    // Assert filename ends with .pdf
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/\.pdf$/);

    // Save to temp path and verify file size > 0
    const tmpPath = path.join(__dirname, '..', 'test-results', 'download-' + filename);
    await download.saveAs(tmpPath);
    const stat = fs.statSync(tmpPath);
    expect(stat.size).toBeGreaterThan(0);
  });
});
