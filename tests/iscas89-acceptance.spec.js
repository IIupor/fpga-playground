const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const circuits = [
  's27','s298','s344','s349','s382','s386','s400','s420','s444','s510',
  's526','s641','s713','s820','s832','s838','s953','s1196','s1238','s1423',
  's1488','s5378','s9234','s13207','s15850','s35932','s38417','s38584'
];

function readCircuit(name) {
  const file = path.join(__dirname, '..', 'benchmarks', 'iscas89', name + '.v');
  const source = fs.readFileSync(file, 'utf8');
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const module = clean.match(new RegExp('\\bmodule\\s+' + name + '\\s*\\([^)]*\\)\\s*;([\\s\\S]*?)\\bendmodule\\b', 'i'));
  if (!module) throw new Error(name + ': top module not found');
  const names = kind => [...module[1].matchAll(new RegExp('\\b' + kind + '\\s+([^;]+);', 'gi'))]
    .flatMap(match => match[1].split(',').map(value => value.trim().replace(/\s+/g, '')))
    .filter(Boolean);
  const inputs = [...new Set(names('input'))];
  const outputs = [...new Set(names('output'))];
  const dffMatch = source.match(/#\s*(\d+)\s+D-type flipflops/i);
  if (!inputs.includes('CK') || !inputs.length || !outputs.length || !dffMatch)
    throw new Error(name + ': missing CK, ports, or DFF metadata');
  return { file, source, inputs, outputs, dffs: Number(dffMatch[1]) };
}

function verifySequentialEquivalence(name, circuit, exported) {
  const dataInputs = circuit.inputs.filter(input => input !== 'CK');
  let seed = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const randomBit = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed & 1;
  };
  const vectors = Array.from({ length: 24 }, () => dataInputs.map(randomBit));
  const inputDecls = circuit.inputs.map(input => '  reg ' + input + ';').join('\n');
  const outputDecls = circuit.outputs.map(output => '  wire orig_' + output + ', exp_' + output + ';').join('\n');
  const originalPorts = [
    ...circuit.inputs.map(input => '.' + input + '(' + input + ')'),
    ...circuit.outputs.map(output => '.' + output + '(orig_' + output + ')')
  ].join(', ');
  const exportedPorts = [
    ...circuit.inputs.map(input => '.' + input + '(' + input + ')'),
    ...circuit.outputs.map(output => '.' + output + '(exp_' + output + ')')
  ].join(', ');
  const originalBus = circuit.outputs.map(output => 'orig_' + output).join(', ');
  const exportedBus = circuit.outputs.map(output => 'exp_' + output).join(', ');
  const cycles = vectors.map((vector, index) => {
    const assignments = dataInputs.map((input, bit) => '    ' + input + " = 1'b" + vector[bit] + ';').join('\n');
    return "    CK = 1'b0;\n" + assignments + "\n    #1;\n    CK = 1'b1;\n    #1;\n    $display(\"EQ:" +
      index + ":%b:%b\", {" + originalBus + "}, {" + exportedBus + "});\n    CK = 1'b0;\n    #1;";
  }).join('\n');
  const testbench = 'module tb;\n' + inputDecls + '\n' + outputDecls + '\n' +
    '  ' + name + ' original_dut (' + originalPorts + ');\n' +
    '  fpga_playground exported_dut (' + exportedPorts + ');\n' +
    "  initial begin\n    CK = 1'b0;\n" +
    dataInputs.map(input => '    ' + input + " = 1'b0;").join('\n') + '\n' +
    '    #1;\n' + cycles + '\n    $finish;\n  end\nendmodule\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-iscas89-'));
  try {
    const tbPath = path.join(dir, 'tb.v');
    const exportedPath = path.join(dir, 'exported.v');
    const executable = path.join(dir, 'sim');
    fs.writeFileSync(tbPath, testbench);
    fs.writeFileSync(exportedPath, exported);
    execFileSync('iverilog', ['-g2012', '-s', 'tb', '-o', executable, circuit.file, exportedPath, tbPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
    const output = execFileSync('vvp', [executable],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
    const rows = [...output.matchAll(/^EQ:(\d+):([01xXzZ]+):([01xXzZ]+)$/gm)];
    expect(rows.length, name + ': every sequential vector must produce outputs').toBe(vectors.length);
    for (const row of rows) {
      expect(row[2].toLowerCase(), name + ': reference model produced unknown output at cycle ' + row[1]).not.toMatch(/[xz]/);
      expect(row[3].toLowerCase(), name + ': exported model produced unknown output at cycle ' + row[1]).not.toMatch(/[xz]/);
      expect(row[3], name + ': exported model differs from reference at cycle ' + row[1]).toBe(row[2]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const name of circuits) {
  test(name + ': sequential import, placement, conflict-free routing and simulation', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);
    const circuit = readCircuit(name);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(name);
    await expect(page.locator('#editorMessage')).toContainText(new RegExp('Loaded ' + name + '\\.v'), { timeout: 180000 });

    const report = await page.evaluate(() => {
      const nodes = [...window.fpgaNodes], wires = [...window.fpgaWires];
      const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
      const groups = [...document.querySelectorAll('#editorStage g[data-node]')];
      const boxes = groups.map(group => {
        const rect = group.getBBox();
        const match = /translate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)/.exec(group.getAttribute('transform') || '');
        const dx = match ? Number(match[1]) : 0, dy = match ? Number(match[2]) : 0;
        return { id: Number(group.getAttribute('data-node')), l: rect.x + dx, t: rect.y + dy,
          r: rect.x + dx + rect.width, b: rect.y + dy + rect.height };
      });
      const nodeById = new Map(nodes.map(node => [node.id, node]));
      const wireById = new Map(wires.map(wire => [wire.id, wire]));
      const routes = paths.map(path => ({
        id: Number(path.dataset.wire), from: Number(path.dataset.from), to: Number(path.dataset.to),
        points: [...(path.getAttribute('d') || '').matchAll(/[ML]\s*(-?[\d.eE+]+)[,\s]+(-?[\d.eE+]+)/g)]
          .map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
      }));
      let emptyRoutes = 0, diagonalSegments = 0, blockPenetrations = 0, wrongEndpoints = 0;
      const horizontal = new Map(), vertical = new Map(), rowBins = new Map(), columnBins = new Map();
      const binSize = 128;
      const addBin = (map, key, box) => { if (!map.has(key)) map.set(key, []); map.get(key).push(box); };
      for (const box of boxes) {
        for (let y = Math.floor(box.t / binSize); y <= Math.floor(box.b / binSize); y++) addBin(rowBins, y, box);
        for (let x = Math.floor(box.l / binSize); x <= Math.floor(box.r / binSize); x++) addBin(columnBins, x, box);
      }
      for (const route of routes) {
        if (route.points.length < 2) { emptyRoutes++; continue; }
        const wire = wireById.get(route.id), source = nodeById.get(route.from), target = nodeById.get(route.to);
        if (!wire || !source || !target) { wrongEndpoints++; continue; }
        const sourceWidth = ['INPUT', 'OUTPUT', 'VDD', 'GND'].includes(source.type) ? 112 : 150;
        const first = route.points[0], last = route.points[route.points.length - 1];
        if (first.x !== source.x + sourceWidth || first.y !== source.y + 30 + (wire.fromPin || 0) * 22 ||
            last.x !== target.x || last.y !== target.y + 30 + (wire.toPin || 0) * 22) wrongEndpoints++;
        for (let i = 1; i < route.points.length; i++) {
          const a = route.points[i - 1], b = route.points[i];
          if (a.x !== b.x && a.y !== b.y) diagonalSegments++;
          const isHorizontal = a.y === b.y, coordinate = isHorizontal ? a.y : a.x;
          const map = isHorizontal ? horizontal : vertical;
          if (!map.has(coordinate)) map.set(coordinate, []);
          map.get(coordinate).push({ lo: isHorizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
            hi: isHorizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y), from: route.from, wire: route.id });
          const candidates = isHorizontal ? (rowBins.get(Math.floor(a.y / binSize)) || []) :
            (columnBins.get(Math.floor(a.x / binSize)) || []);
          for (const box of candidates) {
            if (box.id === route.from || box.id === route.to) continue;
            const hit = isHorizontal
              ? a.y > box.t && a.y < box.b && Math.max(Math.min(a.x, b.x), box.l) < Math.min(Math.max(a.x, b.x), box.r)
              : a.x > box.l && a.x < box.r && Math.max(Math.min(a.y, b.y), box.t) < Math.min(Math.max(a.y, b.y), box.b);
            if (hit) blockPenetrations++;
          }
        }
      }
      let collinearOverlaps = 0;
      for (const map of [horizontal, vertical]) for (const segments of map.values()) {
        segments.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
        const active = [];
        for (const current of segments) {
          for (let i = active.length - 1; i >= 0; i--) if (active[i].hi <= current.lo) active.splice(i, 1);
          for (const previous of active)
            if (previous.wire !== current.wire && previous.from !== current.from) collinearOverlaps++;
          active.push(current);
        }
      }
      let nodeOverlaps = 0;
      const sorted = boxes.slice().sort((a, b) => a.l - b.l), activeBoxes = [];
      for (const box of sorted) {
        for (let i = activeBoxes.length - 1; i >= 0; i--) if (activeBoxes[i].r <= box.l + 1) activeBoxes.splice(i, 1);
        for (const other of activeBoxes)
          if (Math.min(box.b, other.b) - Math.max(box.t, other.t) > 1) nodeOverlaps++;
        activeBoxes.push(box);
      }
      const viewport = document.querySelector('#editorViewport'), stage = document.querySelector('#editorStage');
      return {
        nodes: nodes.length, renderedNodes: groups.length, wires: wires.length, renderedWires: paths.length,
        dffs: nodes.filter(node => node.type === 'DFF').length, emptyRoutes, diagonalSegments,
        blockPenetrations, collinearOverlaps, wrongEndpoints, nodeOverlaps,
        missingGeometry: boxes.filter(box => ![box.l, box.t, box.r, box.b].every(Number.isFinite)).length,
        fitWidth: stage.getBoundingClientRect().width <= viewport.clientWidth + 2,
        fitHeight: stage.getBoundingClientRect().height <= viewport.clientHeight + 2
      };
    });
    console.log('ISCAS89_ACCEPTANCE', name, JSON.stringify({ ...report, pageErrors }));
    expect(pageErrors, name + ': no browser runtime errors').toEqual([]);
    expect(report.nodes, name + ': every placed block must render').toBe(report.renderedNodes);
    expect(report.dffs, name + ': every sequential element must be imported').toBe(circuit.dffs);
    expect(report.wires, name + ': every connection must have a route').toBe(report.renderedWires);
    expect(report.emptyRoutes, name + ': no missing routes').toBe(0);
    expect(report.diagonalSegments, name + ': all routes must be orthogonal').toBe(0);
    expect(report.blockPenetrations, name + ': no wire may pass through a non-terminal block').toBe(0);
    expect(report.collinearOverlaps, name + ': unrelated wires may not overlap').toBe(0);
    expect(report.wrongEndpoints, name + ': all routes must terminate at their actual pins').toBe(0);
    expect(report.nodeOverlaps, name + ': placed blocks may not overlap').toBe(0);
    expect(report.missingGeometry, name + ': all blocks must have valid geometry').toBe(0);
    expect(report.fitWidth, name + ': imported design must fit the workspace width').toBe(true);
    expect(report.fitHeight, name + ': imported design must fit the workspace height').toBe(true);

    await page.locator('#exportVerilog').click();
    const exported = await page.locator('#verilogText').inputValue();
    expect(exported).toContain('module fpga_playground');
    verifySequentialEquivalence(name, circuit, exported);
  });
}
