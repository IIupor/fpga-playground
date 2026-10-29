const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads the example AND circuit and its truth table', async ({ page }) => {
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(4);
  await expect(page.locator('#editorResults')).toContainText('Y');
  await expect(page.locator('#editorResults')).toContainText('= 0');
  const rows = page.locator('#editorTruthBody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator('td')).toHaveText(['0', '0', '0']);
  await expect(rows.nth(1).locator('td')).toHaveText(['0', '1', '0']);
  await expect(rows.nth(2).locator('td')).toHaveText(['1', '0', '0']);
  await expect(rows.nth(3).locator('td')).toHaveText(['1', '1', '1']);
});

test('input controls recalculate the AND output', async ({ page }) => {
  await page.getByRole('button', { name: /A.*0.*LOW/i }).click();
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.getByRole('button', { name: /B.*0.*LOW/i }).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await expect(page.locator('#editorTruthBody tr').nth(3).locator('td')).toHaveText(['1', '1', '1']);
});

test('adds and deletes a logic block', async ({ page }) => {
  const blocks = page.locator('#editorStage g[data-node]');
  await page.getByRole('button', { name: 'OR', exact: true }).click();
  await expect(blocks).toHaveCount(5);
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(blocks).toHaveCount(4);
});

test('reset restores the example circuit', async ({ page }) => {
  await page.locator('[data-add="INPUT"]').click();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(4);
  await expect(page.locator('#editorMessage')).toContainText('Example restored');
});

test('rewiring a gate input replaces its previous connection', async ({ page }) => {
  // Make A=1 while B remains 0, so the original AND output is 0.
  await page.getByRole('button', { name: /A.*0.*LOW/i }).click();
  await expect(page.locator('#editorResults')).toContainText('= 0');

  // Connect A to the second AND input; the old B-to-AND wire must be replaced.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(1).click();

  await expect(page.locator('#editorResults')).toContainText('= 1');
  await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(3);
});

