const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

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

test('loads multiple Liberty and Verilog libraries and resolves cell/module instances', async ({ page }) => {
  const libertyA = 'library(test_a) { cell(SKY_AND2_X1) { pin(A) { direction : input; } pin(B) { direction : input; } pin(Y) { direction : output; function : "A & B"; } } }';
  const libertyB = 'library(test_b) { cell(SKY_INV_X1) { pin(A) { direction : input; } pin(Y) { direction : output; function : "!A"; } } }';
  const verilogLib = ['module CUSTOM_BUF(input wire A, output wire Y);',' assign Y = A;','endmodule'].join('\n');
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles([
    { name: 'sky_and.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyA) },
    { name: 'sky_inv.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyB) },
    { name: 'custom_cells.v', mimeType: 'text/plain', buffer: Buffer.from(verilogLib) }
  ]);
  await expect(page.locator('#libraryStatus')).toContainText('3 library file(s)');
  await expect(page.locator('#libraryStatus')).toContainText('2 Liberty cells');
  const netlist = ['module mapped_top(input wire a, input wire b, output wire y, output wire z, output wire w);',' SKY_AND2_X1 u_and (.A(a), .B(b), .Y(y));',' SKY_INV_X1 u_inv (.A(y), .Y(z));',' CUSTOM_BUF u_buf (.A(y), .Y(w));','endmodule'].join('\n');
  await page.locator('#verilogText').fill(netlist); await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project');
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'u_and' })).toContainText('SKY_AND2_X1');
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_and' });
  await page.locator('#editorControls button').nth(0).click(); await page.locator('#editorControls button').nth(1).click();
  await expect(cell).toContainText('VALUE: 1');
  const inverter = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_inv' }); await expect(inverter).toContainText('VALUE: 0');
  const custom = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_buf' }); await expect(custom).toHaveCount(1); await custom.click(); await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('CUSTOM_BUF');
});

test('rejects duplicate Liberty cell definitions without discarding already loaded libraries', async ({ page }) => {
  const lib = 'library(test) { cell(DUP_X1) { pin(A) { direction : input; } } }'; await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles({ name: 'first.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) }); await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
  await page.locator('#importLibraries').click(); await page.locator('#libraryFiles').setInputFiles({ name: 'duplicate.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) });
  await expect(page.locator('#editorMessage')).toContainText('Duplicate Liberty cell DUP_X1'); await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
});

test('parses ten independently synthesized SKY130 gate-level designs against the real Liberty library', async ({ page }) => {
  const fixtureDir = path.join(__dirname, 'fixtures', 'sky130');
  const library = fs.readFileSync(path.join(fixtureDir, 'sky130_fd_sc_hd__tt_025C_1v80.lib'));
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles({ name: 'sky130_fd_sc_hd__tt_025C_1v80.lib', mimeType: 'text/plain', buffer: library });
  await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');

  const designs = ['uart_rx','apb_spi','apb_i2c','clk_rst_ctrl','boot_rom','sys_ctrl','icache','dma_axi_master','dcache','pll_ctrl'];
  const sources = designs.map(name => ({ name: name + '.v', text: fs.readFileSync(path.join(fixtureDir, name + '.v'), 'utf8') }));
  const results = await page.evaluate(files => {
    const project = window.fpgaVerilogProject.projectFrom([
      ...window.fpgaVerilogProject.state.libraries,
      { name: 'ten_sky130_designs.v', text: files.map(f => f.text).join('\\n') }
    ]);
    return project.tops.map(top => ({
      name: top.name,
      instances: top.instances.length,
      resolved: top.instances.filter(x => !!x.cell).length,
      unresolved: top.instances.filter(x => x.unresolved).length
    }));
  }, sources);
  expect(results).toHaveLength(10);
  for (const result of results) {
    expect(result.instances, result.name + ' standard-cell instances').toBeGreaterThan(0);
    expect(result.resolved, result.name + ' resolved standard-cell instances').toBe(result.instances);
    expect(result.unresolved, result.name + ' unresolved standard-cell instances').toBe(0);
  }

  const uart = sources.find(x => x.name === 'uart_rx.v').text;
  await page.locator('#verilogText').fill(uart);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project', { timeout: 30000 });
  await expect(page.locator('#editorMessage')).toContainText('0 unresolved instances');
});
