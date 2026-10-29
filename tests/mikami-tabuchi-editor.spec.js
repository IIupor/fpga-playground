'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const benchmarks = ['c17', 'c432', 'c499', 'c880'];

async function loadBenchmark(page, name) {
  await page.route(`https://raw.githubusercontent.com/IIupor/fpga-playground/main/benchmarks/iscas85/${name}.v`, async route => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'iscas85', `${name}.v`), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: source });
  });
  await page.goto('/');
  await page.locator('#benchmarkSelect').selectOption(name);
  await page.locator('#loadBenchmark').click();
  await expect(page.locator('#editorMessage')).toContainText('Imported', { timeout: 30000 });
}

async function diagnostics(page) {
  return page.locator('#editorStage').evaluate(svg => {
    const nodes = [...svg.querySelectorAll('g[data-node]')].map(g => {
      const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform'));
      const box = g.querySelector('rect.nodebox');
      return { id: Number(g.getAttribute('data-node')), x: Number(match[1]), y: Number(match[2]),
        w: Number(box.getAttribute('width')), h: Number(box.getAttribute('height')) };
    });
    const wires = [...svg.querySelectorAll('path.editor-wire')].map(path => ({
      id: path.getAttribute('data-wire'), from: Number(path.getAttribute('data-from')),
      to: Number(path.getAttribute('data-to')),
      points: [...path.getAttribute('d').matchAll(/[ML]\s*([-\d.]+)[, ]+([-\d.]+)/g)]
        .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    }));
    const segments = wires.flatMap(w => w.points.slice(1).map((p,i) => ({
      wire:w.id, from:w.from, to:w.to, a:w.points[i], b:p,
      horizontal:w.points[i].y===p.y
    })));
    let crossings=0, overlaps=0, blocked=0, nonOrthogonal=0, missing=0;
    for (const w of wires) {
      if (!w.id || w.points.length<2) missing++;
      for (let i=1;i<w.points.length;i++) {
        const a=w.points[i-1], b=w.points[i];
        if (a.x!==b.x && a.y!==b.y) nonOrthogonal++;
        for (const n of nodes) {
          if (n.id===w.from || n.id===w.to) continue;
          const hit=a.x===b.x
            ? a.x>n.x-8 && a.x<n.x+n.w+8 && Math.max(Math.min(a.y,b.y),n.y-8)<Math.min(Math.max(a.y,b.y),n.y+n.h+8)
            : a.y>n.y-8 && a.y<n.y+n.h+8 && Math.max(Math.min(a.x,b.x),n.x-8)<Math.min(Math.max(a.x,b.x),n.x+n.w+8);
          if(hit) blocked++;
        }
      }
    }
    for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++) {
      const a=segments[i],b=segments[j];
      if(a.wire===b.wire || a.from===b.from || a.from===b.to || a.to===b.from || a.to===b.to) continue;
      if(a.horizontal!==b.horizontal) {
        const h=a.horizontal?a:b,v=a.horizontal?b:a,x=v.a.x,y=h.a.y;
        if(x>Math.min(h.a.x,h.b.x)&&x<Math.max(h.a.x,h.b.x)&&y>Math.min(v.a.y,v.b.y)&&y<Math.max(v.a.y,v.b.y))crossings++;
      } else if(a.horizontal && a.a.y===b.a.y) {
        if(Math.max(Math.min(a.a.x,a.b.x),Math.min(b.a.x,b.b.x))<Math.min(Math.max(a.a.x,a.b.x),Math.max(b.a.x,b.b.x)))overlaps++;
      } else if(!a.horizontal && a.a.x===b.a.x) {
        if(Math.max(Math.min(a.a.y,a.b.y),Math.min(b.a.y,b.b.y))<Math.min(Math.max(a.a.y,a.b.y),Math.max(b.a.y,b.b.y)))overlaps++;
      }
    }
    return {nodeCount:nodes.length,wireCount:wires.length,segmentCount:segments.length,
      crossings,overlaps,blocked,nonOrthogonal,missing};
  });
}

for (const name of benchmarks) {
  test(`${name}: compare current router with experimental Mikami–Tabuchi router`, async ({ page }) => {
    await loadBenchmark(page,name);
    const baseline=await diagnostics(page);
    const started=Date.now();
    await page.locator('#routingMode').evaluate(el => { el.value = 'mikami'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect(page.locator('#routingStats')).toContainText('Mikami');
    await expect.poll(async()=> (await page.locator('#editorStage path.editor-wire').count()), {timeout:30000})
      .toBe(baseline.wireCount);
    const elapsedMs=Date.now()-started;
    const experimental=await diagnostics(page);
    console.log(`ROUTER-COMPARISON ${name}: ${JSON.stringify({baseline,experimental,elapsedMs})}`);
    expect(experimental.wireCount).toBe(baseline.wireCount);
    expect(experimental.missing).toBe(0);
    expect(experimental.nonOrthogonal).toBe(0);
    expect(experimental.blocked).toBe(0);
  }, 300000);
}