test('deleting a connected gate also removes its wires', async ({ page }) => {
  const wires = page.locator('#editorStage path.editor-wire');
  await expect(wires).toHaveCount(3);

  // Select the AND gate and delete it.
  await page.locator('#editorStage g[data-node="3"]').click();
  await page.getByRole('button', { name: 'Delete selected' }).click();

  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(3);
  await expect(wires).toHaveCount(0);
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('deleting a wire preserves blocks and removes that connection', async ({ page }) => {
  const blocks = page.locator('#editorStage g[data-node]');
  const wires = page.locator('#editorStage path.editor-wire');
  await expect(blocks).toHaveCount(4);
  await expect(wires).toHaveCount(3);

  // Remove the AND-to-output connection without deleting either block.
  await wires.nth(2).click({ force: true });
  await page.getByRole('button', { name: 'Delete selected' }).click();

  await expect(blocks).toHaveCount(4);
  await expect(wires).toHaveCount(2);
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('OR gate evaluates connected inputs correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'OR', exact: true }).click();
  const orBlock = page.locator('#editorStage g[data-node]').last();
  const orId = await orBlock.getAttribute('data-node');

  // Connect A and B to OR, then connect OR to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${orId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${orId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${orId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 0');

  // OR must be high when either input is high, including when only B is high.
  await page.locator('#editorControls button').nth(1).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(1).click();
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
});

test('NAND gate evaluates all input combinations correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'NAND', exact: true }).click();
  const nandBlock = page.locator('#editorStage g[data-node]').last();
  const nandId = await nandBlock.getAttribute('data-node');

  // Route A and B through NAND to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${nandId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${nandId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${nandId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  // NAND is high unless both inputs are high.
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(0).click(); // A = 1, B = 0
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(1).click(); // A = 1, B = 1
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click(); // A = 0, B = 1
  await expect(page.locator('#editorResults')).toContainText('= 1');
});

test('NOT gate inverts its connected input', async ({ page }) => {
  await page.getByRole('button', { name: 'NOT', exact: true }).click();
  const notBlock = page.locator('#editorStage g[data-node]').last();
  const notId = await notBlock.getAttribute('data-node');

  // Route A through NOT to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${notId}"] .nodepin`).nth(0).click();
  await page.locator(`#editorStage g[data-node="${notId}"] .nodepin`).nth(1).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 1'); // NOT 0 = 1
  await page.locator('#editorControls button').nth(0).click();
  await expect(page.locator('#editorResults')).toContainText('= 0'); // NOT 1 = 0
  await page.locator('#editorControls button').nth(0).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
});

test('NOR gate evaluates all input combinations correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'NOR', exact: true }).click();
  const norBlock = page.locator('#editorStage g[data-node]').last();
  const norId = await norBlock.getAttribute('data-node');

  // Route A and B through NOR to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${norId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${norId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${norId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 1'); // 00
  await page.locator('#editorControls button').nth(0).click(); // 10
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(1).click(); // 11
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click(); // 01
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('XOR gate evaluates all input combinations correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'XOR', exact: true }).click();
  const xorBlock = page.locator('#editorStage g[data-node]').last();
  const xorId = await xorBlock.getAttribute('data-node');

  // Route A and B through XOR to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${xorId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${xorId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${xorId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 0'); // 00
  await page.locator('#editorControls button').nth(0).click(); // 10
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(1).click(); // 11
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click(); // 01
  await expect(page.locator('#editorResults')).toContainText('= 1');
});

test('XNOR gate evaluates all input combinations correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'XNOR', exact: true }).click();
  const xnorBlock = page.locator('#editorStage g[data-node]').last();
  const xnorId = await xnorBlock.getAttribute('data-node');

  // Route A and B through XNOR to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${xnorId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${xnorId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${xnorId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 1'); // 00
  await page.locator('#editorControls button').nth(0).click(); // 10
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(1).click(); // 11
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(0).click(); // 01
  await expect(page.locator('#editorResults')).toContainText('= 0');
});


test('D flip-flop captures data only on the rising clock edge', async ({ page }) => {
  await page.getByRole('button', { name: 'D flip-flop', exact: true }).click();
  const dff = page.locator('#editorStage g[data-node]').last();
  const dffId = await dff.getAttribute('data-node');

  // Connect A to D, B to CLK, and Q to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${dffId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${dffId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${dffId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click(); // D = 1, clock stays low
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(1).click(); // rising edge captures D = 1
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(0).click(); // D = 0 while clock is high
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(1).click(); // falling edge does not capture
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(1).click(); // next rising edge captures D = 0
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('D latch follows data while enabled and holds its value while disabled', async ({ page }) => {
  await page.getByRole('button', { name: 'D latch', exact: true }).click();
  const latch = page.locator('#editorStage g[data-node]').last();
  const latchId = await latch.getAttribute('data-node');

  // Connect A to D, B to Enable, and Q to the existing output terminal.
  await page.locator('#editorStage g[data-node="1"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${latchId}"] .nodepin`).nth(0).click();
  await page.locator('#editorStage g[data-node="2"] .nodepin').click();
  await page.locator(`#editorStage g[data-node="${latchId}"] .nodepin`).nth(1).click();
  await page.locator(`#editorStage g[data-node="${latchId}"] .nodepin`).nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();

  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(0).click(); // D = 1, Enable = 0
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(1).click(); // Enable = 1, latch follows D
  await expect(page.locator('#editorResults')).toContainText('= 1');
  await page.locator('#editorControls button').nth(0).click(); // D = 0 while enabled
  await expect(page.locator('#editorResults')).toContainText('= 0');
  await page.locator('#editorControls button').nth(1).click(); // Disable, stored value remains 0
  await page.locator('#editorControls button').nth(0).click(); // D = 1 while disabled
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('wire hit areas make wires easy to select and delete', async ({ page }) => {
  const blocks = page.locator('#editorStage g[data-node]');
  const wires = page.locator('#editorStage path.editor-wire');
  const hitAreas = page.locator('#editorStage path.wire-hit-area');

  await expect(blocks).toHaveCount(4);
  await expect(wires).toHaveCount(3);
  await expect(hitAreas).toHaveCount(3);

  // The wider transparent hit area selects the wire without selecting its blocks.
  await hitAreas.nth(2).click({ force: true });
  await page.getByRole('button', { name: 'Delete selected' }).click();

  await expect(blocks).toHaveCount(4);
  await expect(wires).toHaveCount(2);
  await expect(hitAreas).toHaveCount(2);
});

test('undo and redo restore deleted wires and added blocks', async ({ page }) => {
  const blocks = page.locator('#editorStage g[data-node]');
  const wires = page.locator('#editorStage path.editor-wire');

  await expect(blocks).toHaveCount(4);
  await expect(wires).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();

  await page.locator('#editorStage path.wire-hit-area').nth(2).click({ force: true });
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await expect(wires).toHaveCount(2);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(wires).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(wires).toHaveCount(2);

  await page.getByRole('button', { name: 'OR', exact: true }).click();
  await expect(blocks).toHaveCount(5);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(blocks).toHaveCount(4);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(blocks).toHaveCount(5);
});

test('highlights valid input pins while a wire connection is pending', async ({ page }) => {
  const stage = page.locator('#editorStage');
  const inputs = stage.locator('.nodepin.available');

  await expect(stage).not.toHaveClass(/connection-active/);
  await expect(inputs).toHaveCount(0);

  // Selecting A's output activates connection mode and highlights all valid target inputs.
  await stage.locator('g[data-node="1"] .nodepin').click();
  await expect(stage).toHaveClass(/connection-active/);
  await expect(inputs).toHaveCount(3);
  await expect(stage.locator('g[data-node="1"] .nodepin')).toHaveClass(/pending/);

  // Completing the connection clears the hint and returns pins to their normal appearance.
  await stage.locator('g[data-node="3"] .nodepin').nth(0).click();
  await expect(stage).not.toHaveClass(/connection-active/);
  await expect(inputs).toHaveCount(0);
  await expect(stage.locator('path.editor-wire')).toHaveCount(3);
});

test('custom instance and pin names are reflected in the editor', async ({ page }) => {
  const stage = page.locator('#editorStage');
  await stage.locator('g[data-node="3"]').click();

  await page.locator('#instanceName').fill('CORE_AND');
  await page.locator('#inputPinNames').fill('LEFT, RIGHT');
  await page.locator('#outputPinNames').fill('RESULT');
  await page.getByRole('button', { name: 'Apply names' }).click();

  await expect(page.locator('#editorMessage')).toContainText('Names updated for CORE_AND');
  await expect(stage.locator('g[data-node="3"]')).toContainText('CORE_AND');
  await expect(stage.locator('g[data-node="3"] .custom-pin-label')).toHaveText(['LEFT', 'RIGHT', 'RESULT']);
});

test('rejects duplicate instance names without changing the selected block', async ({ page }) => {
  const stage = page.locator('#editorStage');
  await stage.locator('g[data-node="3"]').click();

  await page.locator('#instanceName').fill('A');
  await page.locator('#inputPinNames').fill('LEFT, RIGHT');
  await page.locator('#outputPinNames').fill('RESULT');
  await page.getByRole('button', { name: 'Apply names' }).click();

  await expect(page.locator('#editorMessage')).toContainText('already used');
  await expect(stage.locator('g[data-node="3"]')).toContainText('AND1');
});

test('resizing a gate input count adds and removes input pins', async ({ page }) => {
  const stage = page.locator('#editorStage');
  const gate = stage.locator('g[data-node="3"]');

  await gate.click();
  await page.locator('#inputPlus').click();
  await expect(gate.locator('.nodepin')).toHaveCount(4);
  await expect(page.locator('#editorMessage')).toContainText('3 input port(s)');

  await page.locator('#inputMinus').click();
  await expect(gate.locator('.nodepin')).toHaveCount(3);
  await expect(page.locator('#editorMessage')).toContainText('2 input port(s)');
});


test('VDD and GND source blocks provide constant logic levels', async ({ page }) => {
  const blocks = page.locator('#editorStage g[data-node]');
  await page.locator('[data-add="VDD"]').click();
  await page.locator('[data-add="GND"]').click();
  await expect(blocks).toHaveCount(6);
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'VDD' })).toHaveCount(1);
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'GND' })).toHaveCount(1);

  const vdd = page.locator('#editorStage g[data-node]').filter({ hasText: 'VDD' });
  const gnd = page.locator('#editorStage g[data-node]').filter({ hasText: 'GND' });
  // Force the AND gate's first input high and second input low.
  await vdd.locator('.nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(0).click();
  await gnd.locator('.nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(1).click();
  await expect(page.locator('#editorResults')).toContainText('= 0');

  // Replacing the low source with VDD makes both AND inputs high.
  await vdd.locator('.nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(1).click();
  await expect(page.locator('#editorResults')).toContainText('= 1');
});

test('VDD and GND survive Verilog export and re-import', async ({ page }) => {
  await page.locator('[data-add="VDD"]').click();
  await page.locator('[data-add="GND"]').click();
  const vdd = page.locator('#editorStage g[data-node]').filter({ hasText: 'VDD' });
  const gnd = page.locator('#editorStage g[data-node]').filter({ hasText: 'GND' });
  await vdd.locator('.nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(0).click();
  await gnd.locator('.nodepin').click();
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(1).click();

  // Include the gate output in the round-trip, so the imported circuit is behaviorally checked too.
  await page.locator('#editorStage g[data-node="3"] .nodepin').nth(2).click();
  await page.locator('#editorStage g[data-node="4"] .nodepin').click();
  await expect(page.locator('#editorResults')).toContainText('= 0');

  await page.locator('#exportVerilog').click();
  const exported = await page.locator('#verilogText').inputValue();
  expect(exported).toContain("1'b1");
  expect(exported).toContain("1'b0");

  await page.locator('#verilogText').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, exported);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported');
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'VDD' })).toHaveCount(1);
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'GND' })).toHaveCount(1);
  await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(3);
  await expect(page.locator('#editorResults')).toContainText('= 0');
});

