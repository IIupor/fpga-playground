const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const s27Path = path.join(__dirname, '..', 'benchmarks', 'iscas89', 's27.v');
const s27Source = fs.readFileSync(s27Path, 'utf8');

async function expectS27DffModels(page) {
  const report = await page.evaluate(() => {
    const nodes = window.fpgaNodes || [];
    const project = window.fpgaVerilogProject.state.project;
    const top = project.modules.get('s27');
    const dffs = nodes.filter(node => node.name.startsWith('DFF_'));
    return {
      modules: [...project.modules.keys()],
      declaredDffPorts: project.modules.get('dff')?.ports.map(port => ({
        name: port.name, direction: port.direction
      })),
      topDffInstances: top.instances.filter(instance => instance.type === 'dff').map(instance => ({
        name: instance.name, resolved: !!instance.definition, unresolved: !!instance.unresolved
      })),
      dffs: dffs.map(node => ({
        type: node.type, name: node.name, moduleType: node.moduleType,
        inputNames: node.inputNames, outputNames: node.outputNames,
        connections: (window.fpgaWires || []).filter(wire => wire.to === node.id).map(wire => ({
          pin: wire.toPin,
          source: nodes.find(source => source.id === wire.from)?.outputNames?.[wire.fromPin || 0]
            || nodes.find(source => source.id === wire.from)?.name
        })).sort((a, b) => a.pin - b.pin)
      }))
    };
  });

  expect(report.modules).toContain('dff');
  expect(report.declaredDffPorts).toEqual([
    { name: 'CK', direction: 'INPUT' },
    { name: 'Q', direction: 'OUTPUT' },
    { name: 'D', direction: 'INPUT' }
  ]);
  expect(report.topDffInstances).toEqual([
    { name: 'DFF_0', resolved: true, unresolved: false },
    { name: 'DFF_1', resolved: true, unresolved: false },
    { name: 'DFF_2', resolved: true, unresolved: false }
  ]);
  expect(report.dffs).toHaveLength(3);
  for (const dff of report.dffs) {
    expect(dff.type).toBe('DFF');
    expect(dff.moduleType).toBe('dff');
    expect(dff.inputNames).toEqual(['D', 'CK']);
    expect(dff.outputNames).toEqual(['Q']);
    expect(dff.connections.map(connection => connection.pin)).toEqual([0, 1]);
  }
  expect(report.dffs[0].connections.map(connection => connection.source)).toEqual(['G10', 'CK']);
}

test('s27 loads through the Benchmark Load benchmark button and resolves its local dff module', async ({ page }) => {
  await page.goto('/');
  // Set the selection without firing change, so this specifically tests the button path.
  await page.locator('#benchmarkSelect').evaluate(select => { select.value = 's27'; });
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Loaded s27.v', { timeout: 30000 });
  await expectS27DffModels(page);
});

test('Import Verilog resolves the dff model declared in the same s27 file and keeps model pin names', async ({ page }) => {
  await page.goto('/');
  await page.locator('#verilogFile').setInputFiles({
    name: 's27.v',
    mimeType: 'text/plain',
    buffer: Buffer.from(s27Source)
  });
  await expect(page.locator('#editorMessage')).toContainText('Imported hierarchical project', { timeout: 30000 });
  await expectS27DffModels(page);

  await page.locator('#exportVerilog').click();
  const exported = await page.locator('#verilogText').inputValue();
  expect(exported).toContain('always @(posedge ');
  expect(exported).toContain('DFF_0_Q_reg');
});

test('selecting s27 loads the embedded sequential benchmark without a network fetch', async ({ page }) => {
  await page.route('**/benchmarks/iscas89/s27.v', route => route.abort());
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption('s27');
  await expect(page.locator('#editorMessage')).toContainText('Loaded s27.v', { timeout: 30000 });
  await expectS27DffModels(page);
  await expect(page.locator('#editorStage g[data-node]')).toHaveCount(19);
});
