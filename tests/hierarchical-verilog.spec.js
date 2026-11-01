const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('imports a multi-module Verilog project and navigates down and up the hierarchy', async ({ page }) => {
  const source = ['module leaf(input wire [1:0] a, output wire y);','  and g1 (y, a[1], a[0]);','endmodule','module middle(input wire [1:0] a, output wire y);','  leaf u_leaf (.a(a), .y(y));','endmodule','module top(input wire [1:0] a, output wire y);','  middle u_middle (.a(a), .y(y));','endmodule'].join('\n');
  await page.locator('#verilogText').fill(source);
  expect(await page.evaluate(text => window.fpgaVerilogProject.hasHierarchicalInstances(text), source)).toBe(true);
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project');
  await expect(page.locator('#hierarchyStatus')).toContainText('top');
  const instance = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_middle' });
  await expect(instance).toHaveCount(1);
  await instance.click();
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / middle');
  const child = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_leaf' });
  await expect(child).toHaveCount(1);
  await child.click();
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / middle / u_leaf / leaf');
  await page.keyboard.press('Control+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('top / u_middle / middle');
  await page.locator('#hierarchyUp').click();
  await expect(page.locator('#hierarchyStatus')).toContainText('top');
});

test('loads multiple Liberty and Verilog libraries and simulates combinational and sequential cells', async ({ page }) => {
  page.on('console', message => console.log('BROWSER_CONSOLE ' + message.text()));
  page.on('pageerror', error => console.log('BROWSER_PAGEERROR ' + error.message));
  const libertyA = 'library(test_a) { cell(SKY_AND2_X1) { pin(A) { direction : input; } pin(B) { direction : input; } pin(Y) { direction : output; function : "A & B"; } } }';
  const libertyB = 'library(test_b) { cell(SKY_INV_X1) { pin(A) { direction : input; } pin(Y) { direction : output; function : "!A"; } } }';
  const libertyFF = 'library(test_ff) { cell(SKY_DFF_X1) { ff(IQ, IQ_N) { next_state : "D"; clocked_on : "CLK"; } pin(CLK) { direction : input; } pin(D) { direction : input; } pin(Q) { direction : output; function : "IQ"; } pin(Q_N) { direction : output; function : "!IQ"; } } }';
  const verilogLib = ['module CUSTOM_BUF(input wire A, output wire Y);',' assign Y = A;','endmodule'].join('\n');
  const verilogLib2 = ['module CUSTOM_INV(input wire A, output wire Y);',' not g1 (Y, A);','endmodule'].join('\n');
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles([
    { name: 'sky_and.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyA) },
    { name: 'sky_inv.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyB) },
    { name: 'sky_dff.lib', mimeType: 'text/plain', buffer: Buffer.from(libertyFF) },
    { name: 'custom_cells.v', mimeType: 'text/plain', buffer: Buffer.from(verilogLib) },
    { name: 'custom_cells_2.v', mimeType: 'text/plain', buffer: Buffer.from(verilogLib2) }
  ]);
  await expect(page.locator('#libraryStatus')).toContainText('5 library file(s)');
  await expect(page.locator('#libraryStatus')).toContainText('3 Liberty cells');
  await expect(page.locator('#libraryStatus')).toContainText('2 Verilog modules');
  const netlist = ['module mapped_top(input wire a, input wire b, input wire clk, output wire y, output wire z, output wire w, output wire v, output wire q, output wire qn);',' SKY_AND2_X1 u_and (.A(a), .B(b), .Y(y));',' SKY_INV_X1 u_inv (.A(y), .Y(z));',' CUSTOM_BUF u_buf (.A(y), .Y(w));',' CUSTOM_INV u_custom_inv (.A(z), .Y(v));',' SKY_DFF_X1 u_dff (.CLK(clk), .D(a), .Q(q), .Q_N(qn));','endmodule'].join('\n');
  await page.locator('#verilogText').fill(netlist);
  const parsedPortReport = await page.evaluate(source => {
    const mod = window.fpgaVerilogProject.parseVerilog(source, 'diagnostic.v').get('mapped_top');
    const project = window.fpgaVerilogProject.projectFrom([...window.fpgaVerilogProject.state.libraries, { name: 'design.v', text: source }]);
    const projectTop = project.modules.get('mapped_top');
    return {
      parserPorts: mod.ports.map(port => ({ name: port.name, direction: port.direction })),
      projectPorts: projectTop.ports.map(port => ({ name: port.name, direction: port.direction })),
      projectTopNames: project.tops.map(top => top.name),
      graphInputs: window.fpgaVerilogProject.graphFor(projectTop, []).nodes.filter(node => node.type === 'INPUT').map(node => node.name),
      portsAfterGraph: projectTop.ports.map(port => ({ name: port.name, direction: port.direction }))
    };
  }, netlist);
  console.log('MAPPED_PORT_REPORT ' + JSON.stringify(parsedPortReport));
  await page.locator('#importVerilog').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project');
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'u_and' })).toContainText('SKY_AND2_X1');
  const cell = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_and' });
  const graphInputReport = await page.evaluate(() => {
    const state = window.fpgaVerilogProject.state;
    const projectTop = state.project.modules.get('mapped_top');
    return {
      module: state.current.module.name,
      currentPorts: state.current.module.ports.map(port => ({ name: port.name, direction: port.direction })),
      projectPorts: projectTop.ports.map(port => ({ name: port.name, direction: port.direction })),
      sameModuleObject: state.current.module === projectTop,
      projectTops: state.project.tops.map(top => top.name),
      inputNodes: window.fpgaNodes.filter(node => node.type === 'INPUT').map(node => node.name)
    };
  });
  console.log('MAPPED_GRAPH_REPORT ' + JSON.stringify(graphInputReport));
  const inputControls = page.locator('#editorControls .control');
  await expect(inputControls).toHaveCount(3);
  await inputControls.filter({ hasText: 'Input a' }).locator('button').click();
  await inputControls.filter({ hasText: 'Input b' }).locator('button').click();
  await expect(cell).toContainText('VALUE: 1');
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'u_inv' })).toContainText('VALUE: 0');
  const custom = page.locator('#editorStage g[data-node]').filter({ hasText: 'u_buf' });
  await expect(custom).toContainText('VALUE: 1');
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'u_custom_inv' })).toContainText('VALUE: 1');
  await page.locator('#editorControls button').nth(2).click();
  await expect(page.locator('#editorStage g[data-node]').filter({ hasText: 'u_dff' })).toContainText('VALUE: 1');
  await custom.click();
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('CUSTOM_BUF');
});

