const { test, expect } = require('@playwright/test');
const circuits = [
  ['c17', 6], ['c432', 171], ['c499', 174], ['c880', 323],
  ['c1355', 518], ['c1908', 479], ['c2670', 699], ['c3540', 1043],
  ['c5315', 1586], ['c6288', 2353], ['c7552', 2331]
];

for (const [name, gateCount] of circuits) {
  test(name + ': import, placement and complete orthogonal routing', async ({ page }) => {
    test.setTimeout(180000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('/');
    await page.locator('#benchmarkSelect').selectOption(name);
    await expect(page.locator('#editorMessage')).toContainText(
      new RegExp('Loaded ' + name + '\\.v|Imported '), { timeout: 120000 }
    );

    const report = await page.evaluate(() => {
      const nodes = [...window.fpgaNodes || []];
      const wires = [...window.fpgaWires || []];
      const groups = [...document.querySelectorAll('#editorStage g[data-node]')];
      const paths = [...document.querySelectorAll('#editorStage path.editor-wire')];
      const boxes = groups.map(g => {
        const b = g.getBBox();
        const m = /translate\(\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*\)/.exec(g.getAttribute('transform') || '');
        const x = b.x + (m ? Number(m[1]) : 0);
        const y = b.y + (m ? Number(m[2]) : 0);
        return { id: Number(g.getAttribute('data-node')), l:x, t:y, r:x+b.width, b:y+b.height };
      });
      const routes = paths.map(path => {
        const d = path.getAttribute('d') || '';
        const points = [...d.matchAll(/[ML]\s*(-?[\d.eE+]+)[,\s]+(-?[\d.eE+]+)/g)]
          .map(m => ({x:Number(m[1]), y:Number(m[2])}));
        return { id:Number(path.dataset.wire), from:Number(path.dataset.from), to:Number(path.dataset.to), d, points };
      });
      let emptyRoutes = 0, diagonalSegments = 0, blockPenetrations = 0, collinearOverlaps = 0;
      const segments = [];
      for (const route of routes) {
        if (route.points.length < 2) { emptyRoutes++; continue; }
        for (let i=1;i<route.points.length;i++) {
          const a=route.points[i-1], b=route.points[i];
          if (a.x!==b.x && a.y!==b.y) diagonalSegments++;
          segments.push({a,b,from:route.from,to:route.to,wire:route.id});
          for (const box of boxes) {
            if (box.id===route.from || box.id===route.to) continue;
            const hit = a.y===b.y
              ? a.y>box.t && a.y<box.b && Math.max(Math.min(a.x,b.x),box.l)<Math.min(Math.max(a.x,b.x),box.r)
              : a.x===b.x && a.x>box.l && a.x<box.r && Math.max(Math.min(a.y,b.y),box.t)<Math.min(Math.max(a.y,b.y),box.b);
            if (hit) blockPenetrations++;
          }
        }
      }
      const horizontal=new Map(),vertical=new Map();
      for(const s of segments){
        const isHorizontal=s.a.y===s.b.y, key=isHorizontal?s.a.y:s.a.x, map=isHorizontal?horizontal:vertical;
        if(!map.has(key))map.set(key,[]);
        const lo=isHorizontal?Math.min(s.a.x,s.b.x):Math.min(s.a.y,s.b.y);
        const hi=isHorizontal?Math.max(s.a.x,s.b.x):Math.max(s.a.y,s.b.y);
        map.get(key).push({...s,lo,hi});
      }
      for(const map of [horizontal,vertical]) for(const list of map.values()){
        list.sort((a,b)=>a.lo-b.lo||a.hi-b.hi);
        const active=[];
        for(const current of list){
          for(let i=active.length-1;i>=0;i--)if(active[i].hi<=current.lo)active.splice(i,1);
          for(const previous of active)if(previous.wire!==current.wire&&previous.from!==current.from)collinearOverlaps++;
          active.push(current);
        }
      }
      return {
        nodeObjects:nodes.length, renderedNodes:groups.length, logicalWires:wires.length,
        renderedWires:paths.length, emptyRoutes, diagonalSegments, blockPenetrations,
        collinearOverlaps,
        missingNodeGeometry:boxes.filter(b=>![b.l,b.t,b.r,b.b].every(Number.isFinite)).length,
        canvasWidth:Number(document.querySelector('#editorStage').dataset.canvasWidth),
        canvasHeight:Number(document.querySelector('#editorStage').dataset.canvasHeight),
        totalRoutePoints:routes.reduce((n,r)=>n+r.points.length,0)
      };
    });
    console.log('ISCAS85_ACCEPTANCE', name, JSON.stringify({...report, pageErrors}));
    expect(pageErrors, 'browser runtime errors').toEqual([]);
    expect(report.renderedNodes, 'all imported blocks must render').toBe(report.nodeObjects);
    expect(report.nodeObjects, 'all gates plus IO must be present').toBeGreaterThan(gateCount);
    expect(report.renderedWires, 'every logical connection must have an SVG route').toBe(report.logicalWires);
    expect(report.emptyRoutes, 'no wire may be silently omitted').toBe(0);
    expect(report.diagonalSegments, 'all routes must be orthogonal').toBe(0);
    expect(report.blockPenetrations, 'wires must not pass through unrelated blocks').toBe(0);
    expect(report.collinearOverlaps, 'independent wires must not overlap collinearly').toBe(0);
    expect(report.missingNodeGeometry).toBe(0);
  });
}
