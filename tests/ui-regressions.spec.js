const { test, expect } = require('@playwright/test');
const { gzipSync } = require('node:zlib');
async function loadBenchmark(page, name) {
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await expect(page.locator('#editorMessage')).toContainText(/^(Imported|Loaded )/, { timeout: 180000 });
}

test('Fit to view works with F, Shift+F and the Russian keyboard layout', async ({ page }) => {
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
  await page.locator('#editorZoomIn').click();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'а', code: 'KeyF', bubbles: true, cancelable: true })));
  await expect.poll(async () => {
    const box = await stage.boundingBox();
    const view = await viewport.boundingBox();
    return box && view && box.width <= view.width + 2 && box.height <= view.height + 2;
  }).toBe(true);
});

test('ISCAS89 benchmark statistics are calculated from the selected circuit', async ({ page }) => {
  await loadBenchmark(page, 's298');
  await expect(page.locator('#benchmarkGateCount')).toHaveText('Gates: 119');
  await expect(page.locator('#benchmarkInverterCount')).toHaveCount(0);
  await expect(page.locator('#benchmarkDffCount')).toHaveText('DFF: 14');
  await expect(page.locator('#benchmarkLatchCount')).toHaveText('Latches: 0');
  await expect(page.locator('#benchmarkSelect option:checked')).toContainText('14 DFF');
  await expect(page.locator('#benchmarkSelect option:checked')).toContainText('119 gates');
  await expect(page.locator('#benchmarkSelect option:checked')).not.toContainText('inv');
});

test('every ISCAS89 benchmark option shows DFF, inverter and gate counts', async ({ page }) => {
  await page.goto('/');
  const labels = await page.locator('#benchmarkSelect optgroup[label*="sequential"] option').allTextContents();
  expect(labels).toHaveLength(28);
  for (const label of labels) {
    expect(label).toMatch(/\d+ DFF · \d+ gates/);
    expect(label).not.toContain(' inv ');
  }
});

test('Import Verilog opens a file chooser and imports the selected source', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-menu="file"]').click();
  await page.locator('#importFile').click();
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
  await page.waitForFunction(() => {
    const progress = document.getElementById('importProgress');
    return progress && !progress.hidden;
  }, null, { timeout: 5000 });
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
  await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(4);
  // After the first import, replace the editor source with a different design.
  // Import Verilog must read the current editor contents, not stale file state.
  const secondSource = [
    'module second_import(A, B, Y);',
    'input A, B;',
    'output Y;',
    'and U1(Y, A, B);',
    'endmodule'
  ].join('\n');
  await page.locator('#verilogText').fill(secondSource);
  await page.locator('[data-menu="file"]').click();
  await page.locator('#importFile').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(4);
  await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(3);
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'U1' })).toHaveCount(1);
});

