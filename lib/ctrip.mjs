import { fare } from './core.mjs';

export class QueryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Read only visible flight cards; calendar prices are never included.
export async function cards(page, phase) {
  const raw = await page.locator('body').evaluate((body, phase) => {
    const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const labels = [...body.querySelectorAll('*')].filter(el => visible(el) && el.textContent.trim() === '往返含税价' && ![...el.children].some(ch => ch.textContent.trim() === '往返含税价'));
    const result = [], seen = new Set();
    for (const label of labels) {
      let el = label;
      for (let depth=0; el && depth<14; depth++, el=el.parentElement) {
        const text = el.innerText || '';
        const action = phase === 'departure' ? '选为去程' : '订票';
        if (text.includes(action) && /[¥￥]/.test(text) && text.includes('航班详情')) {
          // A container containing several fares is not an individual card.
          if ((text.match(/往返含税价/g) || []).length !== 1) break;
          if (!seen.has(text)) { seen.add(text); result.push({text}); }
          break;
        }
      }
    }
    return result;
  }, phase);
  return raw.map((r,index) => ({...r,index,price:fare(r.text)})).filter(r => r.price !== null);
}

async function visibleText(page) {
  const pieces = [];
  for (const frame of page.frames()) {
    try { pieces.push(await frame.locator('body').innerText({timeout:1500})); } catch {}
  }
  return pieces.join('\n');
}
async function waitCards(page, phase, timeoutSeconds) {
  const start=Date.now(); let previous='', stableAt=Date.now();
  while (Date.now()-start < timeoutSeconds*1000) {
    const text = await visibleText(page);
    if (/安全验证|请完成验证|请点击上图|拖动滑块|人机验证|访问过于频繁/.test(text)) throw new QueryError('blocked','The site requires manual verification or has restricted access. The collector has paused; it does not bypass verification.');
    if (/当前访问人数较多|系统繁忙|网络异常/.test(text)) throw new QueryError('error','The site is busy or a network error occurred');
    const current = await cards(page,phase);
    const signature = JSON.stringify(current);
    if (signature!==previous) { previous=signature; stableAt=Date.now(); }
    if (current.length && Date.now()-stableAt>=5000 && Date.now()-start>=7000) return current;
    // Treat negative pages as unresolved; they can also be access failures.
    if (!current.length && Date.now()-start>15000 && /未找到符合条件|查询无结果|暂无航班/.test(text)) throw new QueryError('unresolved','The page returned no flights. This does not establish that no tickets are available for these dates.');
    await sleep(1000);
  }
  throw new QueryError('error',`The ${phase} flight list timed out or the page structure has changed`);
}
async function verifyDates(page,job) {
  const dates=await page.getByRole('textbox',{name:'请选择日期',exact:true}).all();
  if(dates.length!==2 || await dates[0].inputValue()!==job.departure || await dates[1].inputValue()!==job.returning) throw new QueryError('error','The displayed dates do not match the requested dates');
  const passenger = await visibleText(page);
  if (!/1\s*成人/.test(passenger)) throw new QueryError('error','Could not verify the 1-adult passenger requirement');
}
export async function queryCtrip(page,job,c,evidencePath) {
  await page.goto(job.url,{waitUntil:'domcontentloaded',timeout:c.pageTimeoutSeconds*1000});
  await waitCards(page,'departure',c.pageTimeoutSeconds);
  await verifyDates(page,job);
  await page.getByText('低价优先',{exact:true}).click();
  const outbound=await waitCards(page,'departure',c.pageTimeoutSeconds);
  const best=[...outbound].sort((a,b)=>a.price-b.price)[0];
  const actions=page.getByText('选为去程',{exact:true});
  if(await actions.count()!==outbound.length) throw new QueryError('error','Outbound action and fare counts do not match; stopped to avoid selecting the wrong flight');
  await actions.nth(best.index).click();
  let inbound=await waitCards(page,'return',c.pageTimeoutSeconds);
  await verifyDates(page,job);
  await page.getByText('低价优先',{exact:true}).click();
  inbound=await waitCards(page,'return',c.pageTimeoutSeconds);
  const selected=[...inbound].sort((a,b)=>a.price-b.price)[0];
  // A changed return total means the departure-stage bound was not reliable.
  // Do not certify this pair as fully searched: another outbound could now be cheaper.
  if (selected.price !== best.price) throw new QueryError('unresolved',`The outbound displayed minimum ${best.price} differs from the return-stage total ${selected.price}; a fresh query is required`);
  await page.screenshot({path:evidencePath,fullPage:true});
  return {status:'confirmed',priceCNY:selected.price,departureText:best.text,returnText:selected.text,evidence:evidencePath,displayedOfferCount:outbound.length};
}
