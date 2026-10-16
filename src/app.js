import './style.css';
import { load as loadSnes9x } from './vendor/snes9x/snes9x.sdk.ts';
const $=s=>document.querySelector(s);let frame=0,rom='',length=600,playing=false,engine=null,loadingRom=false,checkpoint=null,playTimer=null;const frameStates=new Map();const movie=new Map(),pressedKeys=new Set();let recordingInputs=false,mediaRecorder=null,mediaChunks=[],videoStream=null;const keys=['Up','Down','Left','Right','B','A','Y','X','L','R','Select','Start'];
$('#app').innerHTML=`<header><div class="brand"><b>S</b><div><strong>SNES TAS BROWSER</strong><small>FRAME-PERFECT WORKBENCH · PROTOTYPE</small></div></div><button id="export" class="primary">Export .snes-tas</button></header><main><section class="hero"><div><small>SUPER NINTENDO · TOOL-ASSISTED SPEEDRUNNING</small><h1>Every frame.<br><em>Under your control.</em></h1><p>Load your own ROM, map inputs frame by frame, and save your movie project.</p></div><label class="btn">＋ Load ROM<input id="rom" type="file" accept=".sfc,.smc,.fig,.swc"></label></section><div class="notice"><b>SNES9x core loaded. Timeline editing and save states are available; deterministic one-frame execution and RAM reads require a deeper core adapter.</div><section class="grid"><article class="panel"><h3>01 / GAME VIEW <span id="status">NO ROM LOADED</span></h3><div id="screen"><b>SNES<span>TAS</span></b><p>Select a ROM to begin</p><small>YOUR ROM STAYS ON THIS DEVICE</small></div><nav><button id="minus10">↞ 10</button><button id="minus">◂ 1</button><button id="play" class="primary">▶ Play TAS</button><button id="plus">1 ▸</button><button id="plus10">10 ↠</button><button id="reset-rom">↻ ROM Reset</button><button id="record-input">● Record Inputs</button><button id="save-state">Save state</button><button id="load-state" disabled>Load state</button></nav><div class="readout">CURRENT FRAME <strong id="frame">000000</strong><label>Jump <input id="jump" type="number" min="0" value="0"></label></div></article><article class="panel"><h3>02 / INPUT EDITOR <span>MOVIE DATA</span></h3><div class="toolbar"><div><b>Input timeline</b><small>Pick a frame, then toggle buttons</small></div><button id="clear">Clear frame</button></div><div id="timeline"></div><div class="controller"><div class="dpad"><button data-key="Up">↑</button><div><button data-key="Left">←</button><button data-key="Down">↓</button><button data-key="Right">→</button></div></div><div class="face"><button data-key="X">X</button><button data-key="Y">Y</button><button data-key="A">A</button><button data-key="B">B</button></div><div class="shoulders"><button data-key="L">L</button><button data-key="R">R</button><button data-key="Select">SELECT</button><button data-key="Start">START</button></div></div></article></section><section class="grid lower"><article class="panel"><h3>03 / MEMORY WATCH <span>READ API NOT EXPOSED</span></h3><p class="muted">The emulator is running, but this core wrapper does not yet expose WRAM reads to the UI.</p>${['7E:0000','7E:0002','7E:0004'].map(a=>`<div class="mem"><code>${a}</code><b>—</b><small>WRAM · 24-bit bus address</small></div>`).join('')}</article><article class="panel"><h3>04 / PROJECT <span>LOCAL FILES</span></h3><div class="line"><span>ROM</span><b id="romname">Not loaded</b></div><div class="line"><span>Movie length</span><label class="length-control"><input id="movie-length" type="number" min="1" max="1000000" step="1" value="600" inputmode="numeric" aria-label="Movie length in frames"><span>frames</span></label></div><small class="muted">Playback stops automatically at this frame count. 60 frames ≈ 1 second.</small><div class="line"><span>Format</span><b>SNES-TAS JSON v1</b></div><div class="actions"><label class="btn">Import TAS<input id="import" type="file" accept=".snes-tas,.json,application/json"></label><button id="video-record" class="primary">● Record Video</button><button id="video-stop" disabled>■ Stop & Export</button><small id="video-status" class="muted">MP4 if supported by browser; otherwise WebM.</small></div></article></section><footer>SNES TAS BROWSER <span>Bring your own ROM · Local only · Starter build</span></footer></main>`;
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
function playTas(){if(!engine){alert('Bitte zuerst eine gültige SNES-ROM laden.');return}if(playing){stopTas();$('#status').textContent='EMULATOR PAUSED';return}playing=true;$('#play').textContent='Ⅱ Pause';$('#status').textContent='TAS PLAYBACK';if(mediaRecorder&&mediaRecorder.state==='recording'){void engine.resumeAudioForCapture()}else engine.pause();playTimer=setInterval(()=>{if(!engine||!playing){stopTas();return}if(frame>=length){stopTas();$('#status').textContent='MOVIE END';if(mediaRecorder&&mediaRecorder.state!=='inactive')stopVideoCapture();return}try{const buttons=recordingInputs?[...pressedKeys]:[...(movie.get(frame)||new Set())];engine.setTasInput(buttons);engine.stepFrame();const track=videoStream?.getVideoTracks?.()[0];if(track&&typeof track.requestFrame==='function')track.requestFrame();if(recordingInputs){if(buttons.length)movie.set(frame,new Set(buttons));else movie.delete(frame);length=Math.max(length,frame+1)}frame++;draw()}catch(err){stopTas();$('#status').textContent='TAS ERROR';console.error(err)}},16);}
$('#save-state').onclick=async()=>{if(!engine){alert('Bitte zuerst eine ROM laden.');return}try{checkpoint=await engine.saveState();frameStates.set(frame,checkpoint);$('#load-state').disabled=false;$('#status').textContent='STATE SAVED · FRAME '+frame}catch(err){alert('Save State fehlgeschlagen: '+(err?.message||err))}};
$('#load-state').onclick=async()=>{if(!engine||!checkpoint)return;try{engine.pause();playing=false;await engine.loadState(checkpoint);$('#play').textContent='▶ Play TAS';$('#status').textContent='STATE RESTORED · FRAME '+frame}catch(err){alert('Load State fehlgeschlagen: '+(err?.message||err))}};
$('#reset-rom').onclick=async()=>{
 if(!engine){alert('Bitte zuerst eine ROM laden.');return}
 stopTas();engine.reset();frame=0;length=Math.max(length,1);frameStates.clear();checkpoint=null;$('#load-state').disabled=true;
 try{frameStates.set(0,await engine.saveState());$('#status').textContent='ROM RESET · FRAME 0'}catch(err){$('#status').textContent='RESET · NO CHECKPOINT';console.error(err)}
 draw()
};
$('#movie-length').onchange=e=>{const value=Number(e.target.value);if(!Number.isFinite(value)){e.target.value=length;return}length=Math.max(1,Math.min(1000000,Math.floor(value)));e.target.value=length;draw();$('#status').textContent='MOVIE LENGTH · '+length+' FRAMES'};$('#minus10').onclick=()=>step(-10);$('#minus').onclick=()=>step(-1);$('#plus').onclick=()=>step(1);$('#plus10').onclick=()=>step(10);$('#jump').onchange=e=>{frame=Math.max(0,+e.target.value||0);step(0)};$('#clear').onclick=()=>{movie.delete(frame);draw()};document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>setInput(b.dataset.key));$('#play').onclick=playTas;
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
$('#import').onchange=async e=>{try{let d=JSON.parse(await e.target.files[0].text());if(!(['SNES-TAS','SNES-TAS-JSON'].includes(d.format))||!Array.isArray(d.inputs))throw 0;movie.clear();d.inputs.forEach(r=>movie.set(r.frame,new Set(r.buttons)));length=d.length||600;rom=d.romName||'';frame=0;draw();$('#romname').textContent=rom||'Not loaded'}catch{alert('Ungültige Movie-Datei')}};draw();