test('logic gates render standard symbols and input/output terminals are mirrored', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('i');
  for (const type of ['OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'NOT']) {
    await page.locator('[data-add="' + type + '"]').click();
    const gate = page.locator('#editorStage g[data-node]').last();
    await expect.poll(() => gate.locator('.gate-symbol').count()).toBeGreaterThan(0);
    await expect(gate.locator('rect.nodebox')).toHaveCSS('opacity', '0');
  }
  const and = page.locator('#editorStage g[data-node="3"]');
  await expect.poll(() => and.locator('.gate-symbol').count()).toBeGreaterThan(0);
  await page.locator('[data-add="INPUT"]').click();
  await page.locator('[data-add="OUTPUT"]').click();
  const terminals = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('#editorStage g[data-node]')];
    const input = groups.filter(g => [...g.querySelectorAll('.nodemeta')].some(t => t.textContent === 'INPUT')).at(-1);
    const output = groups.filter(g => [...g.querySelectorAll('.nodemeta')].some(t => t.textContent === 'OUTPUT')).at(-1);
    return { inputPinX: Number(input.querySelector('.nodepin').getAttribute('x'))+5,
      outputPinX: Number(output.querySelector('.nodepin').getAttribute('x'))+5,
      inputPath: input.querySelector('path.gate-symbol').getAttribute('d'),
      outputPath: output.querySelector('path.gate-symbol').getAttribute('d') };
  });
  expect(terminals.inputPinX).toBe(112);
  expect(terminals.outputPinX).toBe(0);
  expect(terminals.inputPath).not.toBe(terminals.outputPath);
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
  await page.locator('[data-menu="libraries"]').click();
  await page.locator('#menuLoadLibrary').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'test.lib.gz', mimeType: 'application/gzip', buffer: gzipSync(Buffer.from(liberty)) });
  await expect(page.locator('#libraryStatus')).toContainText('1 Liberty cells');
  await page.keyboard.press('i');
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
  const geometry = await cell.evaluate(g => ({
    pins: [...g.querySelectorAll('.nodepin')].map(p => [Number(p.getAttribute('x'))+5, Number(p.getAttribute('y'))+5]),
    leads: [...g.querySelectorAll('line.gate-symbol')].map(l => [Number(l.getAttribute('x1')),Number(l.getAttribute('y1')),Number(l.getAttribute('x2')),Number(l.getAttribute('y2'))])
  }));
  expect(geometry.pins).toEqual([[0,36],[0,58],[150,47]]);
  await expect(cell.locator('rect.nodepin')).toHaveCount(3);
  await expect(cell.locator('circle.nodepin')).toHaveCount(0);
  expect(geometry.leads).toContainEqual([0,36,18,36]);
  expect(geometry.leads).toContainEqual([0,58,18,58]);
  expect(geometry.leads).toContainEqual([123,47,150,47]);
  await expect(cell.locator('path.gate-symbol')).toHaveCount(1);
  await expect(cell.locator('rect.gate-symbol')).toHaveCount(0);

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
  await page.locator('[data-menu="file"]').click();
  await page.locator('#exportFile').click();
  await expect(page.locator('#verilogText')).toHaveValue(/AND2_X1 U_AND2_X1_1 \(/);
  await expect(page.locator('#verilogText')).toHaveValue(/assign Y = U_AND2_X1_1_Y;/);
  await expect(cell.locator('circle.gate-symbol')).toHaveCount(0);
});

test('Liberty input inversion is marked with a bubble distinct from square pins', async ({ page }) => {
  await page.goto('/');
  const liberty = [
    'library(test_library) {',
    '  cell(INV_INPUT_X1) {',
    '    pin(A) { direction : input; }',
    '    pin(B) { direction : input; }',
    '    pin(Y) { direction : output; function : "!A & B"; }',
    '  }',
    '}'
  ].join('\n');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-menu="libraries"]').click();
  await page.locator('#menuLoadLibrary').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'inverted_input.lib', mimeType: 'text/plain', buffer: Buffer.from(liberty) });
  await expect(page.locator('#libraryStatus')).toContainText('1 Liberty cells');
  await page.keyboard.press('i');
  await page.getByRole('button', { name: /INV_INPUT_X1/ }).click();
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'INV_INPUT_X1' });
  await expect(cell.locator('rect.nodepin')).toHaveCount(3);
  await expect(cell.locator('circle.inverted-pin-bubble')).toHaveCount(1);
  const inversions = await page.evaluate(() => window.fpgaNodes.find(n => n.cellType === 'INV_INPUT_X1').cellInputInversions);
  expect(inversions).toEqual(['A']);
});

test('Sky130 Liberty library exposes real cell pins and allows placing a cell', async ({ page }) => {
  await page.goto('/');
  await page.locator('#libraryFiles').setInputFiles('libraries/sky130/liberty/sky130_fd_sc_hd__tt_025C_1v80.lib.gz');
  await expect(page.locator('#libraryStatus')).toContainText(/Liberty cells/, { timeout: 120000 });
  const summary = await page.locator('#libraryStatus').textContent();
  expect(summary).toMatch(/[1-9]\d* Liberty cells/);
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  await page.locator('#libraryCellSearch').fill('sky130_fd_sc_hd__and2_1');
  const cellButton = page.getByRole('button', { name: /sky130_fd_sc_hd__and2_1/ });
  await expect(cellButton).toBeVisible({ timeout: 30000 });
  await expect(cellButton).toContainText('2 inputs · 1 outputs');
  await cellButton.click();
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'sky130_fd_sc_hd__and2_1' });
  await expect(cell).toHaveCount(1);
  const pins = await page.evaluate(() => {
    const node = window.fpgaNodes.find(item => item.cellType === 'sky130_fd_sc_hd__and2_1');
    return { inputs: node?.inputs, outputs: node?.outputs, inputNames: node?.inputNames, outputNames: node?.outputNames };
  });
  expect(pins.inputs).toBe(2);
  expect(pins.outputs).toBe(1);
  expect(pins.inputNames).toHaveLength(2);
  expect(pins.outputNames).toHaveLength(1);
});
