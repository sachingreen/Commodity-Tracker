import fs from "node:fs"; import path from "node:path"; import { JSDOM } from "jsdom";
const ROOT="/home/claude/assay", DIST=path.join(ROOT,"dist"), BASE="/Commodity-Tracker/";
const html=fs.readFileSync(path.join(DIST,"index.html"),"utf8");
const serve=(u)=>{const rel=u.replace(/^https?:\/\/[^/]+/,"").replace(BASE,"");
  for(const d of ["/tmp/mkt",DIST]){const p=path.join(d,rel);
    if(fs.existsSync(p)&&fs.statSync(p).isFile())return fs.readFileSync(p,"utf8");} return null;};
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,
  url:`https://x.github.io${BASE}`,beforeParse(w){
    w.fetch=async(u)=>{const b=serve(String(u));return b==null?{ok:false,status:404,json:async()=>({})}
      :{ok:true,status:200,json:async()=>JSON.parse(b)};};}});
const bundle=fs.readdirSync(path.join(DIST,"assets")).find(f=>f.endsWith(".js"));
dom.window.eval(fs.readFileSync(path.join(DIST,"assets",bundle),"utf8"));
await new Promise(r=>setTimeout(r,500));
const d=dom.window.document, txt=d.body.textContent;
const cards=[...d.querySelectorAll(".cards .card")].map(c=>c.querySelector(".k")?.textContent);
console.log("strip present:", /World markets/.test(txt));
console.log("summary line:", d.querySelector(".stacklabel em")?.textContent);
console.log("label:", d.querySelector(".stacklabel span")?.textContent);
console.log("country cards:", cards.filter(c=>["India","United States","Japan"].includes(c)));
console.log("Markets chip:", [...d.querySelectorAll(".chip-btn")].some(b=>b.textContent==="Markets"));
