(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const svg = $('editorStage');
  const menu = $('editorMenus');
  if (!menu || !svg || $('staMenu')) return;

  const menuItem = document.createElement('div');
  menuItem.className = 'editor-menu';
  menuItem.id = 'staMenu';
  menuItem.innerHTML = '<button class="toolbtn" data-menu="timing">Timing</button><div class="editor-menu-popup" data-popup="timing" hidden><button class="toolbtn" id="staOpen">Timing Constraints / Run STA</button><button class="toolbtn" id="staClearHighlight">Clear path highlight</button></div>';
  menu.append(menuItem);
  const timingTrigger = menuItem.querySelector('[data-menu="timing"]');
  const timingPopup = menuItem.querySelector('[data-popup="timing"]');
  timingTrigger.addEventListener('click', () => {
    const wasOpen = !timingPopup.hidden;
    menu.querySelectorAll('[data-popup]').forEach(popup => popup.hidden = true);
    timingPopup.hidden = wasOpen;
  });
  document.addEventListener('click', event => {
    if (!menuItem.contains(event.target)) timingPopup.hidden = true;
  });

  const style = document.createElement('style');
  style.textContent = `
    #staDialog{width:min(760px,calc(100vw - 24px));max-height:90vh;overflow:auto;border:1px solid var(--border);border-radius:16px;padding:0;background:var(--surface);color:var(--text);box-shadow:0 20px 60px #0005}
    #staDialog::backdrop{background:#10182899}
    .sta-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)}
    .sta-head h2{font-size:16px;margin:0}
    .sta-body{padding:18px;display:grid;gap:14px}
    .sta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .sta-field{display:grid;gap:5px;min-width:0;font-size:12px;color:var(--muted);font-weight:750}
    .sta-field input,.sta-field select{width:100%;min-width:0;padding:9px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text);font:inherit}
    .sta-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .sta-status{padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);font-size:12px;white-space:pre-wrap}
    .sta-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .sta-metric{padding:10px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);min-width:0}
    .sta-metric small{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em}
    .sta-metric strong{display:block;margin-top:4px;font-size:15px;overflow-wrap:anywhere}
    .sta-paths{display:grid;gap:6px;max-height:240px;overflow:auto}
    .sta-path{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left}
    .sta-path span{min-width:0;overflow-wrap:anywhere}
    .sta-path small{color:var(--muted);white-space:nowrap}
    #editorStage .editor-wire.sta-critical{stroke:#e53935!important;stroke-width:4.5!important;filter:drop-shadow(0 0 3px #e5393580)}
    #editorStage g.sta-path-node .gate-symbol{stroke:#e53935!important;filter:drop-shadow(0 0 3px #e5393580)}
    #editorStage g.sta-path-node rect.nodebox{stroke:#e53935!important;stroke-width:3!important}
    @media(max-width:560px){.sta-grid{grid-template-columns:1fr}.sta-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.append(style);

  const dialog = document.createElement('dialog');
  dialog.id = 'staDialog';
  dialog.innerHTML = `
    <div class="sta-head"><h2>Static Timing Analysis</h2><button class="toolbtn" id="staClose" type="button" aria-label="Close">×</button></div>
    <div class="sta-body">
      <div class="sta-status" id="staAuthStatus">Connect a free STA broker to run analysis through GitHub Actions.</div>
      <div class="sta-grid">
        <label class="sta-field">Free broker URL
          <input id="staBrokerUrl" type="url" placeholder="https://your-worker.workers.dev">
        </label>
        <div class="sta-field" style="align-content:end">
          <span>GitHub account</span>
          <div class="sta-actions"><button class="toolbtn" id="staLogin" type="button">Sign in with GitHub</button><button class="toolbtn" id="staLogout" type="button">Sign out</button></div>
        </div>
      </div>
      <div class="sta-grid">
        <label class="sta-field">Top module
          <input id="staTop" value="fpga_playground" spellcheck="false">
        </label>
        <label class="sta-field">Analysis
          <select id="staAnalysis"><option value="both">Setup + Hold</option><option value="setup">Setup only</option><option value="hold">Hold only</option></select>
        </label>
        <label class="sta-field">Clock input port (empty = virtual clock)
          <select id="staClockPort"></select>
        </label>
        <label class="sta-field">Clock period (ns)
          <input id="staPeriod" type="number" min="0.001" step="0.1" value="10">
        </label>
        <label class="sta-field">Input delay (ns)
          <input id="staInputDelay" type="number" min="0" step="0.01" value="0.2">
        </label>
        <label class="sta-field">Output delay (ns)
          <input id="staOutputDelay" type="number" min="0" step="0.01" value="0.2">
        </label>
        <label class="sta-field">Input transition (ns)
          <input id="staInputTransition" type="number" min="0" step="0.01" value="0.1">
        </label>
        <label class="sta-field">Output load (pF)
          <input id="staOutputLoad" type="number" min="0" step="0.1" value="5">
        </label>
      </div>
      <div class="sta-actions">
        <button class="toolbtn primary" id="staRun" type="button">Run STA</button>
        <button class="toolbtn" id="staClear" type="button">Clear results</button>
      </div>
      <div class="sta-status" id="staStatus" aria-live="polite">Ready. Analysis uses the Sky130 HD TT timing library.</div>
      <div class="sta-metrics" id="staMetrics"></div>
      <div><strong style="font-size:13px">Critical paths</strong><div class="sta-paths" id="staPaths"></div></div>
      <details><summary>OpenSTA report</summary><pre id="staReport" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;font-size:11px"></pre></details>
    </div>`;
  document.body.append(dialog);

  const brokerInput = $('staBrokerUrl');
  brokerInput.value = localStorage.getItem('fpgaStaBrokerUrl') || '';
  const sessionKey = 'fpgaStaSession';
  let pollTimer = null;
  let activeResult = null;

  const setStatus = value => { $('staStatus').textContent = value; };
  const brokerUrl = () => brokerInput.value.trim().replace(/\/$/, '');
  const session = () => sessionStorage.getItem(sessionKey) || '';
  const api = async (path, options = {}) => {
    const base = brokerUrl();
    if (!base) throw new Error('Enter the free broker URL first.');
    const headers = new Headers(options.headers || {});
    if (session()) headers.set('Authorization', 'Bearer ' + session());
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(base + path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || ('Broker returned HTTP ' + response.status));
    return body;
  };

  function refreshClockPorts() {
    const select = $('staClockPort');
    const old = select.value;
    select.replaceChildren(new Option('Virtual clock (no clock port)', ''));
    (window.fpgaNodes || []).filter(n => n.type === 'INPUT').forEach(n => select.add(new Option(n.name, n.name)));
    if ([...select.options].some(o => o.value === old)) select.value = old;
    else if ([...select.options].some(o => o.value === 'clk')) select.value = 'clk';
    else if ([...select.options].some(o => o.value === 'CK')) select.value = 'CK';
  }

  function getSignalName(node, pinIndex = 0) {
    if (!node) return "1'b0";
    if (node.type === 'VDD') return "1'b1";
    if (node.type === 'GND') return "1'b0";
    if (node.type === 'INPUT' || node.type === 'OUTPUT') return node.name;
    const pin = node.outputNames?.[pinIndex];
    return node.cellType || node.moduleType
      ? node.name + '_' + (pin || ('OUT' + (pinIndex + 1)))
      : node.name + (node.outputs > 1 ? '_out' + (pinIndex + 1) : '_out');
  }

  function buildDesign() {
    const nodes = window.fpgaNodes || [];
    const wires = window.fpgaWires || [];
    if (!nodes.length) throw new Error('The schematic is empty.');
    const valid = value => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value || '');
    const inputs = nodes.filter(n => n.type === 'INPUT');
    const outputs = nodes.filter(n => n.type === 'OUTPUT');
    if (!outputs.length) throw new Error('Add at least one Output block before running STA.');
    for (const n of nodes) {
      if (!valid(n.name)) throw new Error('Invalid instance or signal name: ' + n.name);
      if ((n.inputNames || []).some(name => !valid(name)) || (n.outputNames || []).some(name => name && !valid(name))) {
        throw new Error('Invalid pin name on block ' + n.name + '.');
      }
    }
    const ports = [...inputs.map(n => n.name), ...outputs.map(n => n.name)];
    if (new Set(ports.map(p => p.toLowerCase())).size !== ports.length) throw new Error('Input and output port names must be unique.');
    const wireByInput = new Map();
    for (const w of wires) if (w.to != null) wireByInput.set(w.to + ':' + w.toPin, w);
    const sourceAt = (node, pinIndex) => {
      const wire = wireByInput.get(node.id + ':' + pinIndex);
      return wire ? { node: nodes.find(n => n.id === wire.from), pin: wire.fromPin || 0, wire } : null;
    };
    const lines = ['// Generated by FPGA Playground STA exporter', 'module fpga_playground(' + ports.join(', ') + ');'];
    inputs.forEach(n => lines.push('  input wire ' + n.name + ';'));
    outputs.forEach(n => lines.push('  output wire ' + n.name + ';'));
    const signalMap = {};
    for (const n of nodes) {
      if (['INPUT','OUTPUT','VDD','GND'].includes(n.type)) continue;
      for (let i = 0; i < Math.max(1, n.outputs || 1); i++) {
        const signal = getSignalName(n, i);
        lines.push('  (* keep = 1 *) wire ' + signal + ';');
        signalMap[signal] = {
          nodeId: n.id,
          wireIds: wires.filter(w => w.from === n.id && (w.fromPin || 0) === i).map(w => w.id)
        };
      }
    }
    for (const n of inputs) {
      signalMap[n.name] = {
        nodeId: n.id,
        wireIds: wires.filter(w => w.from === n.id && (w.fromPin || 0) === 0).map(w => w.id)
      };
    }
    for (const n of outputs) {
      const src = sourceAt(n, 0);
      if (src?.node) signalMap[n.name] = { nodeId: src.node.id, wireIds: [src.wire.id] };
      lines.push('  assign ' + n.name + ' = ' + (src?.node ? getSignalName(src.node, src.pin) : "1'b0") + ';');
    }
    const gates = {AND:'and', OR:'or', XOR:'xor', NAND:'nand', NOR:'nor', XNOR:'xnor', NOT:'not', BUF:'buf'};
    for (const n of nodes) {
      if (['INPUT','OUTPUT','VDD','GND','DFF','LATCH'].includes(n.type) || n.cellType || n.moduleType) continue;
      const gate = gates[n.type];
      if (!gate) throw new Error('STA export does not yet support block type ' + n.type + ' (' + n.name + ').');
      const outs = Array.from({length:n.outputs || 1}, (_, i) => getSignalName(n, i));
      const ins = Array.from({length:n.inputs || 0}, (_, i) => {
        const src = sourceAt(n, i);
        return src?.node ? getSignalName(src.node, src.pin) : "1'b0";
      });
      lines.push('  ' + gate + ' ' + n.name + ' (' + [...outs, ...ins].join(', ') + ');');
    }
    for (const n of nodes) {
      const moduleName = n.cellType || (n.type === 'MODULE' ? n.moduleType : null);
      if (!moduleName) continue;
      if (!valid(moduleName)) throw new Error('Invalid library cell/module name on ' + n.name + '.');
      const connections = [];
      for (let i = 0; i < (n.inputs || 0); i++) {
        const src = sourceAt(n, i), pin = n.inputNames?.[i];
        if (!valid(pin)) throw new Error('Missing input pin name on ' + n.name + '.');
        connections.push('.' + pin + '(' + (src?.node ? getSignalName(src.node, src.pin) : "1'b0") + ')');
      }
      for (let i = 0; i < (n.outputs || 0); i++) {
        const pin = n.outputNames?.[i];
        if (!valid(pin)) throw new Error('Missing output pin name on ' + n.name + '.');
        connections.push('.' + pin + '(' + getSignalName(n, i) + ')');
      }
      lines.push('  ' + moduleName + ' ' + n.name + ' (' + connections.join(', ') + ');');
    }
    for (const n of nodes) {
      if (n.type !== 'DFF' && n.type !== 'LATCH') continue;
      const src = i => { const item = sourceAt(n, i); return item?.node ? getSignalName(item.node, item.pin) : "1'b0"; };
      const q = getSignalName(n);
      lines.push('  reg ' + q + '_reg;');
      if (n.type === 'DFF') lines.push('  initial ' + q + '_reg = 1\'b0;');
      lines.push(n.type === 'DFF'
        ? '  always @(posedge ' + src(1) + ') ' + q + '_reg <= ' + src(0) + ';'
        : '  always @* if (' + src(1) + ') ' + q + '_reg = ' + src(0) + ';');
      lines.push('  assign ' + q + ' = ' + q + '_reg;');
    }
    lines.push('endmodule', '');
    return {
      verilog: lines.join('\n'),
      top: 'fpga_playground',
      signalMap,
      sources: nodes.some(n => n.type === 'MODULE' && n.moduleType)
        ? (window.fpgaVerilogProject?.state?.libraries || [])
          .filter(file => /\.(v|sv)$/i.test(file.name) && typeof file.text === 'string')
          .map(file => ({ name: file.name, text: file.text }))
        : []
    };
  }
  window.fpgaStaBuildDesign = buildDesign;

  function buildSdc() {
    const clock = $('staClockPort').value;
    const period = Number($('staPeriod').value);
    const inputDelay = Number($('staInputDelay').value);
    const outputDelay = Number($('staOutputDelay').value);
    const transition = Number($('staInputTransition').value);
    const load = Number($('staOutputLoad').value);
    for (const [name, value] of Object.entries({period,inputDelay,outputDelay,transition,load})) {
      if (!Number.isFinite(value) || value < 0 || (name === 'period' && value === 0)) throw new Error('Invalid timing constraint: ' + name + '.');
    }
    const inputs = (window.fpgaNodes || []).filter(n => n.type === 'INPUT').map(n => n.name).filter(name => name !== clock);
    const outputs = (window.fpgaNodes || []).filter(n => n.type === 'OUTPUT').map(n => n.name);
    const lines = [clock
      ? 'create_clock -name core_clk -period ' + period + ' [get_ports {' + clock + '}]'
      : 'create_clock -name core_clk -period ' + period];
    if (inputs.length) {
      const ports = '{' + inputs.join(' ') + '}';
      lines.push('set_input_delay -clock core_clk ' + inputDelay + ' [get_ports ' + ports + ']');
      lines.push('set_input_transition ' + transition + ' [get_ports ' + ports + ']');
    }
    if (outputs.length) {
      const ports = '{' + outputs.join(' ') + '}';
      lines.push('set_output_delay -clock core_clk ' + outputDelay + ' [get_ports ' + ports + ']');
      lines.push('set_load ' + load + ' [get_ports ' + ports + ']');
    }
    return lines.join('\n') + '\n';
  }
  window.fpgaStaBuildSdc = buildSdc;

  function clearPathHighlight() {
    window.fpgaStaActivePath = null;
    svg.querySelectorAll('.sta-critical,.sta-path-node').forEach(el => el.classList.remove('sta-critical','sta-path-node'));
  }

  function highlightPath(path, signalMap) {
    clearPathHighlight();
    window.fpgaStaActivePath = { path, signalMap };
    const nodes = new Set(), wires = new Set();
    for (const net of path.nets || []) {
      const mapped = signalMap?.[net];
      if (!mapped) continue;
      if (mapped.nodeId != null) nodes.add(mapped.nodeId);
      (mapped.wireIds || []).forEach(id => wires.add(id));
    }
    for (const id of nodes) svg.querySelectorAll('g[data-node="' + id + '"]').forEach(el => el.classList.add('sta-path-node'));
    for (const id of wires) svg.querySelectorAll('.editor-wire[data-wire="' + id + '"]').forEach(el => el.classList.add('sta-critical'));
    if (!nodes.size && !wires.size) setStatus('Path selected, but the synthesized report did not retain any original schematic net names for highlighting.');
  }
  window.fpgaStaClearHighlight = clearPathHighlight;
  window.fpgaStaHighlightPath = highlightPath;
  function reapplyHighlight() {
    const active = window.fpgaStaActivePath;
    if (!active) return;
    const {path, signalMap} = active;
    for (const net of path.nets || []) {
      const mapped = signalMap?.[net];
      if (!mapped) continue;
      if (mapped.nodeId != null) svg.querySelectorAll('g[data-node="' + mapped.nodeId + '"]').forEach(el => el.classList.add('sta-path-node'));
      (mapped.wireIds || []).forEach(id => svg.querySelectorAll('.editor-wire[data-wire="' + id + '"]').forEach(el => el.classList.add('sta-critical')));
    }
  }
  new MutationObserver(reapplyHighlight).observe(svg, { childList: true, subtree: true });

  function renderResult(result) {
    activeResult = result;
    $('staMetrics').replaceChildren();
    const summary = result.summary || {};
    const holdWns = result.hold_paths?.[0]?.slack;
    const metrics = [
      ['Setup WNS', summary.setup_wns ?? '—', 'ns'],
      ['Setup TNS', summary.setup_tns ?? '—', 'ns'],
      ['Hold worst slack', holdWns ?? '—', 'ns'],
      ['Paths (setup / hold)', (summary.setup_path_count ?? 0) + ' / ' + (summary.hold_path_count ?? 0), '']
    ];
    for (const [label, value, unit] of metrics) {
      const card = document.createElement('div'); card.className = 'sta-metric';
      const small = document.createElement('small'); small.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = value + (unit ? ' ' + unit : '');
      card.append(small, strong); $('staMetrics').append(card);
    }
    const list = $('staPaths'); list.replaceChildren();
    const paths = [
      ...((result.setup_paths || []).map(path => ({...path, kind:'setup'}))),
      ...((result.hold_paths || []).map(path => ({...path, kind:'hold'})))
    ];
    if (!paths.length) list.textContent = 'No constrained timing paths were reported.';
    paths.forEach((path, index) => {
      const button = document.createElement('button'); button.className = 'toolbtn sta-path'; button.type = 'button';
      const label = document.createElement('span');
      label.textContent = (path.kind.toUpperCase()) + ': ' + path.startpoint + ' → ' + path.endpoint;
      const slack = document.createElement('small'); slack.textContent = path.slack == null ? 'slack —' : path.slack.toFixed(4) + ' ns';
      button.append(label, slack);
      button.addEventListener('click', () => highlightPath(path, result.signalMap || {}));
      list.append(button);
    });
    $('staReport').textContent = result.report || '';
    setStatus('STA completed. Select a critical path to highlight its mapped nets and blocks in the schematic.');
  }

  async function checkSession() {
    if (!session()) { $('staAuthStatus').textContent = 'Not signed in. Enter your free broker URL, then sign in with GitHub.'; return; }
    try {
      const status = await api('/api/session');
      $('staAuthStatus').textContent = 'Signed in as ' + status.login + '. The GitHub token remains on the broker.';
    } catch (error) {
      sessionStorage.removeItem(sessionKey);
      $('staAuthStatus').textContent = error.message;
    }
  }

  async function pollJob(jobId) {
    const status = await api('/api/jobs/' + jobId);
    setStatus('STA job ' + status.status + '…');
    if (status.status === 'completed' && status.result) {
      clearInterval(pollTimer); pollTimer = null;
      renderResult(status.result);
    } else if (status.status === 'error') {
      clearInterval(pollTimer); pollTimer = null;
      setStatus(status.error || status.result?.message || 'STA job failed. Inspect the GitHub Actions run.');
    }
  }

  async function runSta() {
    try {
      localStorage.setItem('fpgaStaBrokerUrl', brokerUrl());
      if (!session()) throw new Error('Sign in with GitHub before running STA.');
      const design = buildDesign();
      const sdc = buildSdc();
      const response = await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({...design, sdc, analysis:$('staAnalysis').value})
      });
      if (pollTimer) clearInterval(pollTimer);
      setStatus('STA job queued: ' + response.jobId);
      pollTimer = setInterval(() => pollJob(response.jobId).catch(error => setStatus(error.message)), 3000);
      await pollJob(response.jobId);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function clearResults() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null; activeResult = null;
    $('staMetrics').replaceChildren(); $('staPaths').replaceChildren(); $('staReport').textContent = '';
    clearPathHighlight(); setStatus('Results cleared.');
  }

  $('staOpen').addEventListener('click', () => {
    menu.querySelector('[data-popup="timing"]').hidden = true;
    refreshClockPorts();
    if (!dialog.open) dialog.showModal();
    checkSession();
  });
  $('staClose').addEventListener('click', () => dialog.close());
  $('staLogin').addEventListener('click', () => {
    try {
      localStorage.setItem('fpgaStaBrokerUrl', brokerUrl());
      if (!brokerUrl()) throw new Error('Enter the broker URL first.');
      location.href = brokerUrl() + '/auth/login';
    } catch (error) { setStatus(error.message); }
  });
  $('staLogout').addEventListener('click', () => {
    sessionStorage.removeItem(sessionKey);
    $('staAuthStatus').textContent = 'Signed out.';
  });
  $('staRun').addEventListener('click', runSta);
  $('staClear').addEventListener('click', clearResults);
  $('staClearHighlight').addEventListener('click', () => { clearPathHighlight(); setStatus('Path highlight cleared.'); });
  brokerInput.addEventListener('change', () => localStorage.setItem('fpgaStaBrokerUrl', brokerUrl()));

  const hash = new URLSearchParams(location.hash.slice(1));
  const returnedSession = hash.get('sta_session');
  if (returnedSession) {
    sessionStorage.setItem(sessionKey, returnedSession);
    history.replaceState(null, '', location.pathname + location.search);
  }
  checkSession();
})();