test('rejects duplicate Liberty cell definitions without discarding already loaded libraries', async ({ page }) => {
  const lib = 'library(test) { cell(DUP_X1) { pin(A) { direction : input; } } }';
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles({ name: 'first.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) });
  await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles({ name: 'duplicate.lib', mimeType: 'text/plain', buffer: Buffer.from(lib) });
  await expect(page.locator('#editorMessage')).toContainText('Duplicate Liberty cell DUP_X1');
  await expect(page.locator('#libraryStatus')).toContainText('1 library file(s)');
});

test('imports a real hierarchical SKY130 SoC and resolves ten mapped gate-level blocks', async ({ page }) => {
  test.setTimeout(180000);
  const fixtureDir = path.join(__dirname, 'fixtures', 'sky130');
  test.skip(!fs.existsSync(path.join(fixtureDir, 'sky130_fd_sc_hd__tt_025C_1v80.lib')), 'SKY130 PDK fixtures are provisioned by the PDK-enabled CI workflows');
  const liberty = fs.readFileSync(path.join(fixtureDir, 'sky130_fd_sc_hd__tt_025C_1v80.lib'));
  const libraryFiles = fs.readdirSync(fixtureDir).filter(name => name.endsWith('.v') && name !== 'soc_top.v');
  const libraryInputs = [
    { name: 'sky130_fd_sc_hd__tt_025C_1v80.lib', mimeType: 'text/plain', buffer: liberty },
    ...libraryFiles.map(name => ({ name, mimeType: 'text/plain', buffer: fs.readFileSync(path.join(fixtureDir, name)) }))
  ];
  await page.locator('#importLibraries').click();
  await page.locator('#libraryFiles').setInputFiles(libraryInputs);
  await expect(page.locator('#libraryStatus')).toContainText('Verilog modules', { timeout: 120000 });

  const topSource = fs.readFileSync(path.join(fixtureDir, 'soc_top.v'), 'utf8');
  await page.locator('#verilogFile').setInputFiles({ name: 'soc_top.v', mimeType: 'text/plain', buffer: Buffer.from(topSource) });
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project', { timeout: 120000 });
  await expect(page.locator('#editorMessage')).toContainText('0 unresolved instances');

  const report = await page.evaluate(() => {
    const project = window.fpgaVerilogProject.state.project;
    const top = project.modules.get('soc_top');
    const selectedNames = ['uart_rx','apb_spi','apb_i2c','clk_rst_ctrl','boot_rom','sys_ctrl','icache','dma_axi_master','dcache','pll_ctrl'];
    const designs = selectedNames.map(fileName => {
      const mod = [...project.modules.values()].find(m => m.source === fileName + '.v');
      return mod && { name: fileName, instances: mod.instances.length,
        cellInstances: mod.instances.filter(x => !!x.cell).length,
        resolved: mod.instances.filter(x => !!x.cell || !!x.definition).length,
        unresolved: mod.instances.filter(x => x.unresolved).length };
    });
    const selectedInstance = top?.instances[0] || null;
    const node = selectedInstance && window.fpgaNodes.find(n => n.id === selectedInstance.graphNodeId);
    return { moduleCount: project.modules.size, topInstances: top?.instances.length || 0,
      topUnresolved: top?.instances.filter(x => x.unresolved).length ?? -1,
      childName: selectedInstance?.name || null, childType: selectedInstance?.type || null,
      selectedNodeId: selectedInstance?.graphNodeId ?? null,
      hasSelectedNode: !!node, designs };
  });
  expect(report.moduleCount).toBeGreaterThan(20);
  console.log('SKY130_REPORT ' + JSON.stringify(report));
  expect(report.topInstances).toBeGreaterThan(0);
  expect(report.topUnresolved).toBe(0);
  expect(report.hasSelectedNode).toBe(true);
  expect(report.selectedInstanceType).toBeTruthy();
  for (const design of report.designs) {
    expect(design, 'all ten named SKY130 designs must be present').toBeTruthy();
    expect(design.instances, design.name + ' standard-cell instances').toBeGreaterThan(0);
    expect(design.cellInstances, design.name + ' Liberty-mapped instances').toBeGreaterThan(0);
    expect(design.resolved, design.name + ' resolved instances').toBe(design.instances);
    expect(design.unresolved, design.name + ' unresolved instances').toBe(0);
  }

  const childNode = page.locator('#editorStage g[data-node]').filter({ hasText: report.childName });
  await expect(childNode).toHaveCount(1);
  await childNode.click();
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('soc_top / ' + report.childName + ' / ' + report.childType);
  await page.keyboard.press('Control+E');
  await expect(page.locator('#hierarchyStatus')).toContainText('soc_top');
});
