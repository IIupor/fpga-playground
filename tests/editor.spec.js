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
