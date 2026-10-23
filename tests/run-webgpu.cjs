/* No dependencies. Starts a local server and a temporary headless Chromium.
 * Usage: node tests/run-webgpu.cjs [path-to-chrome-or-edge] [test-page]
 */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const testPage=process.argv[3] || 'tests/webgpu-pt.html';
const browser=process.argv[2] || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
if(!browser)throw new Error('Pass a Chromium executable path.');
const server=http.createServer((req,res)=>{
  const filename=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wgsl':'text/plain','.wasm':'application/wasm'}[path.extname(filename)] || 'application/octet-stream';
  fs.readFile(filename,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':mime});res.end(e?'not found':data);});
});
let proc,ws,dir;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'powder6-webgpu-'));
  const flags=['--headless=new','--enable-unsafe-webgpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'];
  if(process.env.POWDER6_SOFTWARE_GPU)flags.push('--use-angle=swiftshader','--use-vulkan=swiftshader');
  proc=spawn(browser,flags,{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{let stderr='';const timer=setTimeout(()=>reject(new Error('Browser startup timed out')),20000);proc.on('error',reject);proc.stderr.on('data',b=>{stderr+=b;const m=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  ws=new WebSocket(endpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let serial=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}};
  function send(method,params,sessionId){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser protocol timed out: '+method));},30000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params,sessionId}));});}
  const target=await send('Target.createTarget',{url:'http://127.0.0.1:'+server.address().port+'/'+testPage});
  const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const deadline=Date.now()+240000;let lastProgress='';
  while(Date.now()<deadline){
    const status=await send('Runtime.evaluate',{expression:'document.getElementById("results")?.textContent || document.body?.innerText || "loading"',returnByValue:true},sessionId);
    if(status.result.value!==lastProgress){lastProgress=status.result.value;try{const rows=JSON.parse(lastProgress);console.log(rows.length+' checks: '+rows[rows.length-1].name);}catch{console.log(lastProgress);}}
    const r=await send('Runtime.evaluate',{expression:'window.browserTestResult || window.gpuTestResult || null',returnByValue:true},sessionId);
    if(r.result.value){console.log(JSON.stringify(r.result.value,null,2));if(!r.result.value.ok)process.exitCode=1;if(process.env.POWDER6_SCREENSHOT){await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);await send('Runtime.evaluate',{expression:'document.getElementById("results").style.display="none";Object.assign(document.getElementById("app").style,{position:"fixed",inset:"0",width:"100vw",height:"100vh"})'},sessionId);await new Promise(resolve=>setTimeout(resolve,300));const capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);fs.writeFileSync(process.env.POWDER6_SCREENSHOT,Buffer.from(capture.data,'base64'));}return;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  const state=await send('Runtime.evaluate',{expression:'document.getElementById("results").textContent',returnByValue:true},sessionId);
  throw new Error('GPU checks timed out: '+state.result.value);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{
  if(ws)ws.close();if(proc)proc.kill();server.close();
  // Browser profile lives in the OS temp directory; leave locked files to OS cleanup.
});