test('large benchmark uses a scrollable canvas and remains editable after scrolling', async ({ page }) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', 'c432.v'), 'utf8');
  await page.locator('#verilogText').fill(source);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported');

  const viewport = page.locator('#editorViewport');
  const svg = page.locator('#editorStage');
  expect(await svg.locator('g[data-node]').count()).toBeGreaterThan(0);
  const dimensions = await viewport.evaluate(el => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

  // The bottom of the benchmark remains reachable, and its wires still render.
  expect(await svg.locator('path.editor-wire').count()).toBeGreaterThan(0);
  const lastNode = svg.locator('g[data-node]').last();
  await lastNode.scrollIntoViewIfNeeded();
  await expect(lastNode).toBeVisible();

  // Drag a visible block slightly and confirm the canvas continues to render.
  const before = await lastNode.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 18, before.y + before.height / 2 + 12, { steps: 3 });
  await page.mouse.up();
  expect(await svg.locator('g[data-node]').count()).toBeGreaterThan(0);
  expect(await svg.locator('path.editor-wire').count()).toBeGreaterThan(0);
});

test('workspace zoom controls scale the circuit and reset to 100 percent', async ({ page }) => {
  const viewport = page.locator('#editorViewport');
  const svg = page.locator('#editorStage');
  await expect(page.locator('#editorZoomLevel')).toHaveText('100%');
  const before = await svg.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('#editorZoomLevel')).toHaveText('110%');
  const zoomed = await svg.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  expect(zoomed.width).toBeGreaterThan(before.width);
  expect(zoomed.height).toBeGreaterThan(before.height);
  await page.getByRole('button', { name: '110%' }).click();
  await expect(page.locator('#editorZoomLevel')).toHaveText('100%');
  const reset = await svg.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  expect(Math.abs(reset.width - before.width)).toBeLessThan(1);
  expect(Math.abs(reset.height - before.height)).toBeLessThan(1);
  await expect(viewport).toBeVisible();
});


