const { test, expect } = require('@playwright/test');

test('top-level menus replace the old file and history buttons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Libraries', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import Verilog' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export Verilog' })).toHaveCount(0);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export file' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo (U)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redo (Shift+I)' })).toBeVisible();
});

test('I opens the two-pane Standard Primitives browser and Q shows selected cell details', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('i');
  await expect(page.locator('#libraryBrowser')).toBeVisible();
  await expect(page.locator('#libraryBrowserSources')).toContainText('Standard Primitives');
  await expect(page.locator('#libraryBrowserItems')).toContainText('AND');
  await page.locator('#editorStage g[data-node="3"]').click();
  await page.keyboard.press('q');
  await expect(page.locator('#selectedCellInfo')).toBeVisible();
  await expect(page.locator('#selectedCellInfo')).toContainText('Cell name');
  await expect(page.locator('#selectedCellInfo')).toContainText('Instance Name');
  await expect(page.locator('#selectedCellInfo')).toContainText('Input Pins');
  await expect(page.locator('#selectedCellInfo')).toContainText('Output Pins');
  await expect(page.locator('#selectedCellInfo')).toContainText('Function');
});

test('U and Shift+I perform Undo and Redo', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('i');
  await page.locator('#libraryBrowserItems button').filter({ hasText: /^OR$/ }).click();
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
  await page.keyboard.press('u');
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(4);
  await page.keyboard.press('Shift+i');
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(5);
});

test('loaded library can be removed from the project without changing its file', async ({ page }) => {
  await page.goto('/');
  const liberty = [
    'library(test_library) {',
    '  cell(TEST_AND) {',
    '    pin(A) { direction : input; }',
    '    pin(B) { direction : input; }',
    '    pin(Y) { direction : output; function : "A & B"; }',
    '  }',
    '}'
  ].join('\\n');
  await page.getByRole('button', { name: 'Libraries', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load Library' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'removable.lib', mimeType: 'text/plain', buffer: Buffer.from(liberty) });
  await expect(page.locator('#libraryStatus')).toContainText('1 Liberty cells');
  await page.getByRole('button', { name: 'Libraries', exact: true }).click();
  await expect(page.locator('#loadedLibraryMenu')).toContainText('removable.lib');
  await page.getByRole('button', { name: 'Remove library removable.lib' }).click();
  await expect(page.locator('#loadedLibraryMenu')).not.toContainText('removable.lib');
  await expect(page.locator('#libraryStatus')).toContainText('No libraries loaded');
});
