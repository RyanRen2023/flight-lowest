#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, scopeHash, summarize, csvCell } from './lib/core.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2), command=args[0] || 'help';
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const configFile=path.resolve(option('--config',path.join(root,'config.json')));
const c=JSON.parse(await fs.readFile(configFile,'utf8'));
const jobs=plan(c), runDir=path.resolve(option('--data',path.join(root,'data',scopeHash(c))));
await fs.mkdir(runDir,{recursive:true});
const historyFile=path.join(runDir,'history.jsonl');
async function readRecords() {
  let raw; try {raw=await fs.readFile(historyFile,'utf8');} catch(e) {if(e.code==='ENOENT')return [];throw e;}
  const lines=raw.split('\n'), records=[];
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim())continue;
    try {records.push(JSON.parse(lines[i]));} catch {throw new Error(`History line ${i+1} is invalid JSON. Preserve and repair the original file; it will not be overwritten.`);}
  }
  return records;
}
async function atomic(file,text) {await fs.writeFile(`${file}.tmp`,text);await fs.rename(`${file}.tmp`,file);}
async function report(records) {
  const s=summarize(jobs,records,c);
  const rows=jobs.map(j=>({...j,...s.latest.get(j.id)}));
  const columns=['departure','returning','stayDays','status','priceCNY','checkedAt','message','departureText','returnText','url','evidence'];
  await atomic(path.join(runDir,'results.csv'),'\ufeff'+[columns.map(csvCell).join(','),...rows.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\n'));
  const publicSummary={...s,latest:undefined,config:c,generatedAt:new Date().toISOString()};
  await atomic(path.join(runDir,'summary.json'),JSON.stringify(publicSummary,null,2));
  const title=s.complete?'All date pairs checked: lowest displayed fare in this run':'Search incomplete: lowest verified displayed fare so far';
  let md=`# ${title}\n\nDate range: ${c.startDate} to ${c.endDate}; stay: ${c.minStayDays}–${c.maxStayDays} days; 1 adult; round-trip fares in CNY, including taxes.\n\n`;
  md+=`Verified within the ${c.freshHours}-hour freshness window: ${s.confirmed}/${s.total}; pending, failed, or expired: ${s.pending}.\n\n`;
  md+='The return date is the departure date from Beijing; arrival in Ottawa may be later. Fares were displayed at different query times and are not locked. Baggage and change/refund conditions have not been verified.\n\n';
  md+='| Departure | Return | Stay days | Round-trip CNY incl. taxes | Checked at (UTC) |\n|---|---|---:|---:|---|\n';
  for(const r of s.ranked.slice(0,20))md+=`| ${r.departure} | ${r.returning} | ${r.stayDays} | ${r.priceCNY} | ${r.checkedAt} |\n`;
  if(s.best) md+=`\nLowest-fare details\n\n[Ctrip search link](${s.best.url})\n\nOutbound:\n\n${s.best.departureText}\n\nReturn:\n\n${s.best.returnText}\n`;
  await atomic(path.join(runDir,'report.md'),md);
  console.log(`${title}; verified ${s.confirmed}/${s.total}${s.best?`; CNY ${s.best.priceCNY}, ${s.best.departure} → ${s.best.returning}`:''}\nReport: ${path.join(runDir,'report.md')}`);
  return s;
}

if(command==='plan') {
  await atomic(path.join(runDir,'plan.json'),JSON.stringify({config:c,jobs},null,2));
  console.log(`${jobs.length} date pairs (fully enumerated, not sampled); output directory: ${runDir}`);
} else if(command==='report') {
  await report(await readRecords());
} else if(command==='search') {
  const limit=Number(option('--limit','Infinity'));
  if(!(limit>0 && (Number.isInteger(limit)||limit===Infinity)))throw new Error('--limit must be a positive integer');
  // Exclusive lock prevents two collectors overwriting reports or corrupting history.
  const lockFile=path.join(runDir,'search.lock');
  let lock;
  try {lock=await fs.open(lockFile,'wx');} catch(e) {if(e.code==='EEXIST')throw new Error(`A search is running, or a previous run exited unexpectedly. After confirming no collector is running, remove ${lockFile}`);throw e;}
  let context;
  let records=[];
  try {
    records=await readRecords();
    let chromium;
    try {({chromium}=await import('playwright'));} catch {throw new Error('Dependencies are missing. Run npm ci in the program directory.');}
    const {queryCtrip}=await import('./lib/ctrip.mjs');
    await fs.mkdir(path.join(runDir,'evidence'),{recursive:true});
    try {
      context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{headless:false,chromiumSandbox:true,locale:'zh-CN',...(c.browserChannel==='chrome'?{channel:'chrome'}:{})});
    } catch(e) {
      await fs.writeFile(path.join(runDir,'browser-error.log'),String(e));
      throw new Error('The browser could not start. If running in a restricted Codex environment, run npm run search in your local terminal instead. No fares were collected. Details are in browser-error.log.');
    }
    const page=context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(10000);
    const summary=summarize(jobs,records,c);
    const done=new Set(summary.ranked.map(r=>r.id));
    let count=0;
    for(const job of jobs) {
      if(done.has(job.id))continue;
      if(count>=limit)break;
      count++;
      console.log(`[${count}] ${job.departure} → ${job.returning}, ${job.stayDays} days`);
      const evidencePath=path.join(runDir,'evidence',`${job.id}-${Date.now()}.png`);
      let result;
      try {result=await queryCtrip(page,job,c,evidencePath);} catch(e) {
        result={status:e.status||'error',message:e.message};
        try {await page.screenshot({path:evidencePath,fullPage:true});result.evidence=evidencePath;} catch {}
      }
      const record={...job,...result,source:'ctrip',currency:'CNY',checkedAt:new Date().toISOString()};
      await fs.appendFile(historyFile,JSON.stringify(record)+'\n');
      records.push(record);
      await report(records);
      if(result.status==='blocked') {
        console.log('Progress saved. Complete the verification yourself in the open browser, then press Enter here to exit. Run npm run search again to resume.');
        if(process.stdin.isTTY) {
          const {createInterface}=await import('node:readline/promises');
          const rl=createInterface({input:process.stdin,output:process.stdout});
          try {await rl.question('Press Enter after completing verification: ');} finally {rl.close();}
        }
        break;
      }
      if(count<limit)await new Promise(r=>setTimeout(r,c.requestGapSeconds*1000));
    }
  } finally {
    try {await context?.close();} finally {await lock.close();await fs.unlink(lockFile);}
    await report(records);
  }
} else {
  console.log('npm run plan      Enumerate all date pairs\nnpm run search    Search sequentially in a visible browser; resume saved progress\nnpm run search -- --limit 1   Verify one date pair first\nnpm run report    Regenerate fare rankings\nOptions: --config FILE --data DIRECTORY');
}