test('fit to view scales the complete circuit to the visible workspace', async ({ page }) => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'benchmarks', 'iscas85', 'c432.v'), 'utf8');
  await page.locator('#verilogText').fill(source);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported');

  const viewport = page.locator('#editorViewport');
  const svg = page.locator('#editorStage');
  await page.locator('#editorFitView').click();

  const fitted = await viewport.evaluate(el => ({
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight
  }));
  expect(fitted.scrollWidth).toBeLessThanOrEqual(fitted.clientWidth + 1);
  expect(fitted.scrollHeight).toBeLessThanOrEqual(fitted.clientHeight + 1);
  const zoomLevel = Number((await page.locator('#editorZoomLevel').textContent()).replace('%', ''));
  expect(zoomLevel).toBeLessThan(100);
  await expect(svg).toBeVisible();
});

test('holding Space and dragging pans the circuit workspace', async ({ page }) => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'benchmarks', 'iscas85', 'c432.v'), 'utf8');
  await page.locator('#verilogText').fill(source);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported');

  const viewport = page.locator('#editorViewport');
  // Ensure the canvas overflows in both directions so panning can be observed.
  for (let i = 0; i < 5; i++) await page.locator('#editorZoomIn').click();
  await viewport.evaluate(el => { el.scrollLeft = 120; el.scrollTop = 120; });
  const before = await viewport.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
  const box = await viewport.boundingBox();
  await viewport.evaluate(el => el.focus());
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 145, box.y + 150, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const after = await viewport.evaluate(el => ({ left: el.scrollLeft, top: el.scrollTop }));
  expect(after.left).toBeGreaterThan(before.left);
  expect(after.top).toBeGreaterThan(before.top);
});


