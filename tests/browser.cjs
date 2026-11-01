const {chromium}=require('playwright');
const {spawn}=require('child_process');
const fs=require('fs');
const assert=require('node:assert/strict');
(async()=>{
 const dir='data/browser-test-'+Date.now();fs.mkdirSync(dir,{recursive:true});
 const server=spawn('python',['-c',`import server; from pathlib import Path; server.DB=Path('${dir}/test.sqlite3'); server.init(); server.ThreadingHTTPServer(('127.0.0.1',8001),server.Handler).serve_forever()`],{stdio:'pipe'});
 let browser;
 try{
  for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:8001/');break}catch{await new Promise(r=>setTimeout(r,100))}}
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8001/');
  await page.locator('[name=login]').fill('browser-test');await page.locator('[name=password]').fill('browser-password-123');await page.locator('#register').click();
  await page.locator('#dashboard').waitFor({state:'visible'});
  await page.locator('.monthnav .picker-trigger').click(); await page.locator('.picker[open] [data-value="2026-11"]').click();
  await page.locator('#budget').fill('30000');await page.locator('#budgetform button').click();
  await page.waitForFunction(()=>document.querySelector('#total').textContent.includes('30'));
  await page.locator('[data-week="1"]').click();await page.locator('[name=amount]').fill('459.90');await page.locator('[name=note]').fill('Продукты <тест>');await page.locator('[data-category="0"]').click();await page.locator('#expenseform label').filter({has:page.locator('[name=date]')}).locator('.picker-trigger').click(); await page.locator('.picker[open] [data-value="2026-11-03"]').click(); await page.locator('#expenseform button.primary').click();
  await page.locator('#weekexpenses .entry').waitFor();assert.match(await page.locator('#weekexpenses').textContent(),/Продукты <тест>/);
  await page.locator('#dismiss').click();await page.reload();await page.locator('#dashboard').waitFor({state:'visible'});
  assert.equal(await page.locator('#history .entry').count(),1);
  assert.equal(await page.locator('img').evaluateAll(els=>els.every(i=>i.complete&&i.naturalWidth>0)),true);
  await page.screenshot({path:dir+'/desktop.png',fullPage:true});
  for(const width of [390,360,320]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'dashboard overflow '+width);
   await page.locator('[data-week="1"]').click();
   assert.equal(await page.locator('#weekdialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'dialog overflow '+width);
   await page.locator('#expenseform label').filter({has:page.locator('[name=date]')}).locator('.picker-trigger').click();
   assert.equal(await page.locator('.picker[open]').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'calendar overflow '+width);
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#weekdialog').evaluate(el=>el.open),true,'Escape should close only date picker');
   assert.equal(await page.locator('#weekdialog').evaluate(el=>getComputedStyle(el).scrollbarWidth), 'none');
   await page.screenshot({path:dir+'/mobile-'+width+'.png',fullPage:true});await page.locator('#dismiss').click();
  }
  await page.locator('.history .select-trigger').click();
  await page.locator('.picker[open] [data-option="2"]').click();
  assert.equal(await page.locator('#history .entry').count(),1);
  const before=(await page.evaluate(()=>fetch('/api/state').then(r=>r.json()))).state.months['2026-11'];
  await page.locator('[data-week="1"]').click();
  await page.locator('#closeform').locator('..').locator('summary').click();
  await page.locator('#closeform .picker-trigger').click();
  assert.equal(await page.locator('.picker[open] [data-option]').count(),3);
  await page.locator('.picker[open] [data-option="0"]').click();
  await page.locator('#closeform>button').click();
  await page.waitForFunction(()=>document.querySelector('#weekeditable').hidden);
  const after=(await page.evaluate(()=>fetch('/api/state').then(r=>r.json()))).state.months['2026-11'];
  assert.equal(after.weeks[2].limit,before.weeks[2].limit+before.weeks[1].limit-45990);
  assert.deepEqual(after.weeks.slice(3),before.weeks.slice(3));
  assert.deepEqual(errors,[]);console.log('Browser checks passed: auth, expense, reload, icons, desktop, mobile 390/360/320, next-week closure. Screenshots: '+dir);
 }finally{if(browser)await browser.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
