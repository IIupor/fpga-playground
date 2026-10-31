const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('imports a multi-module Verilog project and navigates down and up the hierarchy', async ({ page }) => {
  const source = ['module leaf(input wire a, input wire b, output wire y);','  and g1 (y, a, b);','endmodule','module middle(input wire a, input wire b, output wire y);','  leaf u_leaf (.a(a), .b(b), .y(y));','endmodule','module top(input wire a, input wire b, output wire y);','  middle u_middle (.a(a), .b(b), .y(y));','endmodule'].join('\n');
  await page.locator('#verilogText').fill(source); await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project');
  await expect(page.locator('#hierarchyStatus')).toContainText('top');
  const instance = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_middle' }); await expect(instance).toHaveCount(1); await instance.click(); await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / middle');
  const child = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_leaf' }); await expect(child).toHaveCount(1); await child.click(); await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / u_leaf / leaf');
  await page.keyboard.press('Control+E'); await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / middle');
  await page.locator('#hierarchyUp').click(); await expect(page.locator('#hierarchyStatus')).toContainText('top');
});

test('loads multiple Liberty files and resolves standard-cell instances by cell and pin names', async ({ page }) => {
  const libertyA = 'library(test_a) { cell(SKY_AND2_X1) { pin(A) { direction : input; } pin(B) { direction : input; } pin(Y) { direction : output; function : "A & B"; } } }';
  const libertyB = 'library(test_b) { cell(SKY_INV_X1) { pin(A) { direction : input; } pin(Y) { direction : output; function : "!A"; } } }';
  await page.locator('#importLibraries').click(); await page.locator('#libraryFiles').setInputFiles([{ name: 'sky_and.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyA) }, { name: 'sky_inv.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyB) }]);
  await expect(page.locator('#libraryStatus')).toContainText('2 library file(s)'); await expect(page.locator('#libraryStatus')).toContainText('2 Liberty cells');
  const netlist = ['module mapped_top(input wire a, input wire b, output wire y);','  SKY_AND2_X1 u_and (.A(a), .B(b), .Y(y));','endmodule'].join('\n');
  await page.locator('#verilogText').fill(netlist); await page.locator('#importVerilog').click(); await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project');
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_and' }); await expect(cell).toHaveCount(1); await expect(cell).toContainText('MODULE'); await expect(page.locator('#editorStage path.editor-wire')).toHaveCount(3);
});

test('rejects duplicate Liberty cell definitions without discarding already loaded libraries', async ({ page }) => {
  const lib = 'library(test) { cell(DUP_X1) { pin(A) { direction : input; } } }'; await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles({ name: 'first.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) }); await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
  await page.locator('#importLibraries').click(); await page.locator('#libraryFiles').setInputFiles({ name: 'duplicate.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) });
  await expect(page.locator('#editorMessage')).toContainText('Duplicate Liberty cell DUP_X1'); await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
});