test('F and f fit the complete circuit to the workspace', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fitDebug = [];
    window.addEventListener('keydown', e => {
      if (e.key.toLowerCase() !== 'f') return;
      window.__fitDebug.push({ phase: 'capture', key: e.key, target: e.target?.id || e.target?.tagName, active: document.activeElement?.id || document.activeElement?.tagName, prevented: e.defaultPrevented, zoom: window.fpgaZoom, message: document.querySelector('#editorMessage')?.textContent });
      queueMicrotask(() => window.__fitDebug.push({ phase: 'microtask', prevented: e.defaultPrevented, zoom: window.fpgaZoom, message: document.querySelector('#editorMessage')?.textContent }));
    }, true);
    document.addEventListener('DOMContentLoaded', () => {
      const msg = document.querySelector('#editorMessage');
      if (msg) new MutationObserver(() => window.__fitDebug.push({ phase: 'message-change', message: msg.textContent, zoom: window.fpgaZoom })).observe(msg, { childList: true, characterData: true, subtree: true });
    });
  });
  await page.reload();
  const viewport = page.locator('#editorViewport');
  const svg = page.locator('#editorStage');
  await page.locator('#editorZoomIn').click();
  await page.keyboard.press('f');
  console.log('FIT DEBUG after lower f:', JSON.stringify(await page.evaluate(() => ({ events: window.__fitDebug, active: document.activeElement?.id || document.activeElement?.tagName, zoom: window.fpgaZoom, zoomLabel: document.querySelector('#editorZoomLevel')?.textContent, message: document.querySelector('#editorMessage')?.textContent }))));
  await expect(page.locator('#editorMessage')).toContainText('Fitted the complete circuit');
  const zoomByLowerF = await page.locator('#editorZoomLevel').textContent();

  await page.locator('#editorZoomIn').click();
  await page.locator('#editorFitView').click();
  const zoomByButton = await page.locator('#editorZoomLevel').textContent();
  expect(zoomByLowerF).toBe(zoomByButton);

  await page.locator('#editorZoomIn').click();
  await page.keyboard.press('Shift+F');
  await expect(page.locator('#editorMessage')).toContainText('Fitted the complete circuit');
  const zoomByUpperF = await page.locator('#editorZoomLevel').textContent();
  expect(zoomByUpperF).toBe(zoomByButton);

  await page.locator('#instanceName').focus();
  await page.locator('#instanceName').fill('x');
  await page.keyboard.press('f');
  await expect(page.locator('#instanceName')).toHaveValue('xf');
  await expect(viewport).toBeVisible();
  await expect(svg).toBeVisible();
});

test('logic gates use schematic symbols instead of visible rectangular bodies', async ({ page }) => {
  const gate = page.locator('#editorStage g[data-node="3"]');
  await expect(gate.locator('path')).toHaveCount(1);
  await expect(gate.locator('rect.nodebox')).toHaveAttribute('stroke', 'transparent');
  await expect(gate.locator('path')).toHaveAttribute('stroke', 'var(--site-primary)');
});
