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
