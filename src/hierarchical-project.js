(function () {
'use strict';
const $ = id => document.getElementById(id);
const state = { project: null, libraries: [], stack: [], current: null };

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\(\*[\s\S]*?\*\)/g, '');
}
function splitComma(source) {
  const parts=[]; let start=0, depth=0;
  for(let i=0;i<source.length;i++){
    if('([{'.includes(source[i])) depth++;
    else if(')]}'.includes(source[i])) depth--;
    else if(source[i]===',' && depth===0){parts.push(source.slice(start,i).trim());start=i+1;}
  }
  if(source.slice(start).trim()) parts.push(source.slice(start).trim());
  return parts;
}
function parsePorts(header, body) {
  const ports=[]; let groupIndex=0;
  const push=(base,direction,msb,lsb)=>{
    const width=Math.abs(msb-lsb)+1, step=lsb>=msb?1:-1;
    for(let offset=0;offset<width;offset++){
      const bit=msb+step*offset;
      ports.push({name:width===1?base:base+'['+bit+']',base,direction,index:groupIndex,bitIndex:bit,bitOffset:offset,width});
    }
    groupIndex++;
  };
  const ansi=/\b(input|output|inout)\b/.test(header);
  if(ansi){
    let direction=null,msb=0,lsb=0;
    for(const part of splitComma(header)){
      const d=part.match(/\b(input|output|inout)\b/);
      if(d){direction=d[1].toUpperCase();msb=0;lsb=0;}
      const range=part.match(/\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]/);
      if(range){msb=+range[1];lsb=+range[2];}
      const name=part.match(/([A-Za-z_$][\w$]*)\s*$/);
      if(name&&direction) push(name[1],direction,msb,lsb);
    }
  } else {
    const declarations=new Map();
    for(const m of body.matchAll(/\b(input|output|inout)\s+(?:(?:wire|reg|logic|signed|unsigned)\s+)*(?:\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]\s*)?([^;]+);/gi)){
      const direction=m[1].toUpperCase(),msb=m[2]===undefined?0:+m[2],lsb=m[3]===undefined?0:+m[3];
      for(const raw of m[4].split(',')){
        const name=raw.trim().match(/^([A-Za-z_$][\w$]*)/);
        if(name) declarations.set(name[1],{direction,msb,lsb});
      }
    }
    for(const raw of splitComma(header)){
      const name=raw.match(/([A-Za-z_$][\w$]*)/);
      if(name&&declarations.has(name[1])){
        const d=declarations.get(name[1]); push(name[1],d.direction,d.msb,d.lsb);
      }
    }
  }
  return ports;
}
function parseVerilog(source,label) {
  const clean=stripComments(source), modules=new Map();
  // Scan module boundaries explicitly. This handles ANSI/non-ANSI headers,
  // parameter lists and modules without a parenthesized port list.
  const declarations=/\bmodule\s+([A-Za-z_$][\w$]*)/gi;
  let declaration;
  while((declaration=declarations.exec(clean))){
    const name=declaration[1];
    let cursor=declarations.lastIndex;
    while(/\s/.test(clean[cursor]||''))cursor++;
    if(clean[cursor]==='#'){
      cursor++;
      while(/\s/.test(clean[cursor]||''))cursor++;
      if(clean[cursor]==='('){
        let depth=1;cursor++;
        while(cursor<clean.length&&depth){if(clean[cursor]==='(')depth++;else if(clean[cursor]===')')depth--;cursor++;}
      }
      while(/\s/.test(clean[cursor]||''))cursor++;
    }
    let header='';
    if(clean[cursor]==='('){
      const start=++cursor;let depth=1;
      while(cursor<clean.length&&depth){if(clean[cursor]==='(')depth++;else if(clean[cursor]===')')depth--;cursor++;}
      header=clean.slice(start,cursor-1);
    }
    const semicolon=clean.indexOf(';',cursor);
    const end=clean.indexOf('endmodule',semicolon+1);
    if(semicolon<0||end<0)throw Error('Malformed Verilog module '+name+' in '+label);
    if(modules.has(name))throw Error('Duplicate Verilog module '+name+' in '+label);
    const body=clean.slice(semicolon+1,end);
    modules.set(name,{name,header,body,ports:parsePorts(header,body),instances:[],gates:[],assigns:[],source:label});
    declarations.lastIndex=end+'endmodule'.length;
  }
  for(const mod of modules.values()){
    for(const statement of mod.body.split(';')){
      const s=statement.trim(); if(!s) continue;
      const assign=s.match(/^assign\s+([A-Za-z_$][\w$]*(?:\s*\[[^\]]+\])?)\s*=\s*([^;]+)$/i);
      if(assign){mod.assigns.push({to:assign[1].trim(),from:assign[2].trim()});continue;}
      const gate=s.match(/^(and|or|xor|nand|nor|xnor|not|buf|dff)\s+(?:\w+\s*)?\(([^()]*)\)$/i);
      if(gate){mod.gates.push({kind:gate[1].toLowerCase(),pins:splitComma(gate[2])});continue;}
      const instance=s.match(/^([A-Za-z_$][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
      if(instance){
        const connections={};let positional=0;
        for(const p of splitComma(instance[3])){
          const named=p.match(/^\.([A-Za-z_$][\w$]*)\s*\((.*)\)$/);
          if(named) connections[named[1]]=named[2].trim();
          else connections['$'+(positional++)]=p.trim();
        }
        mod.instances.push({type:instance[1],name:instance[2],connections});
      }
    }
  }
  if(!modules.size)throw Error('No Verilog module declarations found in '+label);
  return modules;
}
function evalLibertyFunction(expression,env) {
  if(!expression) return 0;
  const tokens=String(expression).match(/[A-Za-z_$][\w$]*|[01]|[!~&*|+^()]/g)||[];
  const compact=String(expression).replace(/\s+/g,'');
  if(tokens.join('')!==compact) return 0;
  let i=0;
  const atom=()=>{
    const t=tokens[i++];
    if(t==='!'||t==='~') return atom()?0:1;
    if(t==='('){const value=or();if(tokens[i]!==')')throw Error('Unbalanced Liberty function');i++;return value;}
    if(t==='0'||t==='1') return Number(t);
    return env[t]?1:0;
  };
  const and=()=>{let v=atom();while(tokens[i]==='&'||tokens[i]==='*'){i++;const r=atom();v=v&&r?1:0;}return v;};
  const xor=()=>{let v=and();while(tokens[i]==='^'){i++;v=v!==and()?1:0;}return v;};
  const or=()=>{let v=xor();while(tokens[i]==='|'||tokens[i]==='+'){i++;const r=xor();v=v||r?1:0;}return v;};
  try{const value=or();return i===tokens.length?value:0;}catch(_){return 0;}
}
window.fpgaEvalLibertyFunction=evalLibertyFunction;

function portSignal(port,instance) {
  const key=port.base||port.name;
  const expr=instance.connections[key]??instance.connections[port.name]??instance.connections['$'+port.index]??null;
  if(expr===null||expr===undefined) return null;
  const signal=String(expr).trim();
  if(!port.width||port.width===1) return signal;
  if(signal.startsWith('{')&&signal.endsWith('}')) return splitComma(signal.slice(1,-1))[port.bitOffset]||null;
  const range=signal.match(/^([A-Za-z_$][\w$]*)\s*\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]$/);
  if(range){
    const width=Math.abs(+range[2]-+range[3])+1;
    if(port.bitOffset>=width) return null;
    const step=+range[3]>=+range[2]?1:-1,bit=+range[2]+step*port.bitOffset;
    return range[1]+'['+bit+']';
  }
  if(/^([A-Za-z_$][\w$]*)\s*\[\s*-?\d+\s*\]$/.test(signal)) return signal;
  if(/^[A-Za-z_$][\w$]*$/.test(signal)) return signal+'['+port.bitIndex+']';
  return null;
}
function parseSequentialGroup(body,kind) {
  const match=body.match(new RegExp('\\b'+kind+'\\s*\\(([^)]*)\\)\\s*\\{'));
  if(!match)return null;
  const start=body.indexOf(match[0])+match[0].length;
  let depth=1,end=start;
  for(;end<body.length&&depth;end++){if(body[end]==='{')depth++;else if(body[end]==='}')depth--;}
  const group=body.slice(start,end-1),args=splitComma(match[1]).map(x=>x.trim().replace(/^['"]|['"]$/g,''));
  const attr=name=>{const value=(group.match(new RegExp('\\b'+name+'\\s*:\\s*([^;]+);','i'))||[])[1];return value?value.trim().replace(/^['"]|['"]$/g,''):null;};
  return kind==='ff'
    ? {kind:'ff',stateVar:args[0]||'IQ',stateVarN:args[1]||'IQ_N',nextState:attr('next_state'),clockedOn:attr('clocked_on'),clear:attr('clear'),preset:attr('preset')}
    : {kind:'latch',stateVar:args[0]||'IQ',stateVarN:args[1]||'IQ_N',dataIn:attr('data_in'),enable:attr('enable')||attr('gate'),clear:attr('clear'),preset:attr('preset')};
}
function parseLiberty(source,label) {
  const cells=new Map(); let i=0;
  while((i=source.indexOf('cell',i))>=0){
    const m=source.slice(i).match(/^cell\s*\(\s*([^\)]+)\s*\)\s*\{/);
    if(!m){i+=4;continue;}
    const name=m[1].trim().replace(/^['"]|['"]$/g,''),start=i+m[0].length;
    let depth=1,j=start;
    for(;j<source.length&&depth;j++){if(source[j]==='{')depth++;else if(source[j]==='}')depth--;}
    const body=source.slice(start,j-1),pins=[];let p=0;
    while((p=body.indexOf('pin',p))>=0){
      const pm=body.slice(p).match(/^pin\s*\(\s*([^\)]+)\s*\)\s*\{/);
      if(!pm){p+=3;continue;}
      const ps=p+pm[0].length;let d=1,k=ps;
      for(;k<body.length&&d;k++){if(body[k]==='{')d++;else if(body[k]==='}')d--;}
      const pb=body.slice(ps,k-1);
      const direction=(pb.match(/\bdirection\s*:\s*(input|output|inout)\s*;/i)||[])[1];
      const fn=(pb.match(/\bfunction\s*:\s*([^;]+);/i)||[])[1];
      const pinName=pm[1].trim().replace(/^['"]|['"]$/g,'');
      pins.push({name:pinName,base:pinName,index:pins.length,bitIndex:0,bitOffset:0,width:1,direction:(direction||'').toUpperCase(),function:fn?fn.trim().replace(/^['"]|['"]$/g,''):null});
      p=k;
    }
    cells.set(name,{name,pins,sequential:parseSequentialGroup(body,'ff')||parseSequentialGroup(body,'latch'),source:label});i=j;
  }
  if(!cells.size) throw Error('No Liberty cell() definitions found in '+label);
  return cells;
}
function mergeModules(target,source,label) {
  for(const [name,mod] of source){if(target.has(name))throw Error('Duplicate module definition '+name+' while loading '+label);target.set(name,mod);}
}
function projectFrom(files) {
  const modules=new Map(),cells=new Map();
  for(const file of files){
    if(/\.lib$/i.test(file.name)){
      for(const [name,cell] of parseLiberty(file.text,file.name)){
        if(cells.has(name))throw Error('Duplicate Liberty cell '+name);
        cells.set(name,cell);
      }
    } else mergeModules(modules,parseVerilog(file.text,file.name),file.name);
  }
  for(const mod of modules.values()){
    for(const inst of mod.instances){
      if(modules.has(inst.type)) inst.definition=modules.get(inst.type);
      else if(cells.has(inst.type)) inst.cell=cells.get(inst.type);
      else inst.unresolved=true;
    }
  }
  const used=new Set();
  for(const mod of modules.values()) for(const inst of mod.instances) if(modules.has(inst.type)) used.add(inst.type);
  let tops=[...modules.values()].filter(mod=>!used.has(mod.name));
  const designName=files[files.length-1]?.name,designTops=tops.filter(mod=>mod.source===designName);
  if(designTops.length) tops=designTops;
  if(!tops.length) throw Error('No top-level module found (recursive module hierarchy or missing definitions).');
  return {modules,cells,tops};
}
function evalModuleOutputs(mod,inputEnv,stack=[]) {
  if(!mod||stack.includes(mod.name)||(mod.gates.length+mod.instances.length)>5000) return {};
  const values=new Map(Object.entries(inputEnv||{}).map(([k,v])=>[k,v?1:0]));
  const read=signal=>{
    if(values.has(signal)) return values.get(signal);
    if(/^(1'b1|1|1'h1)$/i.test(signal)) return 1;
    if(/^(1'b0|0|1'h0)$/i.test(signal)) return 0;
    return undefined;
  };
  const gate=(kind,args)=>{
    if(kind==='and')return args.every(Boolean)?1:0;
    if(kind==='nand')return args.every(Boolean)?0:1;
    if(kind==='or')return args.some(Boolean)?1:0;
    if(kind==='nor')return args.some(Boolean)?0:1;
    if(kind==='xor')return args.filter(Boolean).length%2;
    if(kind==='xnor')return args.filter(Boolean).length%2?0:1;
    if(kind==='not')return args[0]?0:1;
    if(kind==='buf')return args[0]||0;
    return 0;
  };
  for(let pass=0;pass<mod.gates.length+mod.instances.length+mod.assigns.length+2;pass++){
    let changed=false;
    for(const g of mod.gates){
      const inputs=g.pins.slice(1).map(read);if(inputs.some(v=>v===undefined))continue;
      const value=gate(g.kind,inputs);
      if(values.get(g.pins[0])!==value){values.set(g.pins[0],value);changed=true;}
    }
    for(const a of mod.assigns){
      const value=read(a.from);
      if(value!==undefined&&values.get(a.to)!==value){values.set(a.to,value);changed=true;}
    }
    for(const inst of mod.instances){
      const ports=inst.definition?.ports||inst.cell?.pins||[];
      const inputs=ports.filter(p=>p.direction==='INPUT'||p.direction==='INOUT');
      const outputs=ports.filter(p=>p.direction==='OUTPUT'),env={};
      inputs.forEach(p=>{const signal=portSignal(p,inst),value=signal===null?undefined:read(signal);if(value!==undefined)env[p.name]=value;});
      let result={};
      if(inst.cell){for(const p of outputs)if(p.function)result[p.name]=evalLibertyFunction(p.function,env);}
      else if(inst.definition) result=evalModuleOutputs(inst.definition,env,stack.concat(mod.name));
      outputs.forEach(p=>{const signal=portSignal(p,inst),value=result[p.name];if(signal&&value!==undefined&&values.get(signal)!==value){values.set(signal,value);changed=true;}});
    }
    if(!changed) break;
  }
  const result={};
  for(const p of mod.ports) if(p.direction==='OUTPUT') result[p.name]=read(p.name)??0;
  return result;
}
window.fpgaEvalHierarchicalModule=(name,env)=>evalModuleOutputs(state.project?.modules.get(name),env);

function graphFor(mod,path) {
  const nodes=[],wires=[],drivers=new Map();
  const inputs=mod.ports.filter(p=>p.direction==='INPUT'),outputs=mod.ports.filter(p=>p.direction==='OUTPUT');
  let id=1;
  const add=(type,name,inputCount,outputCount,extra={})=>{
    const node={id:id++,type,name,x:0,y:0,value:0,inputs:inputCount,outputs:outputCount,inputNames:[],outputNames:[],prevClock:0,state:0,...extra};
    nodes.push(node);return node;
  };
  for(const port of inputs){
    const node=add('INPUT',port.name,0,1,{outputNames:[port.name]});
    drivers.set(port.name,{node,pin:0});
  }
  for(const port of outputs) add('OUTPUT',port.name,1,0,{inputNames:[port.name]});
  const gateTypes={and:'AND',or:'OR',xor:'XOR',nand:'NAND',nor:'NOR',xnor:'XNOR',not:'NOT',buf:'BUF',dff:'DFF'};
  for(const gate of mod.gates){
    // Legacy ISCAS DFF primitive positional order is (CK, Q, D).
    const pins=gate.kind==='dff'&&gate.pins.length===3?[gate.pins[1],gate.pins[2],gate.pins[0]]:gate.pins;
    const output=pins[0],gateInputs=pins.slice(1);
    const node=add(gateTypes[gate.kind],gate.kind.toUpperCase()+'_'+id,gateInputs.length,1,{outputNames:[output],inputNames:gateInputs.map((_,i)=>'IN'+(i+1)),gateInputSignals:gateInputs});
    drivers.set(output,{node,pin:0});
  }
  for(const inst of mod.instances){
    const definition=inst.definition,cell=inst.cell,ports=definition?.ports||cell?.pins||[];
    let inputPorts=ports.filter(p=>p.direction==='INPUT'||p.direction==='INOUT');
    const outputPorts=ports.filter(p=>p.direction==='OUTPUT');
    if(cell?.sequential){
      const seq=cell.sequential,dataExpr=seq.kind==='ff'?seq.nextState:seq.dataIn,clockExpr=seq.kind==='ff'?seq.clockedOn:seq.enable;
      const pick=expr=>{const names=String(expr||'').match(/[A-Za-z_$][\w$]*/g)||[];return inputPorts.find(p=>names.includes(p.name));};
      const dataPin=pick(dataExpr),clockPin=pick(clockExpr);
      inputPorts=[...new Set([dataPin,clockPin,...inputPorts].filter(Boolean))];
    }
    const nodeType=cell?.sequential?.kind==='ff'?'DFF':cell?.sequential?.kind==='latch'?'LATCH':'MODULE';
    const node=add(nodeType,inst.name,inputPorts.length||Object.keys(inst.connections).filter(k=>k[0]==='$').length,outputPorts.length||1,{
      moduleType:definition?.name||null,cellType:cell?.name||null,instancePath:path.concat(inst.name),
      inputNames:inputPorts.map(p=>p.name),outputNames:outputPorts.map(p=>p.name),
      cellFunctions:cell?Object.fromEntries(outputPorts.filter(p=>p.function).map(p=>[p.name,p.function])):null,cellSequential:cell?.sequential||null,
      isUnresolved:!!inst.unresolved
    });
    inst.graphNodeId=node.id;inst._inputPorts=inputPorts;inst._outputPorts=outputPorts;
  }
  for(const inst of mod.instances){
    const node=nodes.find(n=>n.id===inst.graphNodeId);
    inst._outputPorts.forEach((port,index)=>{const signal=portSignal(port,inst);if(signal)drivers.set(signal,{node,pin:index});});
  }
  for(let pass=0;pass<mod.assigns.length+1;pass++){
    let changed=false;
    for(const assign of mod.assigns){const source=drivers.get(assign.from);if(source&&drivers.get(assign.to)!==source){drivers.set(assign.to,source);changed=true;}}
    if(!changed)break;
  }
  // Connect primitive gates as well as module/Liberty instances.
  for(const node of nodes){
    (node.gateInputSignals||[]).forEach((signal,index)=>{
      const source=drivers.get(signal);
      if(source) wires.push({id:id++,from:source.node.id,fromPin:source.pin||0,to:node.id,toPin:index});
    });
  }
  for(const inst of mod.instances){
    const node=nodes.find(n=>n.id===inst.graphNodeId);
    let inputPorts=inst._inputPorts;
    if(!inputPorts.length) inputPorts=Object.keys(inst.connections).filter(k=>k[0]==='
  for(const port of outputs){
    const target=nodes.find(n=>n.type==='OUTPUT'&&n.name===port.name),source=drivers.get(port.name);
    if(source) wires.push({id:id++,from:source.node.id,fromPin:source.pin||0,to:target.id,toPin:0});
  }
  const columns=new Map();
  for(const node of nodes){
    const column=node.type==='INPUT'?0:node.type==='OUTPUT'?1000:Math.max(1,Math.min(20,Math.floor(node.id/18)));
    if(!columns.has(column))columns.set(column,[]);
    columns.get(column).push(node);
  }
  const keys=[...columns.keys()].sort((a,b)=>a-b);
  for(let ci=0;ci<keys.length;ci++) columns.get(keys[ci]).forEach((node,index)=>{node.x=40+ci*220;node.y=35+index*105;});
  return {nodes,wires,nextId:id};
}
function renderModule(mod,path) {
  const graph=graphFor(mod,path);
  state.current={module:mod,path:path.slice(),graph};
  window.fpgaLoadCircuit(graph.nodes,graph.wires,graph.nextId);
  window.fpgaFitView?.();
  updateNav();
}
function updateNav() {
  const nav=$('hierarchyStatus');if(!nav)return;
  const names=[];
  if(state.stack.length){
    names.push(state.stack[0].module.name);
    for(let i=1;i<state.stack.length;i++) names.push(state.stack[i].path[state.stack[i].path.length-1],state.stack[i].module.name);
    if(state.current) names.push(state.current.path[state.current.path.length-1],state.current.module.name);
  } else if(state.current) names.push(state.current.module.name);
  nav.textContent='Hierarchy: '+names.join(' / ');
  $('hierarchyUp').disabled=!state.stack.length;
}
function enterSelected() {
  const selection=window.fpgaSelected;
  const node=selection?.kind==='node'?window.fpgaNodes.find(n=>n.id===selection.id):null;
  if(!node?.moduleType){$('editorMessage').textContent=node?.cellType?'Library cell '+node.cellType+' is a leaf cell.':'Select a hierarchical module instance first.';return;}
  const child=state.project.modules.get(node.moduleType);
  if(!child){$('editorMessage').textContent='Module definition is unavailable: '+node.moduleType;return;}
  if(state.current.path.includes(node.name)){$('editorMessage').textContent='Recursive hierarchy detected; navigation stopped.';return;}
  state.stack.push({module:state.current.module,path:state.current.path,graph:state.current.graph});
  renderModule(child,state.current.path.concat(node.name));
  $('editorMessage').textContent='Entered '+node.name+' ('+child.name+'). Press Ctrl+E to return to parent.';
}
function leave() {
  if(!state.stack.length)return;
  const parent=state.stack.pop();
  state.current={module:parent.module,path:parent.path,graph:parent.graph};
  window.fpgaLoadCircuit(parent.graph.nodes,parent.graph.wires,parent.graph.nextId);
  window.fpgaFitView?.();
  updateNav();
  $('editorMessage').textContent='Returned to '+parent.module.name+'.';
}
function installProject(project,topName) {
  const top=project.modules.get(topName)||project.tops[0];
  state.project=project;state.stack=[];
  renderModule(top,[]);
  const unresolved=[...project.modules.values()].reduce((count,mod)=>count+mod.instances.filter(inst=>inst.unresolved).length,0);
  $('editorMessage').textContent='Imported hierarchical project: '+project.modules.size+' Verilog modules, '+project.cells.size+' Liberty cells, '+unresolved+' unresolved instances. Top: '+top.name+'.';
}
function setupUI() {
  const toolbar=$('importVerilog')?.parentElement;
  if(!toolbar||$('importLibraries'))return;
  const button=document.createElement('button');button.id='importLibraries';button.className='toolbtn';button.textContent='Load libraries';toolbar.appendChild(button);
  const fileInput=document.createElement('input');fileInput.id='libraryFiles';fileInput.type='file';fileInput.multiple=true;fileInput.accept='.v,.sv,.lib';fileInput.hidden=true;toolbar.appendChild(fileInput);
  const nav=document.createElement('div');nav.className='editor-toolbar';nav.style.marginTop='8px';
  nav.innerHTML='<span id="hierarchyStatus" class="status-chip">Hierarchy: —</span><button id="hierarchyUp" class="toolbtn" disabled>Parent (Ctrl+E)</button><span class="editor-hint">Select a module instance and press Shift+E to enter.</span><span id="libraryStatus" class="status-chip">No libraries loaded</span>';
  toolbar.after(nav);
  button.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{
    try{
      const incoming=await Promise.all([...fileInput.files].map(async file=>({name:file.name,text:await file.text()})));
      const checkModules=new Map(),checkCells=new Map();
      for(const file of [...state.libraries,...incoming]){
        if(/\.lib$/i.test(file.name)){
          for(const [name,cell] of parseLiberty(file.text,file.name)){if(checkCells.has(name))throw Error('Duplicate Liberty cell '+name);checkCells.set(name,cell);}
        } else mergeModules(checkModules,parseVerilog(file.text,file.name),file.name);
      }
      state.libraries.push(...incoming);
      $('libraryStatus').textContent=state.libraries.length+' library file(s) · '+checkCells.size+' Liberty cells · '+checkModules.size+' Verilog modules';
      $('editorMessage').textContent='Loaded '+incoming.length+' library file(s).';
    } catch(error){$('editorMessage').textContent='Library load failed: '+error.message;}
    finally{fileInput.value='';}
  });
  $('hierarchyUp').addEventListener('click',leave);
  document.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLElement&&/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
    if(event.shiftKey&&!event.ctrlKey&&!event.altKey&&event.key.toLowerCase()==='e'){event.preventDefault();enterSelected();}
    else if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='e'){event.preventDefault();leave();}
  });
  const importButton=$('importVerilog'),area=$('verilogText'),verilogFile=$('verilogFile');
  function hasHierarchicalInstances(source){
    const clean=stripComments(source);
    const declared=new Set([...clean.matchAll(/\bmodule\s+([A-Za-z_$][\w$]*)/gi)].map(match=>match[1].toLowerCase()));
    if(declared.size<2)return false;
    const instances=/(?:^|;)\s*([A-Za-z_$][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?([A-Za-z_$][\w$]*)\s*\(/gm;
    let match;
    while((match=instances.exec(clean))){
      const type=match[1].toLowerCase();
      // ISCAS89 netlists often declare "module dff" only to describe a
      // primitive DFF model; dff instances must remain on the legacy path.
      if(declared.has(type)&&type!=='dff')return true;
    }
    return false;
  }
  function importProject(source,topName){
    const project=projectFrom([...state.libraries,{name:'design.v',text:source}]);
    area.value=source;
    installProject(project,topName||project.tops[0].name);
    return true;
  }
  document.addEventListener('click',event=>{
    if(event.target!==importButton||!area.value.trim())return;
    try{
      const hasHierarchy=hasHierarchicalInstances(area.value);
      if(!hasHierarchy&&!state.libraries.length)return;
      event.preventDefault();event.stopImmediatePropagation();importProject(area.value);
    } catch(error){event.preventDefault();event.stopImmediatePropagation();$('editorMessage').textContent='Import failed: '+error.message;}
  },true);
  document.addEventListener('change',event=>{
    if(event.target!==verilogFile||!verilogFile.files?.[0])return;
    const selectedFile=verilogFile.files[0];event.stopImmediatePropagation();
    selectedFile.text().then(source=>{
      if(hasHierarchicalInstances(source)||state.libraries.length)importProject(source);
      else {area.value=source;importButton.click();}
    }).catch(error=>{$('editorMessage').textContent='Import failed: '+error.message;}).finally(()=>{verilogFile.value='';});
  },true);
  window.fpgaVerilogProject={parseVerilog,parseLiberty,projectFrom,get state(){return state;},importProject};
}
setupUI();
})();).map((key,index)=>({name:'IN'+index,index,direction:'INPUT',base:'IN'+index,width:1}));
    inputPorts.forEach((port,index)=>{
      const signal=portSignal(port,inst),source=drivers.get(signal);
      if(source) wires.push({id:id++,from:source.node.id,fromPin:source.pin||0,to:node.id,toPin:index});
    });
  }
  for(const port of outputs){
    const target=nodes.find(n=>n.type==='OUTPUT'&&n.name===port.name),source=drivers.get(port.name);
    if(source) wires.push({id:id++,from:source.node.id,fromPin:source.pin||0,to:target.id,toPin:0});
  }
  const columns=new Map();
  for(const node of nodes){
    const column=node.type==='INPUT'?0:node.type==='OUTPUT'?1000:Math.max(1,Math.min(20,Math.floor(node.id/18)));
    if(!columns.has(column))columns.set(column,[]);
    columns.get(column).push(node);
  }
  const keys=[...columns.keys()].sort((a,b)=>a-b);
  for(let ci=0;ci<keys.length;ci++) columns.get(keys[ci]).forEach((node,index)=>{node.x=40+ci*220;node.y=35+index*105;});
  return {nodes,wires,nextId:id};
}
function renderModule(mod,path) {
  const graph=graphFor(mod,path);
  state.current={module:mod,path:path.slice(),graph};
  window.fpgaLoadCircuit(graph.nodes,graph.wires,graph.nextId);
  window.fpgaFitView?.();
  updateNav();
}
function updateNav() {
  const nav=$('hierarchyStatus');if(!nav)return;
  const names=[];
  if(state.stack.length){
    names.push(state.stack[0].module.name);
    for(let i=1;i<state.stack.length;i++) names.push(state.stack[i].path[state.stack[i].path.length-1],state.stack[i].module.name);
    if(state.current) names.push(state.current.path[state.current.path.length-1],state.current.module.name);
  } else if(state.current) names.push(state.current.module.name);
  nav.textContent='Hierarchy: '+names.join(' / ');
  $('hierarchyUp').disabled=!state.stack.length;
}
function enterSelected() {
  const selection=window.fpgaSelected;
  const node=selection?.kind==='node'?window.fpgaNodes.find(n=>n.id===selection.id):null;
  if(!node?.moduleType){$('editorMessage').textContent=node?.cellType?'Library cell '+node.cellType+' is a leaf cell.':'Select a hierarchical module instance first.';return;}
  const child=state.project.modules.get(node.moduleType);
  if(!child){$('editorMessage').textContent='Module definition is unavailable: '+node.moduleType;return;}
  if(state.current.path.includes(node.name)){$('editorMessage').textContent='Recursive hierarchy detected; navigation stopped.';return;}
  state.stack.push({module:state.current.module,path:state.current.path,graph:state.current.graph});
  renderModule(child,state.current.path.concat(node.name));
  $('editorMessage').textContent='Entered '+node.name+' ('+child.name+'). Press Ctrl+E to return to parent.';
}
function leave() {
  if(!state.stack.length)return;
  const parent=state.stack.pop();
  state.current={module:parent.module,path:parent.path,graph:parent.graph};
  window.fpgaLoadCircuit(parent.graph.nodes,parent.graph.wires,parent.graph.nextId);
  window.fpgaFitView?.();
  updateNav();
  $('editorMessage').textContent='Returned to '+parent.module.name+'.';
}
function installProject(project,topName) {
  const top=project.modules.get(topName)||project.tops[0];
  state.project=project;state.stack=[];
  renderModule(top,[]);
  const unresolved=[...project.modules.values()].reduce((count,mod)=>count+mod.instances.filter(inst=>inst.unresolved).length,0);
  $('editorMessage').textContent='Imported hierarchical project: '+project.modules.size+' Verilog modules, '+project.cells.size+' Liberty cells, '+unresolved+' unresolved instances. Top: '+top.name+'.';
}
function setupUI() {
  const toolbar=$('importVerilog')?.parentElement;
  if(!toolbar||$('importLibraries'))return;
  const button=document.createElement('button');button.id='importLibraries';button.className='toolbtn';button.textContent='Load libraries';toolbar.appendChild(button);
  const fileInput=document.createElement('input');fileInput.id='libraryFiles';fileInput.type='file';fileInput.multiple=true;fileInput.accept='.v,.sv,.lib';fileInput.hidden=true;toolbar.appendChild(fileInput);
  const nav=document.createElement('div');nav.className='editor-toolbar';nav.style.marginTop='8px';
  nav.innerHTML='<span id="hierarchyStatus" class="status-chip">Hierarchy: —</span><button id="hierarchyUp" class="toolbtn" disabled>Parent (Ctrl+E)</button><span class="editor-hint">Select a module instance and press Shift+E to enter.</span><span id="libraryStatus" class="status-chip">No libraries loaded</span>';
  toolbar.after(nav);
  button.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',async()=>{
    try{
      const incoming=await Promise.all([...fileInput.files].map(async file=>({name:file.name,text:await file.text()})));
      const checkModules=new Map(),checkCells=new Map();
      for(const file of [...state.libraries,...incoming]){
        if(/\.lib$/i.test(file.name)){
          for(const [name,cell] of parseLiberty(file.text,file.name)){if(checkCells.has(name))throw Error('Duplicate Liberty cell '+name);checkCells.set(name,cell);}
        } else mergeModules(checkModules,parseVerilog(file.text,file.name),file.name);
      }
      state.libraries.push(...incoming);
      $('libraryStatus').textContent=state.libraries.length+' library file(s) · '+checkCells.size+' Liberty cells · '+checkModules.size+' Verilog modules';
      $('editorMessage').textContent='Loaded '+incoming.length+' library file(s).';
    } catch(error){$('editorMessage').textContent='Library load failed: '+error.message;}
    finally{fileInput.value='';}
  });
  $('hierarchyUp').addEventListener('click',leave);
  document.addEventListener('keydown',event=>{
    if(event.target instanceof HTMLElement&&/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
    if(event.shiftKey&&!event.ctrlKey&&!event.altKey&&event.key.toLowerCase()==='e'){event.preventDefault();enterSelected();}
    else if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='e'){event.preventDefault();leave();}
  });
  const importButton=$('importVerilog'),area=$('verilogText'),verilogFile=$('verilogFile');
  function importProject(source,topName){
    const project=projectFrom([...state.libraries,{name:'design.v',text:source}]);
    area.value=source;
    installProject(project,topName||project.tops[0].name);
    return true;
  }
  document.addEventListener('click',event=>{
    if(event.target!==importButton||!area.value.trim())return;
    try{
      const hasHierarchy=hasHierarchicalInstances(area.value);
      if(!hasHierarchy&&!state.libraries.length)return;
      event.preventDefault();event.stopImmediatePropagation();importProject(area.value);
    } catch(error){event.preventDefault();event.stopImmediatePropagation();$('editorMessage').textContent='Import failed: '+error.message;}
  },true);
  document.addEventListener('change',event=>{
    if(event.target!==verilogFile||!verilogFile.files?.[0])return;
    const selectedFile=verilogFile.files[0];event.stopImmediatePropagation();
    selectedFile.text().then(source=>{
      if(hasHierarchicalInstances(source)||state.libraries.length)importProject(source);
      else {area.value=source;importButton.click();}
    }).catch(error=>{$('editorMessage').textContent='Import failed: '+error.message;}).finally(()=>{verilogFile.value='';});
  },true);
  window.fpgaVerilogProject={parseVerilog,parseLiberty,projectFrom,get state(){return state;},importProject};
}
setupUI();
})();