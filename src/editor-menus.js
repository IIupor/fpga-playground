(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const toolbar = $('importVerilog')?.parentElement;
  if (!toolbar || $('editorMenus')) return;
  const addButtons = [...document.querySelectorAll('[data-add]')];
  addButtons.forEach(b => b.hidden = true);
  ['editorUndo','editorRedo','importVerilog','exportVerilog','importLibraries','libraryBrowserButton'].forEach(id => { if ($(id)) $(id).hidden = true; });

  const bar = document.createElement('div');
  bar.id = 'editorMenus'; bar.className = 'editor-menus';
  bar.innerHTML = '<div class="editor-menu"><button class="toolbtn" data-menu="file">File</button><div class="editor-menu-popup" data-popup="file" hidden><button class="toolbtn" id="importBenchmarks">Import File</button><button class="toolbtn" id="importFile">Import editor text</button><button class="toolbtn" id="exportFile">Export file</button></div></div><div class="editor-menu"><button class="toolbtn" data-menu="edit">Edit</button><div class="editor-menu-popup" data-popup="edit" hidden><button class="toolbtn" id="menuUndo">Undo (U)</button><button class="toolbtn" id="menuRedo">Redo (Shift+U)</button></div></div><div class="editor-menu"><button class="toolbtn" data-menu="libraries">Libraries</button><div class="editor-menu-popup" data-popup="libraries" hidden><button class="toolbtn" id="menuLoadLibrary">Load Library</button><button class="toolbtn" id="menuLoadLibraryFile">Load from computer…</button><div class="editor-menu-divider"></div><button class="toolbtn" id="menuStandardPrimitives">Standard Primitives</button><div id="loadedLibraryMenu" class="loaded-library-menu"></div></div></div>';
  toolbar.prepend(bar);

  const panel = $('libraryBrowser');
  if (panel) {
    panel.hidden = true; panel.classList.add('library-browser-panel');
    panel.innerHTML = '<div class="library-browser-column"><div class="library-browser-heading">Libraries</div><div id="libraryBrowserSources" class="library-browser-list"></div></div><div class="library-browser-column"><div class="library-browser-heading" id="libraryBrowserItemsHeading">Standard Primitives</div><input id="libraryCellSearch" type="search" placeholder="Filter cells…" style="width:100%;margin:0 0 8px;padding:7px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text)"><span id="libraryCellCount" class="editor-hint"></span><div id="libraryBrowserItems" class="library-browser-list"></div></div>';
  }
  const style = document.createElement('style');
  style.textContent = '.editor-menus{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-right:8px}.editor-menu{position:relative}.editor-menu-popup{position:absolute;z-index:50;top:calc(100% + 5px);left:0;min-width:190px;padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 28px #0002}.editor-menu-popup[hidden]{display:none}.editor-menu-popup>.toolbtn{text-align:left;white-space:nowrap}.editor-menu-divider{height:1px;background:var(--border);margin:3px 0}.loaded-library-menu{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto}.loaded-library-entry{display:flex;align-items:center;gap:6px}.loaded-library-entry>button:first-child{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis}.library-remove{color:#c62828!important;border-color:#e2a4a4!important;padding:5px 9px!important;font-size:16px;line-height:1}.editor-panel .body{position:relative}.library-browser-panel[hidden]{display:none}.library-browser-panel{position:relative;top:auto;left:auto;z-index:2;width:100%;max-width:760px;margin:0 0 14px;box-shadow:0 14px 36px #0003;display:grid;grid-template-columns:minmax(150px,.8fr) minmax(220px,1.5fr);gap:10px}.library-browser-column{min-width:0;min-height:190px;border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:10px}.library-browser-heading{font-weight:800;font-size:13px;margin-bottom:8px}.library-browser-list{display:flex;flex-direction:column;gap:6px;max-height:310px;overflow:auto}.library-browser-list .toolbtn{text-align:left;white-space:normal}.library-browser-list .toolbtn[aria-pressed="true"]{border-color:var(--site-primary);background:var(--site-secondary);color:var(--site-on-secondary)}@media(max-width:560px){.library-browser-panel{grid-template-columns:1fr}}';
  document.head.append(style);

  function closeMenus(){bar.querySelectorAll('[data-popup]').forEach(p=>p.hidden=true);}
  bar.querySelectorAll('[data-menu]').forEach(b=>b.addEventListener('click',()=>{const p=bar.querySelector('[data-popup="'+b.dataset.menu+'"]');const open=!p.hidden;closeMenus();p.hidden=open;}));
  document.addEventListener('click',e=>{if(!bar.contains(e.target))closeMenus();});
  $('importBenchmarks').onclick=()=>{closeMenus();if(window.fpgaProjectFileBrowser)window.fpgaProjectFileBrowser.open('benchmarks');else $('importVerilog')?.click();};
  $('importFile').onclick=()=>{closeMenus();$('importVerilog')?.click();bar.querySelector('[data-menu="file"]').focus();};
  $('exportFile').onclick=()=>{closeMenus();$('exportVerilog')?.click();};
  $('menuUndo').onclick=()=>{closeMenus();$('editorUndo')?.click();};
  $('menuRedo').onclick=()=>{closeMenus();$('editorRedo')?.click();};
  $('menuLoadLibrary').onclick=()=>{closeMenus();if(window.fpgaProjectFileBrowser)window.fpgaProjectFileBrowser.open('libraries');else $('importLibraries')?.click();};
  $('menuLoadLibraryFile').onclick=()=>{closeMenus();$('importLibraries')?.click();};

  let activeLibrary='standard';
  const files=()=>window.fpgaVerilogProject?.state?.libraries||[];
  const allCells=()=>window.fpgaLibraryBrowser?.cells||[];
  function updateStatus(){
    const status=$('libraryStatus');if(!status)return;
    const moduleCount=files().filter(f=>!/\.lib$/i.test(f.name)).reduce((sum,file)=>{try{return sum+(window.fpgaVerilogProject?.parseVerilog(file.text,file.name).size||0);}catch(_){return sum;}},0);const next=files().length?files().length+' library file(s) · '+allCells().length+' Liberty cells · '+moduleCount+' Verilog modules':'No libraries loaded';if(status.textContent!==next)status.textContent=next;
  }
  function selectLibrary(name){activeLibrary=name;$('libraryBrowser').hidden=false;closeMenus();renderSources();renderItems();}
  function renderSources(){
    const menu=$('loadedLibraryMenu'),list=$('libraryBrowserSources');if(!menu||!list)return;
    menu.replaceChildren();list.replaceChildren();
    const standard=document.createElement('button');standard.className='toolbtn';standard.textContent='Standard Primitives';standard.setAttribute('aria-pressed',String(activeLibrary==='standard'));standard.onclick=()=>selectLibrary('standard');list.append(standard);
    files().forEach(file=>{
      const entry=document.createElement('div');entry.className='loaded-library-entry';
      const choose=document.createElement('button');choose.className='toolbtn';choose.textContent=file.name;choose.title=file.name;choose.setAttribute('aria-pressed',String(activeLibrary===file.name));choose.onclick=()=>selectLibrary(file.name);
      const remove=document.createElement('button');remove.className='toolbtn library-remove';remove.textContent='×';remove.title='Remove library from this project';remove.setAttribute('aria-label','Remove library '+file.name);
      remove.onclick=e=>{e.stopPropagation();const state=window.fpgaVerilogProject?.state;const i=state?.libraries.indexOf(file)??-1;if(i>=0)state.libraries.splice(i,1);if(activeLibrary===file.name)activeLibrary='standard';updateStatus();renderSources();renderItems();$('editorMessage').textContent='Removed '+file.name+' from this project. The file on disk was not changed.';};
      entry.append(choose,remove);menu.append(entry);
      const sourceButton=document.createElement('button');sourceButton.className='toolbtn';sourceButton.textContent=file.name;sourceButton.title=file.name;sourceButton.setAttribute('aria-pressed',String(activeLibrary===file.name));sourceButton.onclick=()=>selectLibrary(file.name);list.append(sourceButton);
    });
  }
  function renderItems(){
    const list=$('libraryBrowserItems');if(!list)return;list.replaceChildren();
    $('libraryBrowserItemsHeading').textContent=activeLibrary==='standard'?'Standard Primitives':activeLibrary;
    if(activeLibrary==='standard'){
      addButtons.forEach(original=>{original.hidden=false;original.style.width='100%';list.append(original);});
      return;
    }
    const file=files().find(f=>f.name===activeLibrary);
    if(!file){const p=document.createElement('p');p.className='editor-hint';p.textContent='This library is no longer loaded.';list.append(p);return;}
    const available=allCells().filter(c=>c.source===file.name&&c.pins.some(p=>p.direction==='OUTPUT')).sort((a,b)=>a.name.localeCompare(b.name));const query=($('libraryCellSearch')?.value||'').trim().toLowerCase();const cells=available.filter(c=>c.name.toLowerCase().includes(query));$('libraryCellCount').textContent=cells.length+' / '+available.length+' placeable cells';
    if(!cells.length){const p=document.createElement('p');p.className='editor-hint';p.textContent=/\.lib$/i.test(file.name)?'No placeable Liberty cells were found in this file.':'This file contains module definitions; direct placement is currently available for Liberty cells.';list.append(p);return;}
    cells.forEach(cell=>{const b=document.createElement('button');b.className='toolbtn';const ni=cell.pins.filter(p=>p.direction==='INPUT'||p.direction==='INOUT').length,no=cell.pins.filter(p=>p.direction==='OUTPUT').length;b.textContent=cell.name+' · '+ni+' inputs · '+no+' outputs';b.onclick=()=>window.fpgaLibraryBrowser?.add(cell);list.append(b);});
  }
  $('menuStandardPrimitives').onclick=()=>selectLibrary('standard');
  $('libraryCellSearch').addEventListener('input',renderItems);
  function toggleBrowser(){const p=$('libraryBrowser');p.hidden=!p.hidden;if(!p.hidden){renderSources();renderItems();}}
  $('libraryBrowserButton')?.addEventListener('click',toggleBrowser);
  const status=$('libraryStatus');if(status)new MutationObserver(()=>{updateStatus();renderSources();renderItems();}).observe(status,{childList:true,characterData:true,subtree:true});

  const info=document.createElement('dialog');info.id='selectedCellInfo';info.className='selected-cell-info';info.innerHTML='<form method="dialog"><div class="selected-cell-info-head"><strong>Element information</strong><button class="toolbtn" aria-label="Close">×</button></div><dl id="selectedCellInfoFields"></dl></form>';document.body.append(info);
  style.textContent += '.selected-cell-info{width:min(480px,calc(100vw - 28px));border:1px solid var(--border);border-radius:14px;padding:16px;background:var(--surface);color:var(--text);box-shadow:0 18px 50px #0004}.selected-cell-info::backdrop{background:#10182888}.selected-cell-info-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.selected-cell-info dl{display:grid;grid-template-columns:125px minmax(0,1fr);gap:9px;margin:0}.selected-cell-info dt{font-weight:800;color:var(--muted)}.selected-cell-info dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}';
  function functionText(node){
    if(node.cellType){const entries=Object.entries(node.cellFunctions||{});if(entries.length)return entries.map(([name,fn])=>name+' = '+fn).join('\n');if(node.cellSequential?.kind==='ff')return 'Sequential cell: D flip-flop';if(node.cellSequential?.kind==='latch')return 'Sequential cell: latch';return 'Function is not defined in the loaded Liberty cell.';}
    const p=node.inputNames?.length?node.inputNames:Array.from({length:node.inputs||0},(_,i)=>'IN'+(i+1));
    return ({AND:p.join(' & '),NAND:'!('+p.join(' & ')+')',OR:p.join(' | '),NOR:'!('+p.join(' | ')+')',XOR:p.join(' ^ '),XNOR:'!('+p.join(' ^ ')+')',NOT:'!'+(p[0]||'IN1'),INPUT:'External input signal',OUTPUT:'Output signal',VDD:'Constant logic 1',GND:'Constant logic 0',DFF:'Q updates to D on the rising edge of CLK',LATCH:'Q follows D while EN = 1'})[node.type]||'Not available';
  }
  function showInfo(){
    const selection=window.fpgaSelected,node=selection?.kind==='node'?(window.fpgaNodes||[]).find(n=>n.id===selection.id):null;
    if(!node){$('editorMessage').textContent='Select an element first, then press Q to view its information.';return;}
    const ins=node.inputNames?.length?node.inputNames:Array.from({length:node.inputs||0},(_,i)=>'IN'+(i+1));
    const outs=node.outputNames?.length?node.outputNames:Array.from({length:node.outputs||0},(_,i)=>'OUT'+(i+1));
    const values=[['Cell name',node.cellType||node.type],['Instance Name',node.name||'—'],['Input Pins',ins.length?ins.join(', '):'None'],['Output Pins',outs.length?outs.join(', '):'None'],['Function',functionText(node)]];
    const dl=$('selectedCellInfoFields');dl.replaceChildren();values.forEach(([k,v])=>{const dt=document.createElement('dt');dt.textContent=k;const dd=document.createElement('dd');dd.textContent=String(v);dl.append(dt,dd);});
    if(!info.open)info.showModal();
  }
  document.addEventListener('keydown',e=>{
    const t=e.target;if(t?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName||''))return;
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='u'&&!e.shiftKey){e.preventDefault();$('editorUndo')?.click();}
    else if(e.key.toLowerCase()==='u'&&e.shiftKey){e.preventDefault();$('editorRedo')?.click();}
    else if(e.key.toLowerCase()==='i'&&!e.shiftKey){e.preventDefault();toggleBrowser();closeMenus();}
    else if(e.key.toLowerCase()==='q'&&!e.shiftKey){e.preventDefault();showInfo();}
    else if(e.key==='Escape')closeMenus();
  });
  renderSources();renderItems();updateStatus();
})();