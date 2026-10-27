const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sourcePath = path.join(__dirname, '..', 'benchmarks', 'iscas85', 'c1908.v');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

function parseBenchmark(text) {
  const moduleMatch = text.match(/\bmodule\s+\w+\s*\(([\s\S]*?)\)\s*;([\s\S]*?)\bendmodule\b/i);
  if (!moduleMatch) throw new Error('No Verilog module found');
  let body = moduleMatch[2];
  body = body.replace(/\b(input|output)(?:\s+wire)?\s+([^;]+);/gi,
    (_, kind, names) => names.split(',').map(name => `${kind} ${name.trim()};`).join('\n'));

  const declarations = [...body.matchAll(/\b(input|output)(?:\s+wire)?\s+([A-Za-z_$][\w$]*)\s*;/gi)];
  const inputs = declarations.filter(m => m[1].toLowerCase() === 'input').map(m => m[2]);
  const outputs = declarations.filter(m => m[1].toLowerCase() === 'output').map(m => m[2]);
  const gates = [...body.matchAll(/\b(and|or|xor|nand|nor|xnor|not)\s+([A-Za-z_$][\w$]*)\s*\(([^;]+)\)\s*;/gi)]
    .map(m => ({ type: m[1].toLowerCase(), instance: m[2], pins: m[3].split(',').map(pin => pin.trim()) }));
  const assigns = [...body.matchAll(/\bassign\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/gi)]
    .map(m => ({ to: m[1], from: m[2] }));

  // Model the importer's output-driver aliasing: an output port remains a sink,
  // while a gate driving that net gets an internal driver name.
  for (const output of outputs) {
    const gate = gates.find(item => item.pins[0] === output);
    if (gate) {
      const internal = `__drv_${output}`;
      gate.pins[0] = internal;
      assigns.push({ to: output, from: internal });
    }
  }
  return { inputs, outputs, gates, assigns };
}

function evalGate(type, values) {
  switch (type) {
    case 'and': return values.every(Boolean) ? 1 : 0;
    case 'nand': return values.every(Boolean) ? 0 : 1;
    case 'or': return values.some(Boolean) ? 1 : 0;
    case 'nor': return values.some(Boolean) ? 0 : 1;
    case 'xor': return values.reduce((a, b) => a ^ b, 0);
    case 'xnor': return values.reduce((a, b) => a ^ b, 0) ^ 1;
    case 'not': return values[0] ^ 1;
    default: throw new Error(`Unsupported gate: ${type}`);
  }
}

function evaluateRecursively(circuit, vector) {
  const values = new Map(circuit.inputs.map((name, i) => [name, vector[i]]));
  const gatesByOutput = new Map(circuit.gates.map(gate => [gate.pins[0], gate]));
  const visiting = new Set();
  function signal(name) {
    if (values.has(name)) return values.get(name);
    const gate = gatesByOutput.get(name);
    if (!gate) throw new Error(`Undriven signal: ${name}`);
    if (visiting.has(name)) throw new Error(`Cycle detected at: ${name}`);
    visiting.add(name);
    const result = evalGate(gate.type, gate.pins.slice(1).map(signal));
    visiting.delete(name);
    values.set(name, result);
    return result;
  }
  for (const alias of circuit.assigns) values.set(alias.to, signal(alias.from));
  return circuit.outputs.map(signal);
}

function evaluateTopologically(circuit, vector) {
  const values = new Map(circuit.inputs.map((name, i) => [name, vector[i]]));
  const pending = circuit.gates.slice();
  let madeProgress = true;
  while (pending.length && madeProgress) {
    madeProgress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const gate = pending[i];
      const pins = gate.pins.slice(1);
      if (pins.every(name => values.has(name))) {
        values.set(gate.pins[0], evalGate(gate.type, pins.map(name => values.get(name))));
        pending.splice(i, 1);
        madeProgress = true;
      }
    }
  }
  if (pending.length) throw new Error(`Unresolved/cyclic gates: ${pending.length}`);
  for (const alias of circuit.assigns) {
    if (!values.has(alias.from)) throw new Error(`Undriven alias source: ${alias.from}`);
    values.set(alias.to, values.get(alias.from));
  }
  return circuit.outputs.map(name => {
    if (!values.has(name)) throw new Error(`Output has no driver: ${name}`);
    return values.get(name);
  });
}

const circuit = parseBenchmark(source);

test('ISCAS85 c1908 benchmark parses with expected dimensions and wide gates', () => {
  expect(circuit.inputs).toHaveLength(33);
  expect(circuit.outputs).toHaveLength(25);
  expect(circuit.gates).toHaveLength(479);
  expect(circuit.gates.filter(g => g.pins.length - 1 > 4)).toHaveLength(27);
  expect(Math.max(...circuit.gates.map(g => g.pins.length - 1))).toBe(8);
  expect(circuit.gates.every(g => g.pins.length >= 2 && g.pins.length <= 9)).toBe(true);
  expect(circuit.gates.every(g => g.type !== 'not' || g.pins.length === 2)).toBe(true);
});

