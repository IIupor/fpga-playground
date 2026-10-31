import { AvoidLib } from 'https://cdn.jsdelivr.net/npm/libavoid-js@0.4.5/dist/index.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/libavoid-js@0.4.5/dist/libavoid.wasm';

let Avoid = null;

const ready = AvoidLib.load(WASM_URL).then(() => {
  Avoid = AvoidLib.getInstance();
  window.fpgaLibavoidReadyState = true;
  const status = document.getElementById('routingStats');
  if (status) status.textContent = 'Libavoid: ready';
  if (document.getElementById('routingMode')?.value === 'libavoid') {
    document.getElementById('routingMode').dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}).catch(error => {
  window.fpgaLibavoidReadyState = false;
  window.fpgaLibavoidLoadError = String(error?.stack || error);
  const status = document.getElementById('routingStats');
  if (status) status.textContent = 'Libavoid: failed to load';
  const message = document.getElementById('editorMessage');
  if (message) message.textContent = 'Libavoid could not be loaded: ' + error.message;
  throw error;
});

window.fpgaLibavoidReady = ready;
window.fpgaLibavoidReadyState = false;

/**
 * Route the complete circuit in one libavoid transaction.
 * Blocks are hard obstacles; connectors are managed together by one Router.
 * The returned map contains geometry only and never changes the logical netlist.
 */
window.fpgaRouteWithLibavoid = function(nodes, wires, pin, spec) {
  if (!Avoid) throw new Error('libavoid-js is not initialized');
  const router = new Avoid.Router(Avoid.OrthogonalRouting);
  const shapes = [];
  const polygons = [];
  const points = [];
  const endpoints = [];
  const connectors = [];
  const routes = new Map();

  const destroy = object => {
    if (object && typeof object.__destroy__ === 'function') object.__destroy__();
  };

  try {
    router.setRoutingParameter(Avoid.shapeBufferDistance, 4);
    router.setRoutingParameter(Avoid.idealNudgingDistance, 10);
    router.setRoutingOption(Avoid.nudgeOrthogonalTouchingColinearSegments, true);
    router.setRoutingOption(Avoid.penaliseOrthogonalSharedPathsAtConnEnds, true);
    router.setRoutingOption(Avoid.nudgeSharedPathsWithCommonEndPoint, true);
    router.setRoutingOption(Avoid.performUnifyingNudgingPreprocessingStep, true);

    const nodeById = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      const size = spec(node);
      const center = new Avoid.Point(node.x + size.w / 2, node.y + size.h / 2);
      points.push(center);
      const rectangle = new Avoid.Rectangle(center, size.w, size.h);
      polygons.push(rectangle);
      shapes.push(new Avoid.ShapeRef(router, rectangle));
    }

    for (const wire of wires) {
      const source = nodeById.get(wire.from);
      const target = nodeById.get(wire.to);
      if (!source || !target) throw new Error('Wire ' + wire.id + ' references a missing block');
      const sourcePin = pin(source, 'out', wire.fromPin || 0);
      const targetPin = pin(target, 'in', wire.toPin || 0);
      const sourcePoint = new Avoid.Point(sourcePin.x, sourcePin.y);
      const targetPoint = new Avoid.Point(targetPin.x, targetPin.y);
      points.push(sourcePoint, targetPoint);
      const sourceEnd = new Avoid.ConnEnd(sourcePoint);
      const targetEnd = new Avoid.ConnEnd(targetPoint);
      endpoints.push(sourceEnd, targetEnd);
      const connector = new Avoid.ConnRef(router, sourceEnd, targetEnd);
      connector.setRoutingType(Avoid.ConnType_Orthogonal);
      // Independent perpendicular crossings are allowed by the editor's net model.
      connector.setHateCrossings(false);
      connectors.push({ wire, connector });
    }

    router.processTransaction();

    for (const { wire, connector } of connectors) {
      const polyline = connector.displayRoute();
      if (!polyline || polyline.size() < 2) {
        throw new Error('libavoid returned no route for wire ' + wire.id);
      }
      const route = [];
      for (let i = 0; i < polyline.size(); i++) {
        const point = polyline.get_ps(i);
        const current = { x: point.x, y: point.y };
        const previous = route[route.length - 1];
        if (previous && Math.abs(previous.x - current.x) < 0.001 && Math.abs(previous.y - current.y) < 0.001) continue;
        route.push(current);
      }
      const simplified = route.filter((point, index, all) => {
        if (index === 0 || index === all.length - 1) return true;
        const a = all[index - 1], b = point, c = all[index + 1];
        return !((Math.abs(a.x - b.x) < 0.001 && Math.abs(b.x - c.x) < 0.001) ||
                 (Math.abs(a.y - b.y) < 0.001 && Math.abs(b.y - c.y) < 0.001));
      });
      for (let i = 1; i < simplified.length; i++) {
        const a = simplified[i - 1], b = simplified[i];
        if (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001) {
          throw new Error('libavoid returned a non-orthogonal segment for wire ' + wire.id);
        }
      }
      if (simplified.length < 2) throw new Error('Degenerate route for wire ' + wire.id);
      routes.set(wire.id, simplified);
    }

    if (routes.size !== wires.length) {
      throw new Error('Incomplete routing: ' + routes.size + ' of ' + wires.length + ' wires');
    }
    return routes;
  } finally {
    // Release WebIDL objects in dependency order; this router is rebuilt per render.
    connectors.forEach(item => destroy(item.connector));
    shapes.forEach(destroy);
    endpoints.forEach(destroy);
    polygons.forEach(destroy);
    points.forEach(destroy);
    destroy(router);
  }
};
