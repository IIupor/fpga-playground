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
  await page.getByRole('button', { name: '＋ Input' }).click();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(4);
  await expect(page.locator('#editorMessage')).toContainText('Example restored');
});