test('every c1908 gate input has a declared or gate-driven signal', () => {
  const driven = new Set(circuit.inputs);
  for (const gate of circuit.gates) {
    expect(driven.has(gate.pins[0])).toBe(false);
    driven.add(gate.pins[0]);
  }
  for (const gate of circuit.gates) {
    for (const signal of gate.pins.slice(1)) {
      expect(driven.has(signal), `Undriven ${signal} at gate ${gate.instance}`).toBe(true);
    }
  }
  for (const output of circuit.outputs) {
    expect(driven.has(output) || circuit.assigns.some(alias => alias.to === output),
      `Output ${output} has no driver`).toBe(true);
  }
});

test('c1908 recursive and topological evaluators agree on directed and seeded-random vectors', () => {
  const vectors = [
    circuit.inputs.map(() => 0),
    circuit.inputs.map(() => 1),
    ...circuit.inputs.map((_, i) => circuit.inputs.map((__, j) => i === j ? 1 : 0)),
    ...circuit.inputs.map((_, i) => circuit.inputs.map((__, j) => i === j ? 0 : 1))
  ];
  let seed = 0x1908;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 2000; i++) vectors.push(circuit.inputs.map(() => random() < 0.5 ? 0 : 1));

  for (const vector of vectors) {
    expect(evaluateTopologically(circuit, vector)).toEqual(evaluateRecursively(circuit, vector));
  }
});

test('c1908 outputs match the independent Icarus Verilog simulator', () => {
  const vectors = [
    circuit.inputs.map(() => 0),
    circuit.inputs.map(() => 1),
    ...circuit.inputs.map((_, i) => circuit.inputs.map((__, j) => i === j ? 1 : 0)),
    ...circuit.inputs.map((_, i) => circuit.inputs.map((__, j) => i === j ? 0 : 1))
  ];
  let seed = 0x1908;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 2000; i++) {
    vectors.push(circuit.inputs.map(() => random() < 0.5 ? 0 : 1));
  }

  const inputDecls = circuit.inputs.map(name => `  reg ${name};`).join('\n');
  const outputDecls = circuit.outputs.map(name => `  wire ${name};`).join('\n');
  const portConnections = [...circuit.inputs, ...circuit.outputs]
    .map(name => `    .${name}(${name})`).join(',\n');
  const testVectors = vectors.map((vector, index) => {
    const assignments = circuit.inputs.map((name, i) => `    ${name} = 1'b${vector[i]};`).join('\n');
    return `${assignments}\n    #1;\n    $display("VECTOR:${index}:%b", {${circuit.outputs.join(', ')}});`;
  }).join('\n');
  const testbench = `module tb;\n${inputDecls}\n${outputDecls}\n  c1908 dut (\n${portConnections}\n  );\n  initial begin\n${testVectors}\n    $finish;\n  end\nendmodule\n`;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1908-iverilog-'));
  const testbenchPath = path.join(tempDir, 'c1908_tb.v');
  const executablePath = path.join(tempDir, 'c1908_sim');
  try {
    fs.writeFileSync(testbenchPath, testbench);
    execFileSync('iverilog', ['-g2012', '-s', 'tb', '-o', executablePath, sourcePath, testbenchPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const output = execFileSync('vvp', [executablePath], { encoding: 'utf8' });
    const actual = new Map();
    for (const line of output.split(/\\r?\n/)) {
      const match = line.match(/^VECTOR:(\d+):([01xXzZ]+)$/);
      if (match) actual.set(Number(match[1]), match[2].toLowerCase());
    }

    expect(actual.size, 'Icarus must produce one output row per vector').toBe(vectors.length);
    vectors.forEach((vector, index) => {
      const expected = evaluateTopologically(circuit, vector).join('');
      expect(actual.get(index), `Icarus output mismatch for vector #${index}, input=${vector.join('')}`)
        .toBe(expected);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}, 60000);

test('all supported primitive gate truth tables are correct', () => {
  const cases = {
    and: values => values.every(Boolean) ? 1 : 0,
    nand: values => values.every(Boolean) ? 0 : 1,
    or: values => values.some(Boolean) ? 1 : 0,
    nor: values => values.some(Boolean) ? 0 : 1,
    xor: values => values.reduce((a, b) => a ^ b, 0),
    xnor: values => values.reduce((a, b) => a ^ b, 0) ^ 1
  };
  for (const [type, reference] of Object.entries(cases)) {
    for (let mask = 0; mask < 16; mask++) {
      const vector = [0, 1, 2, 3].map(bit => (mask >> bit) & 1);
      expect(evalGate(type, vector)).toBe(reference(vector));
    }
  }
  expect(evalGate('not', [0])).toBe(1);
  expect(evalGate('not', [1])).toBe(0);
});
