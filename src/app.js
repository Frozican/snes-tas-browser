import './style.css';
import { load as loadSnes9x } from './vendor/snes9x/snes9x.sdk.ts';
const $=s=>document.querySelector(s);let frame=0,rom='',length=600,playing=false,engine=null,loadingRom=false,checkpoint=null,playTimer=null;const frameStates=new Map();const movie=new Map(),pressedKeys=new Set();let recordingInputs=false,mediaRecorder=null,mediaChunks=[],videoStream=null;const keys=['Up','Down','Left','Right','B','A','Y','X','L','R','Select','Start'];
$('#app').innerHTML=`<header><div class="brand"><b>S</b><div><strong>SNES TAS BROWSER</strong><small>FRAME-PERFECT WORKBENCH · PROTOTYPE</small></div></div><button id="export" class="primary">Export .snes-tas</button></header><main><section class="hero"><div><small>SUPER NINTENDO · TOOL-ASSISTED SPEEDRUNNING</small><h1>Every frame.<br><em>Under your control.</em></h1><p>Load your own ROM, map inputs frame by frame, and save your movie project.</p></div><label class="btn">＋ Load ROM<input id="rom" type="file" accept=".sfc,.smc,.fig,.swc"></label></section><div class="notice"><b>SNES9x core loaded. Timeline editing and save states are available; deterministic one-frame execution and RAM reads require a deeper core adapter.</div><section class="grid"><article class="panel"><h3>01 / GAME VIEW <span id="status">NO ROM LOADED</span></h3><div id="screen"><b>SNES<span>TAS</span></b><p>Select a ROM to begin</p><small>YOUR ROM STAYS ON THIS DEVICE</small></div><nav><button id="minus10">↞ 10</button><button id="minus">◂ 1</button><button id="play" class="primary">▶ Play TAS</button><button id="plus">1 ▸</button><button id="plus10">10 ↠</button><button id="reset-rom">↻ ROM Reset</button><button id="record-input">● Record Inputs</button><button id="save-state">Save state</button><button id="load-state" disabled>Load state</button></nav><div class="readout">CURRENT FRAME <strong id="frame">000000</strong><label>Jump <input id="jump" type="number" min="0" value="0"></label></div></article><article class="panel"><h3>02 / INPUT EDITOR <span>MOVIE DATA</span></h3><div class="toolbar"><div><b>Input timeline</b><small>Pick a frame, then toggle buttons</small></div><button id="clear">Clear frame</button></div><div id="timeline"></div><div class="range-editor"><b>Hold Button for Range</b><small>Hold one input from a start frame through an end frame (inclusive).</small><div class="range-fields"><label>Start frame<input id="range-start" type="number" min="0" value="0" inputmode="numeric"></label><label>End frame<input id="range-end" type="number" min="0" value="59" inputmode="numeric"></label><label>Input<select id="range-key"><option>Up</option><option>Down</option><option>Left</option><option>Right</option><option>B</option><option>A</option><option>Y</option><option>X</option><option>L</option><option>R</option><option>Select</option><option>Start</option></select></label></div><div class="range-actions"><button id="apply-range" class="primary">Apply Hold</button><button id="clear-range">Clear Input in Range</button></div></div><div class="controller"><div class="dpad"><button data-key="Up">↑</button><div><button data-key="Left">←</button><button data-key="Down">↓</button><button data-key="Right">→</button></div></div><div class="face"><button data-key="X">X</button><button data-key="Y">Y</button><button data-key="A">A</button><button data-key="B">B</button></div><div class="shoulders"><button data-key="L">L</button><button data-key="R">R</button><button data-key="Select">SELECT</button><button data-key="Start">START</button></div></div></article></section><section class="grid lower"><article class="panel"><h3>03 / MEMORY WATCH <span>READ API NOT EXPOSED</span></h3><p class="muted">The emulator is running, but this core wrapper does not yet expose WRAM reads to the UI.</p>${['7E:0000','7E:0002','7E:0004'].map(a=>`<div class="mem"><code>${a}</code><b>—</b><small>WRAM · 24-bit bus address</small></div>`).join('')}</article><article class="panel"><h3>04 / PROJECT <span>LOCAL FILES</span></h3><div class="line"><span>ROM</span><b id="romname">Not loaded</b></div><div class="line"><span>Movie length</span><label class="length-control"><input id="movie-length" type="number" min="1" max="1000000" step="1" value="600" inputmode="numeric" aria-label="Movie length in frames"><span>frames</span></label></div><small class="muted">Playback stops automatically at this frame count. 60 frames ≈ 1 second.</small><div class="line"><span>Format</span><b>SNES-TAS JSON v1</b></div><div class="actions"><label class="btn">Import TAS<input id="import" type="file" accept=".snes-tas,.json,.bk2,application/json,application/zip"></label><button id="video-record" class="primary">● Record Video</button><button id="video-stop" disabled>■ Stop & Export</button><small id="video-status" class="muted">MP4 if supported by browser; otherwise WebM.</small></div></article></section><footer>SNES TAS BROWSER <span>Bring your own ROM · Local only · Starter build</span></footer></main>`;
function setInput(k){let s=movie.get(frame)||new Set();s=new Set(s);s.has(k)?s.delete(k):s.add(k);if(s.size)movie.set(frame,s);else movie.delete(frame);draw()}
function draw(){ 
 $('#frame').textContent=String(frame).padStart(6,'0');$('#jump').value=frame;const lengthInput=$('#movie-length');if(lengthInput&&document.activeElement!==lengthInput)lengthInput.value=length;
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
async function step(n){
 if(!engine){frame=Math.max(0,frame+n);length=Math.max(length,frame+1);draw();return}
 if(playing)stopTas();
 if(n<0){
  const target=Math.max(0,frame+n);
  const candidates=[...frameStates.keys()].filter(f=>f<=target).sort((a,b)=>b-a);
  const base=candidates.length?candidates[0]:null;
  if(base===null){alert('Noch kein Checkpoint vor diesem Frame. Drücke ROM Reset und gehe dann vorwärts, damit Checkpoints erstellt werden.');return}
  try{
   engine.pause();playing=false;
   await engine.loadState(frameStates.get(base));frame=base;
   for(;frame<target;frame++){engine.setTasInput([...(movie.get(frame)||new Set())]);engine.stepFrame()}
   $('#status').textContent='REWOUND · FRAME '+frame;draw()
  }catch(err){$('#status').textContent='REWIND ERROR';alert('Zurückspringen fehlgeschlagen: '+(err?.message||err))}
  return
 }
 for(let i=0;i<n;i++){const buttons=[...(movie.get(frame)||new Set())];engine.setTasInput(buttons);engine.stepFrame();frame++;length=Math.max(length,frame+1);if(frame%30===0){try{frameStates.set(frame,await engine.saveState())}catch{}}}
 $('#status').textContent='PAUSED · CORE FRAME '+frame;draw()
}
function stopTas(){if(playTimer!==null){clearInterval(playTimer);playTimer=null}playing=false;if(engine)engine.pause();$('#play').textContent='▶ Play TAS'}
function keyName(e){const map={ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',z:'B',x:'A',a:'Y',s:'X',q:'L',w:'R',Shift:'Select',Enter:'Start'};return map[e.key]||null}
window.addEventListener('keydown',e=>{const k=keyName(e);if(k){pressedKeys.add(k);if(recordingInputs)e.preventDefault()}});
window.addEventListener('keyup',e=>{const k=keyName(e);if(k){pressedKeys.delete(k);if(recordingInputs)e.preventDefault()}});
window.addEventListener('blur',()=>pressedKeys.clear());
$('#record-input').onclick=()=>{recordingInputs=!recordingInputs;$('#record-input').textContent=recordingInputs?'■ Stop Input Recording':'● Record Inputs';$('#record-input').classList.toggle('primary',recordingInputs);if(recordingInputs){frame=0;length=1;movie.clear();$('#status').textContent='INPUT RECORDING · PRESS PLAY'}else $('#status').textContent='INPUT RECORDING STOPPED';draw()};
function stopVideoCapture(){
 if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();
}
$('#video-record').onclick=async()=>{
 const canvas=$('#game-canvas');
 if(!canvas){alert('Bitte zuerst eine ROM laden.');return}
 if(!canvas.captureStream||!window.MediaRecorder){alert('Videoaufnahme wird von diesem Browser nicht unterstützt.');return}
 if(frame>=length)frame=0;
 try{
  videoStream=canvas.captureStream(30);mediaChunks=[];
  if(engine?.audioCaptureStream){for(const track of engine.audioCaptureStream().getAudioTracks())videoStream.addTrack(track)}
  const types=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm'];
  const mime=types.find(t=>MediaRecorder.isTypeSupported(t))||'';
  mediaRecorder=new MediaRecorder(videoStream,mime?{mimeType:mime}:undefined);
  mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)mediaChunks.push(e.data)};
  mediaRecorder.onstop=()=>{
   const type=mediaRecorder.mimeType||'video/webm';const ext=type.includes('mp4')?'mp4':'webm';
   const blob=new Blob(mediaChunks,{type});
   if(blob.size){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=(rom||'snes-recording').replace(/\.[^.]+$/,'')+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
   $('#video-status').textContent='Exported '+ext.toUpperCase()+' · '+(blob.size/1048576).toFixed(1)+' MB';
   $('#video-record').disabled=false;$('#video-stop').disabled=true;
   videoStream?.getTracks().forEach(t=>t.stop());videoStream=null;
  };
  mediaRecorder.start();
  $('#video-record').disabled=true;$('#video-stop').disabled=false;
  $('#video-status').textContent='Recording video + emulator audio…';
  if(engine?.resumeAudioForCapture)await engine.resumeAudioForCapture();
  if(!playing)playTas();
 }catch(err){alert('Videoaufnahme fehlgeschlagen: '+(err?.message||err))}
};
$('#video-stop').onclick=()=>{stopTas();stopVideoCapture()};
function playTas(){if(!engine){alert('Bitte zuerst eine gültige SNES-ROM laden.');return}if(playing){stopTas();$('#status').textContent='EMULATOR PAUSED';return}if(frame===0&&!recordingInputs){engine.pause();engine.reset();engine.setTasInput([])}playing=true;$('#play').textContent='Ⅱ Pause';$('#status').textContent='TAS PLAYBACK';if(mediaRecorder&&mediaRecorder.state==='recording'){void engine.resumeAudioForCapture()}else engine.pause();playTimer=setInterval(()=>{if(!engine||!playing){stopTas();return}if(frame>=length){stopTas();$('#status').textContent='MOVIE END';if(mediaRecorder&&mediaRecorder.state!=='inactive')stopVideoCapture();return}try{const buttons=recordingInputs?[...pressedKeys]:[...(movie.get(frame)||new Set())];engine.setTasInput(buttons);engine.stepFrame();const track=videoStream?.getVideoTracks?.()[0];if(track&&typeof track.requestFrame==='function')track.requestFrame();if(recordingInputs){if(buttons.length)movie.set(frame,new Set(buttons));else movie.delete(frame);length=Math.max(length,frame+1)}frame++;draw()}catch(err){stopTas();$('#status').textContent='TAS ERROR';console.error(err)}},16);}
$('#save-state').onclick=async()=>{if(!engine){alert('Bitte zuerst eine ROM laden.');return}try{checkpoint=await engine.saveState();frameStates.set(frame,checkpoint);$('#load-state').disabled=false;$('#status').textContent='STATE SAVED · FRAME '+frame}catch(err){alert('Save State fehlgeschlagen: '+(err?.message||err))}};
$('#load-state').onclick=async()=>{if(!engine||!checkpoint)return;try{engine.pause();playing=false;await engine.loadState(checkpoint);$('#play').textContent='▶ Play TAS';$('#status').textContent='STATE RESTORED · FRAME '+frame}catch(err){alert('Load State fehlgeschlagen: '+(err?.message||err))}};
$('#reset-rom').onclick=async()=>{
 if(!engine){alert('Bitte zuerst eine ROM laden.');return}
 stopTas();
 try{
  await engine.clearSram();
  engine.reset();
  movie.clear();frame=0;length=600;frameStates.clear();checkpoint=null;$('#load-state').disabled=true;
  $('#movie-length').value=String(length);
  frameStates.set(0,await engine.saveState());
  $('#status').textContent='FULL RESET · SRAM + TAS CLEARED';
 }catch(err){$('#status').textContent='RESET ERROR';console.error(err);alert('Reset fehlgeschlagen: '+(err&&err.message||err))}
 draw()
};
function editInputRange(clearOnly){const start=Math.max(0,Math.min(1000000,Math.floor(Number($('#range-start').value)||0)));const end=Math.max(0,Math.min(1000000,Math.floor(Number($('#range-end').value)||0)));const key=$('#range-key').value;if(end<start){$('#status').textContent='RANGE ERROR · END BEFORE START';return}for(let i=start;i<=end;i++){const set=new Set(movie.get(i)||[]);if(clearOnly)set.delete(key);else set.add(key);if(set.size)movie.set(i,set);else movie.delete(i)}if(!clearOnly)length=Math.max(length,end+1);$('#status').textContent=(clearOnly?'CLEARED ':'HOLD '+key+' · ')+start+'–'+end;draw()}$('#apply-range').onclick=()=>editInputRange(false);$('#clear-range').onclick=()=>editInputRange(true);$('#movie-length').onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)){e.target.value=length;return}length=Math.max(1,Math.min(1000000,Math.floor(value)));e.target.value=length;draw();$('#status').textContent='MOVIE LENGTH · '+length+' FRAMES'};$('#minus10').onclick=()=>step(-10);$('#minus').onclick=()=>step(-1);$('#plus').onclick=()=>step(1);$('#plus10').onclick=()=>step(10);$('#jump').onchange=e=>{frame=Math.max(0,+e.target.value||0);step(0)};$('#clear').onclick=()=>{movie.delete(frame);draw()};document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>setInput(b.dataset.key));$('#play').onclick=playTas;
$('#rom').onchange=async e=>{
 const f=e.target.files[0];if(!f||loadingRom)return;
 loadingRom=true;rom=f.name;
 if(engine){engine.destroy();engine=null}if(playTimer!==null){clearInterval(playTimer);playTimer=null}playing=false;frameStates.clear();checkpoint=null;$('#load-state').disabled=true;
 playing=false;$('#play').textContent='▶ Play';$('#status').textContent='LOADING SNES CORE…';$('#romname').textContent=rom;
 $('#screen').innerHTML='<div class="emulator-loading">Loading WebAssembly SNES core…<br><small>ROM remains on this device.</small></div>';
 try{
  const bytes=new Uint8Array(await f.arrayBuffer());
  const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','SNES game display');
  $('#screen').replaceChildren(canvas);
  engine=await loadSnes9x({canvasEl:canvas,assets:{rom:bytes},jsUrl:new URL('core/snes9x.js',window.location.href).href,wasmUrl:new URL('core/snes9x.wasm',window.location.href).href,options:{region:'auto',aspect:'4:3',renderFilter:'pixelated',gamepads:true,escMenu:false},persist:'opfs',storageNamespace:'snes-tas-browser'});
  engine.start();engine.pause();playing=false;frame=0;frameStates.clear();checkpoint=null;try{frameStates.set(0,await engine.saveState())}catch{}$('#play').textContent='▶ Play TAS';$('#status').textContent='SNES9X READY · PAUSED';
  $('#screen').classList.add('emulator-active');
  $('#screen').insertAdjacentHTML('beforeend',`<div class="rom-meta">${rom.replace(/[&<>"]/g,'')} · ${(bytes.byteLength/1048576).toFixed(2)} MB</div>`);
 }catch(err){
  engine=null;$('#status').textContent='EMULATOR ERROR';
  $('#screen').innerHTML='<b>Could not start SNES9x</b><p>Check that the file is a valid .sfc or .smc ROM and reload.</p><small>Details: '+String(err?.message||err).replace(/[&<>"]/g,'')+'</small>';
  console.error(err);
 }finally{loadingRom=false;e.target.value=''}
};
$('#export').onclick=()=>{let data={format:'SNES-TAS',formatVersion:1,system:'SNES',romName:rom,frameRate:60,length,inputs:[...movie].sort((a,b)=>a[0]-b[0]).map(([frame,buttons])=>({frame,buttons:[...buttons]}))};let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/vnd.snes-tas+json'}));a.download=(rom||'snes-movie').replace(/\.[^.]+$/,'')+'.snes-tas';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)};
async function readBk2InputLog(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u32=(p)=>view.getUint32(p,true),u16=(p)=>view.getUint16(p,true);
 let eocd=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(u32(p)===0x06054b50){eocd=p;break}}
 if(eocd<0)throw Error('ZIP-Ende nicht gefunden');
 const count=u16(eocd+10),cdOffset=u32(eocd+16);let p=cdOffset,entry=null;
 for(let i=0;i<count&&p+46<=bytes.length;i++){
  if(u32(p)!==0x02014b50)break;
  const method=u16(p+10),compressed=u32(p+20),nameLen=u16(p+28),extraLen=u16(p+30),commentLen=u16(p+32),local=u32(p+42);
  const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));
  if(name.toLowerCase().endsWith('input log.txt')){entry={method,compressed,local};break}
  p+=46+nameLen+extraLen+commentLen;
 }
 if(!entry)throw Error('Input Log.txt fehlt in der BK2-Datei');
 const nameLen=u16(entry.local+26),extraLen=u16(entry.local+28),start=entry.local+30+nameLen+extraLen;
 let data=bytes.slice(start,start+entry.compressed);
 if(entry.method===8){
  if(typeof DecompressionStream==='undefined')throw Error('Dieser Browser unterstützt die BK2-Dekomprimierung nicht.');
  data= new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
 }else if(entry.method!==0)throw Error('Nicht unterstützte ZIP-Kompression: '+entry.method);
 return new TextDecoder().decode(data);
}
function parseBk2InputLog(log){
 const lines=log.replace(/^\uFEFF/,'').split(/\r?\n/);
 const headerLine=lines.findIndex(line=>/^LogKey:/i.test(line.trim()));
 if(headerLine<0)throw Error('BizHawk-LogKey-Header nicht erkannt');
 const columns=lines[headerLine].trim().slice(lines[headerLine].indexOf(':')+1).split('|').map(x=>x.trim()).filter(Boolean);
 const aliases={'p1 up':'Up','p1 down':'Down','p1 left':'Left','p1 right':'Right','p1 a':'A','p1 b':'B','p1 x':'X','p1 y':'Y','p1 l':'L','p1 r':'R','p1 start':'Start','p1 select':'Select'};
 const map=[];
 columns.forEach((name,index)=>{const key=aliases[name.toLowerCase().replace(/^#/,'')];if(key)map.push({index:index-2,key,expected:name.split(/\s+/).pop().toUpperCase()})});
 if(!map.length)throw Error('Keine unterstützten P1-SNES-Tasten im BK2-Log gefunden');
 const inputs=[];let frame=0;
 for(const line of lines.slice(headerLine+1)){
  if(!line.startsWith('|'))continue;
  const cells=line.replace(/^\|/,'').replace(/\|$/,'').split('|');
  if(cells.length<2)continue;
  const buttonsField=cells[cells.length-1]||'';
  const buttons=[];
  for(const m of map){const ch=(buttonsField[m.index]||'.').toUpperCase();if(ch!=='.'&&ch!==' '&&ch!=='0')buttons.push(m.key)}
  if(buttons.length)inputs.push({frame,buttons});
  frame++;
 }
 if(frame===0)throw Error('Keine Frame-Daten im BK2-Log gefunden');
 return {format:'SNES-TAS',length:frame,romName:'',inputs};
}
$('#import').onchange=async e=>{
 const file=e.target.files&&e.target.files[0];if(!file)return;
 try{
  let d;
  if(file.name.toLowerCase().endsWith('.bk2'))d=parseBk2InputLog(await readBk2InputLog(file));
  else d=JSON.parse(await file.text());
  if(!(['SNES-TAS','SNES-TAS-JSON'].includes(d.format))||!Array.isArray(d.inputs))throw Error('Ungültiges TAS-JSON');
  movie.clear();d.inputs.forEach(r=>{if(Number.isInteger(r.frame)&&r.frame>=0)movie.set(r.frame,new Set((r.buttons||[]).filter(k=>keys.includes(k))))});
  length=Math.max(1,Number(d.length)||600);rom=d.romName||'';frame=0;draw();$('#romname').textContent=rom||'Not loaded';
 }catch(err){alert('Movie-Import fehlgeschlagen: '+(err&&err.message?err.message:'Ungültige Datei'))}
 e.target.value='';
};draw();
