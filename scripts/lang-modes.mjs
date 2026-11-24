// Her real lines through Sarvam STT in every mode (forced Hindi, auto-detect, codemix, verbatim, forced English),
// to see which one tells her language. Paid, small. -> logs/lang-switch/modes.json, read by `lang-switch.ts rule`.
//   node scripts/lang-modes.mjs
import fs from 'node:fs'
for (const f of ['.env','../.env']) if (fs.existsSync(f)) for (const l of fs.readFileSync(f,'utf8').split('\n')) { const m=/^\s*([A-Z_0-9]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]]=m[2] }
const ears=JSON.parse(fs.readFileSync('logs/lang-probe/ears.json','utf8'))
const items=ears.map(r=>({id:r.session.slice(9,15)+'/'+r.file.slice(0,2),file:`logs/calls/${r.session}/${r.file}`,hi:r.hi.text,auto:r.auto}))
for (const s of ['20261124-075753-zee1cp','20261124-075716-w325nc','20261119-124927-k56a6t','20261119-124849-9fmjpq']) for (const f of fs.readdirSync(`logs/calls/${s}`).filter(f=>f.endsWith('_her.wav')).sort()) items.push({id:s.slice(9,15)+'/'+f.slice(0,2),file:`logs/calls/${s}/${f}`})
const stt=async(file,code,mode)=>{const form=new FormData();form.append('file',new Blob([fs.readFileSync(file)],{type:'audio/wav'}),'her.wav');form.append('model','saaras:v4');form.append('mode',mode);form.append('language_code',code);
 const r=await fetch('https://api.sarvam.ai/speech-to-text',{method:'POST',headers:{'api-subscription-key':process.env.SARVAM_API_KEY},body:form});if(!r.ok)return{text:'ERR '+r.status+' '+(await r.text()).slice(0,80)};const j=await r.json();return{text:(j.transcript||'').trim(),lang:j.language_code,p:j.language_probability}}
const out=[];let i=0
await Promise.all(Array.from({length:4},async()=>{while(i<items.length){const it=items[i++];if(!fs.existsSync(it.file)){continue}
 const [hi,auto,cm,vb,en]=await Promise.all([it.hi?{text:it.hi}:stt(it.file,'hi-IN','transcribe'),it.auto??stt(it.file,'unknown','transcribe'),stt(it.file,'hi-IN','codemix'),stt(it.file,'hi-IN','verbatim'),stt(it.file,'en-IN','transcribe')])
 out.push({id:it.id,hi:hi.text,auto,codemix:cm.text,verbatim:vb.text,en:en.text})}}))
out.sort((a,b)=>a.id<b.id?-1:1)
fs.mkdirSync('logs/lang-switch',{recursive:true});fs.writeFileSync('logs/lang-switch/modes.json',JSON.stringify(out,null,1))
for(const o of out)console.log(`${o.id} | HI ${o.hi} | AUTO(${o.auto.lang} ${o.auto.p}) ${o.auto.text} | CODEMIX ${o.codemix} | VERBATIM ${o.verbatim} | EN ${o.en}`)
