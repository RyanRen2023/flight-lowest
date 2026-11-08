import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,fare,summarize,scopeHash,csvCell,dateNumber} from '../lib/core.mjs';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(new URL('../config.json',import.meta.url),'utf8'));

test('enumerates the complete 28–42 day range without duplicates or out-of-range returns',()=>{
  const jobs=plan(config);
  assert.equal(jobs.length,255);
  assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length);
  for(const j of jobs) {
    assert.ok(j.departure>=config.startDate && j.returning<=config.endDate);
    assert.equal((dateNumber(j.returning)-dateNumber(j.departure))/86400000,j.stayDays);
    assert.ok(j.stayDays>=28 && j.stayDays<=42);
    assert.equal(new URL(j.url).searchParams.get('adult'),'1');
  }
  assert.ok(jobs.some(j=>j.id==='2027-04-20_2027-06-01'));
  assert.ok(jobs.some(j=>j.id==='2027-05-04_2027-06-01'));
});
test('validates dates and boundaries including leap dates',()=>{
  assert.throws(()=>dateNumber('2027-02-29'));
  assert.ok(dateNumber('2028-02-29'));
  assert.throws(()=>plan({...config,endDate:'2027-04-01'}));
  assert.equal(plan({...config,startDate:'2027-05-05'}).length,0);
  assert.throws(()=>plan({...config,minStayDays:42,maxStayDays:28}));
});
test('accepts explicit roundtrip tax-inclusive fares but rejects calendar and one-way prices',()=>{
  assert.equal(fare('大韩航空\n¥\n7,436\n起\n往返含税价\n订票'),7436);
  assert.equal(fare('￥9100往返含税价'),9100);
  assert.equal(fare('¥4368起\n含税价'),null);
  assert.equal(fare('04/20去 06/01返 ¥7436 低'),null);
  assert.equal(fare('CAD 1500 往返含税价'),null);
});
test('only current confirmed results count as coverage; failures and stale fares never prove a minimum',()=>{
  const jobs=plan(config).slice(0,3), now=Date.now();
  const rec=(j,price,offset=0)=>({...j,status:'confirmed',priceCNY:price,checkedAt:new Date(now-offset).toISOString()});
  const records=[rec(jobs[0],9100),rec(jobs[1],7436),rec(jobs[2],6000,13*3600000)];
  let s=summarize(jobs,records,config,now);
  assert.equal(s.complete,false); assert.equal(s.confirmed,2); assert.equal(s.best.priceCNY,7436);
  s=summarize(jobs,[...records,rec(jobs[2],7500)],config,now);
  assert.equal(s.complete,true);
  s=summarize(jobs,[...records,{...jobs[1],status:'blocked',checkedAt:new Date(now).toISOString()}],config,now);
  assert.equal(s.best.priceCNY,9100); assert.equal(s.complete,false);
  assert.equal(summarize([],[],config,now).complete,false);
});
test('scope hash changes for passenger criteria but not pacing; CSV protects Excel formula cells',()=>{
  assert.notEqual(scopeHash(config),scopeHash({...config,minStayDays:29}));
  assert.equal(scopeHash(config),scopeHash({...config,requestGapSeconds:40}));
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
