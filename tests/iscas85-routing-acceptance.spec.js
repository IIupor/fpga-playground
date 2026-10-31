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
      let emptyRoutes = 0, diagonalSegments = 0, blockPenetrations = 0, collinearOverlaps = 0, wrongEndpoints = 0, nodeOverlaps = 0;
      const segments = [];
      const sortedBoxes=boxes.slice().sort((a,b)=>a.l-b.l),activeBoxes=[];
      for(const box of sortedBoxes){
        for(let i=activeBoxes.length-1;i>=0;i--)if(activeBoxes[i].r<=box.l+1)activeBoxes.splice(i,1);
        for(const other of activeBoxes)if(Math.min(box.b,other.b)-Math.max(box.t,other.t)>1)nodeOverlaps++;
        activeBoxes.push(box);
      }
      const nodeById=new Map(nodes.map(n=>[n.id,n]));
      for (const route of routes) {
        if (route.points.length < 2) { emptyRoutes++; continue; }
        const source=nodeById.get(route.from),target=nodeById.get(route.to);
        if(!source||!target)wrongEndpoints++;
        else{
          const sourceWidth=['INPUT','OUTPUT','VDD','GND'].includes(source.type)?112:150;
          const sourcePin=source.outputs?Number(wires.find(w=>w.id===route.id)?.fromPin||0):0;
          const targetPin=Number(wires.find(w=>w.id===route.id)?.toPin||0);
          const first=route.points[0],last=route.points[route.points.length-1];
          if(first.x!==source.x+sourceWidth||first.y!==source.y+30+sourcePin*22||
             last.x!==target.x||last.y!==target.y+30+targetPin*22)wrongEndpoints++;
        }
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
        collinearOverlaps, wrongEndpoints, nodeOverlaps,
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
    expect(report.wrongEndpoints, 'each route must preserve its logical source and target pins').toBe(0);
    expect(report.nodeOverlaps, 'placed blocks must not overlap').toBe(0);
    expect(report.missingNodeGeometry).toBe(0);

    await page.locator('#editorFitView').click();
    const fit = await page.evaluate(() => {
      const viewport=document.querySelector('#editorViewport'),stage=document.querySelector('#editorStage');
      return {
        viewportWidth:viewport.clientWidth, viewportHeight:viewport.clientHeight,
        stageWidth:stage.getBoundingClientRect().width, stageHeight:stage.getBoundingClientRect().height,
        zoom:window.fpgaZoom, renderedWires:document.querySelectorAll('#editorStage path.editor-wire').length
      };
    });
    console.log('ISCAS85_FIT', name, JSON.stringify(fit));
    expect(fit.stageWidth, 'Fit to view must fit the complete circuit width').toBeLessThanOrEqual(fit.viewportWidth+2);
    expect(fit.stageHeight, 'Fit to view must fit the complete circuit height').toBeLessThanOrEqual(fit.viewportHeight+2);
    expect(fit.renderedWires, 'Fit to view must not drop wires').toBe(report.logicalWires);
  });
}
