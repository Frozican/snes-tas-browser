import './style.css';
import { load as loadSnes9x } from '@wasm-gaming/snes9x-wasm';
const $=s=>document.querySelector(s);let frame=0,rom='',length=600,playing=false,engine=null,loadingRom=false,checkpoint=null;const movie=new Map(),keys=['Up','Down','Left','Right','B','A','Y','X','L','R','Select','Start'];
$('#app').innerHTML=`<header><div class="brand"><b>S</b><div><strong>SNES TAS BROWSER</strong><small>FRAME-PERFECT WORKBENCH · PROTOTYPE</small></div></div><button id="export" class="primary">Export Movie JSON</button></header><main><section class="hero"><div><small>SUPER NINTENDO · TOOL-ASSISTED SPEEDRUNNING</small><h1>Every frame.<br><em>Under your control.</em></h1><p>Load your own ROM, map inputs frame by frame, and save your movie project.</p></div><label class="btn">＋ Load ROM<input id="rom" type="file" accept=".sfc,.smc,.fig,.swc"></label></section><div class="notice"><b>SNES9x core loaded. Timeline editing and save states are available; deterministic one-frame execution and RAM reads require a deeper core adapter.</div><section class="grid"><article class="panel"><h3>01 / GAME VIEW <span id="status">NO ROM LOADED</span></h3><div id="screen"><b>SNES<span>TAS</span></b><p>Select a ROM to begin</p><small>YOUR ROM STAYS ON THIS DEVICE</small></div><nav><button id="minus10">↞ 10</button><button id="minus">◂ 1</button><button id="play" class="primary">▶ Play TAS</button><button id="plus">1 ▸</button><button id="plus10">10 ↠</button><button id="save-state">Save state</button><button id="load-state" disabled>Load state</button></nav><div class="readout">CURRENT FRAME <strong id="frame">000000</strong><label>Jump <input id="jump" type="number" min="0" value="0"></label></div></article><article class="panel"><h3>02 / INPUT EDITOR <span>MOVIE DATA</span></h3><div class="toolbar"><div><b>Input timeline</b><small>Pick a frame, then toggle buttons</small></div><button id="clear">Clear frame</button></div><div id="timeline"></div><div class="controller"><div class="dpad"><button data-key="Up">↑</button><div><button data-key="Left">←</button><button data-key="Down">↓</button><button data-key="Right">→</button></div></div><div class="face"><button data-key="X">X</button><button data-key="Y">Y</button><button data-key="A">A</button><button data-key="B">B</button></div><div class="shoulders"><button data-key="L">L</button><button data-key="R">R</button><button data-key="Select">SELECT</button><button data-key="Start">START</button></div></div></article></section><section class="grid lower"><article class="panel"><h3>03 / MEMORY WATCH <span>READ API NOT EXPOSED</span></h3><p class="muted">The emulator is running, but this core wrapper does not yet expose WRAM reads to the UI.</p>${['7E:0000','7E:0002','7E:0004'].map(a=>`<div class="mem"><code>${a}</code><b>—</b><small>WRAM · 24-bit bus address</small></div>`).join('')}</article><article class="panel"><h3>04 / PROJECT <span>LOCAL FILES</span></h3><div class="line"><span>ROM</span><b id="romname">Not loaded</b></div><div class="line"><span>Movie length</span><b id="len">600 frames</b></div><div class="line"><span>Format</span><b>SNES-TAS JSON v1</b></div><div class="actions"><label class="btn">Import movie<input id="import" type="file" accept=".json,application/json"></label></div></article></section><footer>SNES TAS BROWSER <span>Bring your own ROM · Local only · Starter build</span></footer></main>`;
function setInput(k){let s=movie.get(frame)||new Set();s=new Set(s);s.has(k)?s.delete(k):s.add(k);if(s.size)movie.set(frame,s);else movie.delete(frame);draw()}
function draw(){ 
 $('#frame').textContent=String(frame).padStart(6,'0');$('#jump').value=frame;$('#len').textContent=length+' frames';
 const el=$('#timeline');el.innerHTML='';
 const start=Math.max(0,Math.floor(frame/30)*30);
 const table=document.createElement('div');table.className='piano-roll';
 const head=document.createElement('div');head.className='piano-row piano-head';
 head.innerHTML='<div class="frame-label">FRAME</div>'+keys.map(k=>'<div class="key-label">'+k+'</div>').join('');
 table.append(head);
 for(let i=start;i<start+30;i++){
  const row=document.createElement('div');row.className='piano-row'+(i===frame?' current-frame':'');row.dataset.frame=i;
  const label=document.createElement('button');label.className='frame-label';label.textContent=i;label.onclick=()=>{frame=i;draw()};row.append(label);
  keys.forEach(k=>{
   const cell=document.createElement('button');cell.className='roll-cell'+((movie.get(i)||new Set()).has(k)?' on':'');cell.dataset.frame=i;cell.dataset.key=k;cell.setAttribute('aria-label','Frame '+i+', '+k);
   cell.onpointerdown=e=>{e.preventDefault();frame=i;const s=new Set(movie.get(i)||[]);const turnOn=!s.has(k);if(turnOn)s.add(k);else s.delete(k);if(s.size)movie.set(i,s);else movie.delete(i);draw();paintMode={key:k,on:turnOn};};
   cell.onpointerenter=()=>{if(paintMode){const s=new Set(movie.get(i)||[]);paintMode.on?s.add(k):s.delete(k);if(s.size)movie.set(i,s);else movie.delete(i);frame=i;draw();}};
   row.append(cell);
  });
  table.append(row);
 }
 el.append(table);
 document.querySelectorAll('[data-key]').forEach(b=>b.classList.toggle('active',(movie.get(frame)||new Set()).has(b.dataset.key)));
}
let paintMode=null;window.addEventListener('pointerup',()=>paintMode=null);
function step(n){frame=Math.max(0,frame+n);length=Math.max(length,frame+1);draw()}
$('#save-state').onclick=async()=>{if(!engine){alert('Bitte zuerst eine ROM laden.');return}try{checkpoint=await engine.saveState();$('#load-state').disabled=false;$('#status').textContent='STATE SAVED · FRAME '+frame}catch(err){alert('Save State fehlgeschlagen: '+(err?.message||err))}};
$('#load-state').onclick=async()=>{if(!engine||!checkpoint)return;try{engine.pause();playing=false;await engine.loadState(checkpoint);$('#play').textContent='▶ Play TAS';$('#status').textContent='STATE RESTORED · FRAME '+frame}catch(err){alert('Load State fehlgeschlagen: '+(err?.message||err))}};
$('#minus10').onclick=()=>step(-10);$('#minus').onclick=()=>step(-1);$('#plus').onclick=()=>step(1);$('#plus10').onclick=()=>step(10);$('#jump').onchange=e=>{frame=Math.max(0,+e.target.value||0);step(0)};$('#clear').onclick=()=>{movie.delete(frame);draw()};document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>setInput(b.dataset.key));$('#play').onclick=()=>{
 if(!engine){alert('Bitte zuerst eine gültige SNES-ROM laden.');return}
 if(playing){engine.pause();playing=false;$('#play').textContent='▶ Play';$('#status').textContent='EMULATOR PAUSED'}
 else {engine.resume();playing=true;$('#play').textContent='Ⅱ Pause';$('#status').textContent='EMULATOR RUNNING'}
};
$('#rom').onchange=async e=>{
 const f=e.target.files[0];if(!f||loadingRom)return;
 loadingRom=true;rom=f.name;
 if(engine){engine.destroy();engine=null}checkpoint=null;$('#load-state').disabled=true;
 playing=false;$('#play').textContent='▶ Play';$('#status').textContent='LOADING SNES CORE…';$('#romname').textContent=rom;
 $('#screen').innerHTML='<div class="emulator-loading">Loading WebAssembly SNES core…<br><small>ROM remains on this device.</small></div>';
 try{
  const bytes=new Uint8Array(await f.arrayBuffer());
  const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','SNES game display');
  $('#screen').replaceChildren(canvas);
  engine=await loadSnes9x({canvasEl:canvas,assets:{rom:bytes},jsUrl:new URL('core/snes9x.js',window.location.href).href,wasmUrl:new URL('core/snes9x.wasm',window.location.href).href,options:{region:'auto',aspect:'4:3',renderFilter:'pixelated',gamepads:true,escMenu:false},persist:'opfs',storageNamespace:'snes-tas-browser'});
  engine.start();playing=true;$('#play').textContent='Ⅱ Pause';$('#status').textContent='SNES9X RUNNING';
  $('#screen').classList.add('emulator-active');
  $('#screen').insertAdjacentHTML('beforeend',`<div class="rom-meta">${rom.replace(/[&<>"]/g,'')} · ${(bytes.byteLength/1048576).toFixed(2)} MB</div>`);
 }catch(err){
  engine=null;$('#status').textContent='EMULATOR ERROR';
  $('#screen').innerHTML='<b>Could not start SNES9x</b><p>Check that the file is a valid .sfc or .smc ROM and reload.</p><small>Details: '+String(err?.message||err).replace(/[&<>"]/g,'')+'</small>';
  console.error(err);
 }finally{loadingRom=false;e.target.value=''}
};
$('#export').onclick=()=>{let data={format:'SNES-TAS-JSON',version:1,system:'SNES',romName:rom,length,inputs:[...movie].map(([frame,buttons])=>({frame,buttons:[...buttons]}))};let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=(rom||'snes-movie').replace(/\.[^.]+$/,'')+'.tas.json';a.click();URL.revokeObjectURL(a.href)};
$('#import').onchange=async e=>{try{let d=JSON.parse(await e.target.files[0].text());if(d.format!=='SNES-TAS-JSON'||!Array.isArray(d.inputs))throw 0;movie.clear();d.inputs.forEach(r=>movie.set(r.frame,new Set(r.buttons)));length=d.length||600;rom=d.romName||'';frame=0;draw();$('#romname').textContent=rom||'Not loaded'}catch{alert('Ungültige Movie-Datei')}};draw();
