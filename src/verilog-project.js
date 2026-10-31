(function(){
'use strict';
const $=id=>document.getElementById(id);
const state={project:null,libraries:[],stack:[],current:null,nextId:1};
const ident='[A-Za-z_$][\\w$]*';
function stripComments(s){return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');}
function splitComma(s){const out=[];let start=0,depth=0;for(let i=0;i<s.length;i++){if('([{'.includes(s[i]))depth++;else if(')]}'.includes(s[i]))depth--;else if(s[i]===','&&depth===0){out.push(s.slice(start,i).trim());start=i+1;}}if(s.slice(start).trim())out.push(s.slice(start).trim());return out;}
function parsePorts(header,body){
 const ports=[];const ansi=/\b(input|output|inout)\b/.test(header);
 if(ansi){let direction=null,width=1;for(const part of splitComma(header)){const d=part.match(/\b(input|output|inout)\b/);if(d)direction=d[1].toUpperCase();const r=part.match(/\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]/);width=r?Math.abs(+r[1]-+r[2])+1:1;const name=part.match(/([A-Za-z_$][\w$]*)\s*$/);if(name&&direction){for(let i=0;i<width;i++)ports.push({name:width===1?name[1]:name[1]+'['+i+']',base:name[1],direction,index:ports.length});}}}
 else{
  const dirs=new Map();for(const m of body.matchAll(/\b(input|output|inout)\s+(?:(?:wire|reg|logic)\s+)?(?:\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]\s*)?([^;]+);/gi)){const dir=m[1].toUpperCase(),width=m[2]?Math.abs(+m[2]-+m[3])+1:1;for(const raw of m[4].split(',')){const n=raw.trim().match(/^([A-Za-z_$][\w$]*)/);if(n)dirs.set(n[1],{direction:dir,width});}}
  for(const raw of splitComma(header)){const n=raw.match(/([A-Za-z_$][\w$]*)/);if(n&&dirs.has(n[1])){const d=dirs.get(n[1]);for(let i=0;i<d.width;i++)ports.push({name:d.width===1?n[1]:n[1]+'['+i+']',base:n[1],direction:d.direction,index:ports.length});}}
 }
 return ports;
}
function parseVerilog(source,label){
 const clean=stripComments(source),mods=new Map();
 const re=new RegExp('\\bmodule\\s+('+ident+')\\s*(?:#\\s*\\([\\s\\S]*?\\)\\s*)?\\(([^;]*?)\\)\\s*;([\\s\\S]*?)\\bendmodule\\b','gi');
 for(const m of clean.matchAll(re)){const name=m[1];if(mods.has(name))throw Error('Duplicate Verilog module '+name+' in '+label);const body=m[3];mods.set(name,{name,header:m[2],body,ports:parsePorts(m[2],body),instances:[],gates:[],assigns:[],source:label});}
 for(const mod of mods.values()){
  const body=mod.body;
  for(const st of body.split(';')){const s=st.trim();if(!s)continue;
   let a=s.match(/^assign\s+([A-Za-z_$][\w$]*(?:\s*\[[^\]]+\])?)\s*=\s*([^;]+)$/i);if(a){mod.assigns.push({to:a[1].trim(),from:a[2].trim()});continue;}
   const g=s.match(/^(and|or|xor|nand|nor|xnor|not|buf)\s+(?:\w+\s*)?\(([^()]*)\)$/i);if(g){mod.gates.push({kind:g[1].toLowerCase(),pins:splitComma(g[2])});continue;}
   const inst=s.match(/^([A-Za-z_$][\w$]*)\s*(?:#\s*\([\s\S]*?\)\s*)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
   if(inst){const type=inst[1],name=inst[2],raw=splitComma(inst[3]),connections={};let positional=0;for(const p of raw){const nm=p.match(/^\.([A-Za-z_$][\w$]*)\s*\((.*)\)$/);if(nm)connections[nm[1]]=nm[2].trim();else connections['$'+(positional++)]=p.trim();}mod.instances.push({type,name,connections});}
  }
 }
 if(!mods.size)throw Error('No Verilog module declarations found in '+label);
 return mods;
}
function parseLiberty(source,label){
 const cells=new Map();let i=0;
 while((i=source.indexOf('cell',i))>=0){const m=source.slice(i).match(/^cell\s*\(\s*([^\)]+)\s*\)\s*\{/);if(!m){i+=4;continue;}const name=m[1].trim().replace(/^['\"]|['\"]$/g,''),start=i+m[0].length;let depth=1,j=start;for(;j<source.length&&depth;j++){if(source[j]==='{')depth++;else if(source[j]==='}')depth--;}const body=source.slice(start,j-1),pins=[];let p=0;while((p=body.indexOf('pin',p))>=0){const pm=body.slice(p).match(/^pin\s*\(\s*([^\)]+)\s*\)\s*\{/);if(!pm){p+=3;continue;}const ps=p+pm[0].length;let d=1,k=ps;for(;k<body.length&&d;k++){if(body[k]==='{')d++;else if(body[k]==='}')d--;}const pb=body.slice(ps,k-1),dir=(pb.match(/\bdirection\s*:\s*(input|output|inout)\s*;/i)||[])[1],fn=(pb.match(/\bfunction\s*:\s*([^;]+);/i)||[])[1];pins.push({name:pm[1].trim().replace(/^['\"]|['\"]$/g,''),direction:(dir||'').toUpperCase(),function:fn||null});p=k;}cells.set(name,{name,pins,source:label});i=j;}
 if(!cells.size)throw Error('No Liberty cell() definitions found in '+label);
 return cells;
}
function mergeModules(target,source,label){for(const [name,m] of source){if(target.has(name))throw Error('Duplicate module definition '+name+' while loading '+label);target.set(name,m);}}
function projectFrom(files){
 const modules=new Map(),cells=new Map(),sourceNames=[];
 for(const f of files){sourceNames.push(f.name);if(/\.lib$/i.test(f.name)){for(const [n,c] of parseLiberty(f.text,f.name)){if(cells.has(n))throw Error('Duplicate Liberty cell '+n);cells.set(n,c);}}else mergeModules(modules,parseVerilog(f.text,f.name),f.name);}
 for(const m of modules.values())for(const inst of m.instances)if(modules.has(inst.type))inst.definition=modules.get(inst.type);else if(cells.has(inst.type))inst.cell=cells.get(inst.type);else inst.unresolved=true;
 const used=new Set();for(const m of modules.values())for(const inst of m.instances)if(modules.has(inst.type))used.add(inst.type);
 let tops=[...modules.values()].filter(m=>!used.has(m.name));const designName=files[files.length-1]?.name;const designTops=tops.filter(m=>m.source===designName);if(designTops.length)tops=designTops;
 if(!tops.length)throw Error('No top-level module found (recursive module hierarchy or missing definitions).');
 return {modules,cells,tops,sourceNames};
}
function portSignal(port,instance){return instance.connections[port.name]??instance.connections['$'+port.index]??null;}
function graphFor(mod,path){
 const nodes=[],wires=[],drivers=new Map(),inputs=mod.ports.filter(p=>p.direction==='INPUT'),outputs=mod.ports.filter(p=>p.direction==='OUTPUT');let id=1;
 const add=(type,name,ni,no,extra={})=>{const n={id:id++,type,name,x:0,y:0,value:0,inputs:ni,outputs:no,inputNames:[],outputNames:[],prevClock:0,state:0,...extra};nodes.push(n);return n;};
 for(const p of inputs){const n=add('INPUT',p.name,0,1,{outputNames:[p.name]});drivers.set(p.name,{node:n,pin:0});}
 for(const p of outputs)add('OUTPUT',p.name,1,0,{inputNames:[p.name]});
 const gateTypes={and:'AND',or:'OR',xor:'XOR',nand:'NAND',nor:'NOR',xnor:'XNOR',not:'NOT',buf:'BUF'};
 for(const g of mod.gates){const out=g.pins[0],ins=g.pins.slice(1);const n=add(gateTypes[g.kind],g.kind.toUpperCase()+'_'+id,ins.length,1,{outputNames:[out],inputNames:ins.map((_,i)=>'IN'+(i+1))});drivers.set(out,{node:n,pin:0});}
 for(const inst of mod.instances){const def=inst.definition,cell=inst.cell,ports=def?.ports||cell?.pins||[];const ip=ports.filter(p=>p.direction==='INPUT'||p.direction==='INOUT'),op=ports.filter(p=>p.direction==='OUTPUT');const n=add('MODULE',inst.name,ip.length||Object.keys(inst.connections).filter(k=>k[0]==='$').length,op.length||1,{moduleType:def?.name||null,cellType:cell?.name||null,instancePath:path.concat(inst.name),inputNames:ip.map(p=>p.name),outputNames:op.map(p=>p.name),isUnresolved:!!inst.unresolved});inst.graphDefinition=def||null;inst.graphNodeId=n.id;inst.resolvedPorts=ports;inst._inputPorts=ip;inst._outputPorts=op;}
 for(const inst of mod.instances){const n=nodes.find(x=>x.id===inst.graphNodeId);let ips=inst._inputPorts;if(!ips.length)ips=Object.keys(inst.connections).filter(k=>k[0]==='$').map((k,i)=>({name:'IN'+i,index:i,direction:'INPUT'}));ips.forEach((p,i)=>{const sig=portSignal(p,inst),src=drivers.get(sig);if(src)wires.push({id:id++,from:src.node.id,fromPin:src.pin||0,to:n.id,toPin:i});});
  inst._outputPorts.forEach((p,i)=>{const sig=portSignal(p,inst);if(sig)drivers.set(sig,{node:n,pin:i});});
 }
 for(const a of mod.assigns){const src=drivers.get(a.from);if(src)drivers.set(a.to,src);}
 for(const p of outputs){const target=nodes.find(n=>n.type==='OUTPUT'&&n.name===p.name),src=drivers.get(p.name);if(src)wires.push({id:id++,from:src.node.id,fromPin:src.pin||0,to:target.id,toPin:0});}
 const cols=new Map();for(const n of nodes){const c=n.type==='INPUT'?0:n.type==='OUTPUT'?1000:Math.max(1,Math.min(20,Math.floor(n.id/18)));if(!cols.has(c))cols.set(c,[]);cols.get(c).push(n);}
 const keys=[...cols.keys()].sort((a,b)=>a-b);for(let ci=0;ci<keys.length;ci++){const list=cols.get(keys[ci]);list.forEach((n,i)=>{n.x=40+ci*220;n.y=35+i*105;});}
 return {nodes,wires,nextId:id};
}
function renderModule(mod,path){const g=graphFor(mod,path);state.current={module:mod.name,path:path.slice(),graph:g};window.fpgaLoadCircuit(g.nodes,g.wires,g.nextId);window.fpgaFitView?.();updateNav();}
function updateNav(){const nav=$('hierarchyStatus');if(!nav)return;const names=state.stack.map(x=>x.module.name).concat(state.current?[state.current.module]:[]).map(x=>x.name);nav.textContent='Hierarchy: '+names.join(' / ');$('hierarchyUp').disabled=!state.stack.length;}
function enterSelected(){const sel=window.fpgaSelected,n=sel?.kind==='node'?window.fpgaNodes.find(x=>x.id===sel.id):null;if(!n?.moduleType){$('editorMessage').textContent=n?.cellType?'Library cell '+n.cellType+' is a leaf cell.':'Select a hierarchical module instance first.';return;}const child=state.project.modules.get(n.moduleType);if(!child){$('editorMessage').textContent='Module definition is unavailable: '+n.moduleType;return;}if(state.current.path.includes(n.name)){ $('editorMessage').textContent='Recursive hierarchy detected; navigation stopped.';return;}state.stack.push({module:state.current.module,path:state.current.path,graph:state.current.graph});renderModule(child,state.current.path.concat(n.name));$('editorMessage').textContent='Entered '+n.name+' ('+child.name+').'; Ctrl+E returns to parent.';}
function leave(){if(!state.stack.length)return;const parent=state.stack.pop();state.current={module:parent.module,path:parent.path,graph:parent.graph};window.fpgaLoadCircuit(parent.graph.nodes,parent.graph.wires,parent.graph.nextId);window.fpgaFitView?.();updateNav();$('editorMessage').textContent='Returned to '+parent.module.name+'.';}
function installProject(project,topName){const top=project.modules.get(topName)||project.tops[0];state.project=project;state.stack=[];state.libraries=state.libraries||[];renderModule(top,[]);const unresolved=[...project.modules.values()].reduce((n,m)=>n+m.instances.filter(x=>x.unresolved).length,0);$('editorMessage').textContent='Imported hierarchical project: '+project.modules.size+' Verilog modules, '+project.cells.size+' Liberty cells, '+unresolved+' unresolved instances. Top: '+top.name+'.';}
function setupUI(){
 const toolbar=$('importVerilog')?.parentElement;if(!toolbar||$('importLibraries'))return;
 const b=document.createElement('button');b.id='importLibraries';b.className='toolbtn';b.textContent='Load libraries';toolbar.appendChild(b);
 const f=document.createElement('input');f.id='libraryFiles';f.type='file';f.multiple=true;f.accept='.v,.sv,.lib';f.hidden=true;toolbar.appendChild(f);
 const nav=document.createElement('div');nav.className='editor-toolbar';nav.style.marginTop='8px';nav.innerHTML='<span id="hierarchyStatus" class="status-chip">Hierarchy: —</span><button id="hierarchyUp" class="toolbtn" disabled>Parent (Ctrl+E)</button><span class="editor-hint">Select a module instance and press Shift+E to enter.</span><span id="libraryStatus" class="status-chip">No libraries loaded</span>';toolbar.after(nav);
 b.addEventListener('click',()=>f.click());
 f.addEventListener('change',async()=>{try{const incoming=await Promise.all([...f.files].map(async file=>({name:file.name,text:await file.text()})));const checkModules=new Map(),checkCells=new Map();for(const f0 of [...state.libraries,...incoming]){if(/\\.lib$/i.test(f0.name)){for(const [n,c] of parseLiberty(f0.text,f0.name)){if(checkCells.has(n))throw Error('Duplicate Liberty cell '+n);checkCells.set(n,c);}}else mergeModules(checkModules,parseVerilog(f0.text,f0.name),f0.name);}state.libraries.push(...incoming);$('libraryStatus').textContent=state.libraries.length+' library file(s) · '+checkCells.size+' Liberty cells · '+checkModules.size+' Verilog modules';$('editorMessage').textContent='Loaded '+incoming.length+' library file(s).';}catch(e){$('editorMessage').textContent='Library load failed: '+e.message;}finally{f.value='';}});
 $('hierarchyUp').addEventListener('click',leave);
 document.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.shiftKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='e'){e.preventDefault();enterSelected();}else if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='e'){e.preventDefault();leave();}});
 const importButton=$('importVerilog'),area=$('verilogText'),file=$('verilogFile');
 function importProject(source){const project=projectFrom([...state.libraries,{name:'design.v',text:source}]);installProject(project,project.tops[0].name);return true;}
 // Run before the legacy gate-only capture handler. A single flat module stays on the established path.
 document.addEventListener('click',e=>{if(e.target!==importButton||!area.value.trim())return;const count=[...area.value.matchAll(/\bmodule\s+[A-Za-z_$][\w$]*/g)].length;if(count<2)return;try{e.preventDefault();e.stopImmediatePropagation();importProject(area.value);}catch(err){e.preventDefault();e.stopImmediatePropagation();$('editorMessage').textContent='Import failed: '+err.message;}},true);
 document.addEventListener('change',async e=>{if(e.target!==file||!file.files?.[0])return;const source=await file.files[0].text();const count=[...source.matchAll(/\bmodule\s+[A-Za-z_$][\w$]*/g)].length;if(count<2)return;try{e.stopImmediatePropagation();importProject(source);}catch(err){e.stopImmediatePropagation();$('editorMessage').textContent='Import failed: '+err.message;}finally{file.value='';}},true);
 window.fpgaVerilogProject={parseVerilog,parseLiberty,projectFrom,get state(){return state;},importProject};
}
setupUI();
})();