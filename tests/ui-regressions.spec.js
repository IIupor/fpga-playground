const { test, expect } = require('@playwright/test');
const { gzipSync } = require('node:zlib');
async function loadBenchmark(page, name) {
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await expect(page.locator('#editorMessage')).toContainText('Loaded ' + name + '.v', { timeout: 180000 });
}

test('F and Shift+F both fit the complete circuit to the workspace', async ({ page }) => {
  await loadBenchmark(page, 'c432');
  const viewport = page.locator('#editorViewport');
  const stage = page.locator('#editorStage');
  await page.locator('#editorZoomReset').click();
  await page.keyboard.press('f');
  await expect.poll(async () => {
    const box = await stage.boundingBox();
    const view = await viewport.boundingBox();
    return box && view && box.width <= view.width + 2 && box.height <= view.height + 2;
  }).toBe(true);
  await page.locator('#editorZoomIn').click();
  await page.keyboard.press('Shift+f');
  await expect.poll(async () => {
    const box = await stage.boundingBox();
    const view = await viewport.boundingBox();
    return box && view && box.width <= view.width + 2 && box.height <= view.height + 2;
  }).toBe(true);
});

test('ISCAS89 benchmark statistics are calculated from the selected circuit', async ({ page }) => {
  await loadBenchmark(page, 's298');
  await expect(page.locator('#benchmarkGateCount')).toHaveText('Gates: 75');
  await expect(page.locator('#benchmarkInverterCount')).toHaveText('Inverters: 44');
  await expect(page.locator('#benchmarkDffCount')).toHaveText('DFF: 14');
  await expect(page.locator('#benchmarkLatchCount')).toHaveText('Latches: 0');
  await expect(page.locator('#benchmarkSelect option:checked')).toContainText('14 DFF');
  await expect(page.locator('#benchmarkSelect option:checked')).toContainText('75 gates');
});

test('Import Verilog opens a file chooser and imports the selected source', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importVerilog').click();
  const chooser = await chooserPromise;
  const source = [
    'module imported_test(A, B, Y);',
    'input A, B;',
    'output Y;',
    'wire n1;',
    'and U1(n1, A, B);',
    'not U2(Y, n1);',
    'endmodule'
  ].join('\n');
  await chooser.setFiles({ name: 'imported_test.v', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
  await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(4);
});

test('logic gates render standard SVG symbols instead of rectangular gate blocks', async ({ page }) => {
  await page.goto('/');
  for (const type of ['OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'NOT']) {
    await page.locator('[data-add="' + type + '"]').click();
    const gate = page.locator('#editorStage g[data-node]').last();
    await expect.poll(() => gate.locator('.gate-symbol').count()).toBeGreaterThan(0);
    await expect(gate.locator('rect.nodebox')).toHaveCSS('opacity', '0');
  }
  const and = page.locator('#editorStage g[data-node="3"]');
  await expect.poll(() => and.locator('.gate-symbol').count()).toBeGreaterThan(0);
});

test('Library browser lists and places functional Liberty cells', async ({ page }) => {
  await page.goto('/');
  const liberty = [
    'library(test_library) {',
    '  cell(AND2_X1) {',
    '    pin(A) { direction : input; }',
    '    pin(B) { direction : input; }',
    '    pin(Y) { direction : output; function : "A & B"; }',
    '  }',
    '}'
  ].join('\n');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importLibraries').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'test.lib.gz', mimeType: 'application/gzip', buffer: gzipSync(Buffer.from(liberty)) });
  await expect(page.locator('#libraryStatus')).toContainText('1 Liberty cells');
  await page.locator('#libraryBrowserButton').click();
  const cellButton = page.getByRole('button', { name: /AND2_X1/ });
  await expect(cellButton).toBeVisible();
  await cellButton.click();
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'AND2_X1' });
  await expect(cell).toHaveCount(1);
  const cellId = await cell.getAttribute('data-node');
  const details = await page.evaluate(id => {
    const n = window.fpgaNodes.find(node => node.id === Number(id));
    return { type: n.type, cellType: n.cellType, inputs: n.inputs, outputs: n.outputs, functions: n.cellFunctions };
  }, cellId);
  expect(details).toEqual({
    type: 'MODULE', cellType: 'AND2_X1', inputs: 2, outputs: 1, functions: { Y: 'A & B' }
  });

  // Replace the example AND's output with the library cell output.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator('#editorStage g[data-node="' + cellId + '"] .nodepin').nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator('#editorStage g[data-node="' + cellId + '"] .nodepin').nth(1).click();
  await page.locator('#editorStage g[data-node="' + cellId + '"] .nodepin').nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();
  await page.locator('#editorControls button').nth(0).click();
  await page.locator('#editorControls button').nth(1).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
});
