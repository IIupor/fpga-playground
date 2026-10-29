const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

// Keep representative ISCAS85 circuits enabled while routing is validated.
// These cases cover a tiny circuit and progressively larger netlists.
const names = ['c17', 'c432', 'c499', 'c880', 'c1355', 'c1908', 'c2670', 'c3540', 'c5315', 'c6288', 'c7552'];
function parse(name) {
  const file = path.join(__dirname, '..', 'benchmarks', 'iscas85', name + '.v');
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const match = source.match(/\bmodule\s+\w+\s*\(([^)]*)\)\s*;([\s\S]*?)\bendmodule\b/i);
  if (!match) throw new Error(name + ': no module');
  let body = match[2].replace(/\b(input|output)(?:\s+wire)?\s+([^;]+);/gi,
    (_, kind, list) => list.split(',').map(s => kind + ' ' + s.trim() + ';').join('\n'));
  const declarations = [...body.matchAll(/\b(input|output)(?:\s+wire)?\s+([A-Za-z_$][\w$]*)\s*;/gi)];
  const inputs = declarations.filter(x => x[1].toLowerCase() === 'input').map(x => x[2]);
  const outputs = declarations.filter(x => x[1].toLowerCase() === 'output').map(x => x[2]);
  if (!inputs.length || !outputs.length) throw new Error(name + ': missing ports');
  return { name, file, source, inputs, outputs };
}
function vectors(c, count=64) {
  const result = [c.inputs.map(() => 0), c.inputs.map(() => 1)];
  for (let i=0;i<c.inputs.length;i++) {
    result.push(c.inputs.map((_,j)=>i===j?1:0));
    result.push(c.inputs.map((_,j)=>i===j?0:1));
  }
  let seed = c.name.split('').reduce((n,ch)=>n+ch.charCodeAt(0),0);
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
  for(let i=0;i<count;i++) result.push(c.inputs.map(()=>rand()<0.5?0:1));
  return result;
}
for (const name of names) {
  test(name + ': benchmark compiles and simulates against Icarus Verilog', () => {
    const c=parse(name), vectorsToRun=vectors(c, 64);
    const inputDecls=c.inputs.map(n=>'  reg '+n+';').join('\n');
    const outputDecls=c.outputs.map(n=>'  wire '+n+';').join('\n');
    const ports=[...c.inputs,...c.outputs].map(n=>'    .'+n+'('+n+')').join(',\n');
    const rows=vectorsToRun.map((v,i)=>v.map((bit,j)=>'    '+c.inputs[j]+' = 1\'b'+bit+';').join('\n')+
      '\n    #1;\n    $display("ROW:'+i+':%b", {'+c.outputs.join(', ')+'});').join('\n');
    const tb='module tb;\n'+inputDecls+'\n'+outputDecls+'\n  '+name+' dut (\n'+ports+'\n  );\n  initial begin\n'+rows+'\n    $finish;\n  end\nendmodule\n';
    const dir=fs.mkdtempSync(path.join(os.tmpdir(), name+'-'));
    try {
      const tbPath=path.join(dir,'tb.v'), exe=path.join(dir,'sim');
      fs.writeFileSync(tbPath,tb);
      execFileSync('iverilog',['-g2012','-s','tb','-o',exe,c.file,tbPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      const output=execFileSync('vvp',[exe],{encoding:'utf8'});
      const rowsFound=[...output.matchAll(/^ROW:(\d+):([01xXzZ]+)$/gm)];
      expect(rowsFound.length, name+' must produce a result for every input vector').toBe(vectorsToRun.length);
      for (const row of rowsFound) expect(row[2].toLowerCase(),name+' returned unknown output for vector '+row[1]).not.toMatch(/[xz]/i);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  }, 60000);
}

for (const name of names) {
  test(name + ': browser import/export/import preserves circuit structure', async ({ page }) => {
    if (name === 'c7552') test.setTimeout(300000);
    const timings = {};
    await page.goto('/');
    const source=fs.readFileSync(path.join(__dirname,'..','benchmarks','iscas85',name+'.v'),'utf8');
    await page.locator('#verilogText').fill(source);
    let mark = Date.now();
    await page.locator('#importVerilog').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 240000 });
    timings.firstImportMs = Date.now() - mark;
    const firstBlocks=await page.locator('#editorStage g[data-node]').count();
    const firstWires=await page.locator('#editorStage path.editor-wire').count();
    expect(firstBlocks).toBeGreaterThan(0);
    expect(firstWires).toBeGreaterThan(0);
    mark = Date.now();
    await page.locator('#exportVerilog').click();
    await expect(page.locator('#verilogText')).toHaveValue(/module fpga_playground/, { timeout: 240000 });
    timings.exportMs = Date.now() - mark;
    const exported=await page.locator('#verilogText').inputValue();

    // Simulate the original and exported modules side by side on identical vectors.
    const c=parse(name), vectorsToRun=vectors(c, 64);
    const inputDecls=c.inputs.map(n=>'  reg '+n+';').join('\n');
    const originalOutputs=c.outputs.map(n=>'  wire orig_'+n+';').join('\n');
    const exportedOutputs=c.outputs.map(n=>'  wire exp_'+n+';').join('\n');
    const originalPorts=[...c.inputs.map(n=>'.'+n+'('+n+')'),...c.outputs.map(n=>'.'+n+'(orig_'+n+')')].join(', ');
    const exportedPorts=[...c.inputs.map(n=>'.'+n+'('+n+')'),...c.outputs.map(n=>'.'+n+'(exp_'+n+')')].join(', ');
    const rows=vectorsToRun.map((v,i)=>v.map((bit,j)=>"    "+c.inputs[j]+" = 1'b"+bit+";").join('\n')+
      '\n    #1;\n    $display("EQ:'+i+':%b:%b", {'+c.outputs.map(n=>'orig_'+n).join(', ')+'}, {'+c.outputs.map(n=>'exp_'+n).join(', ')+'});').join('\n');
    const tb='module tb;\n'+inputDecls+'\n'+originalOutputs+'\n'+exportedOutputs+
      '\n  '+name+' original_dut ('+originalPorts+');\n  fpga_playground exported_dut ('+exportedPorts+');\n  initial begin\n'+rows+'\n    $finish;\n  end\nendmodule\n';
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),name+'-equiv-'));
    try {
      const tbPath=path.join(dir,'tb.v'), exportedPath=path.join(dir,'exported.v'), exe=path.join(dir,'sim');
      fs.writeFileSync(tbPath,tb); fs.writeFileSync(exportedPath,exported);
      execFileSync('iverilog',['-g2012','-s','tb','-o',exe,c.file,exportedPath,tbPath],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
      const output=execFileSync('vvp',[exe],{encoding:'utf8'});
      const rowsFound=[...output.matchAll(/^EQ:(\d+):([01xXzZ]+):([01xXzZ]+)$/gm)];
      expect(rowsFound.length,name+' equivalence simulation must cover every vector').toBe(vectorsToRun.length);
      for(const row of rowsFound) {
        expect(row[2].toLowerCase(),name+' original circuit produced unknown output for vector '+row[1]).not.toMatch(/[xz]/i);
        expect(row[3].toLowerCase(),name+' exported circuit produced unknown output for vector '+row[1]).not.toMatch(/[xz]/i);
        expect(row[3],name+' exported outputs differ from original at vector '+row[1]).toBe(row[2]);
      }
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }

    // The exported source can be very large (thousands of gates). Set the
    // textarea value as a paste would, instead of asking Playwright to type it.
    await page.locator('#verilogText').evaluate((el, value) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, exported);
    mark = Date.now();
    await page.locator('#importVerilog').click();
    await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 240000 });
    timings.secondImportMs = Date.now() - mark;
    const secondBlocks = await page.locator('#editorStage g[data-node]').count();
    const secondWires = await page.locator('#editorStage path.editor-wire').count();
    console.log(name + ' timing/structure: ' + JSON.stringify({ ...timings, firstBlocks, secondBlocks, firstWires, secondWires }));
    expect(secondBlocks, name + ' block count after re-import').toBe(firstBlocks);
    expect(secondWires, name + ' wire count after re-import').toBe(firstWires);
  }, 180000);
}
