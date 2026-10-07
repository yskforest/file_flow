'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const JSZip = require('jszip');
const YAML = require('yaml');
async function main() {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('file:///app/index.html');
        const suite = await page.evaluate(async () => {
            await new Promise((ok,bad) => { const s=document.createElement('script');s.src='test/test_runner.js';s.onload=ok;s.onerror=bad;document.body.append(s); });
            const failures=[];
            const result=await TestRunner.run(null,(name,pass,e)=>{ if(!pass) failures.push(name+': '+e.message); });
            return { ...result, failures };
        });
        assert.equal(suite.failed,0,JSON.stringify(suite.failures));
        await page.click('#settings-btn');
        await page.fill('#llm-max-part-size','7');
        await page.locator('#llm-max-part-size').dispatchEvent('change');
        await page.fill('#llm-max-part-size','9');
        await page.locator('#llm-max-part-size').dispatchEvent('change');
        await page.reload();
        assert.equal(await page.inputValue('#llm-max-part-size'),'9');
        const result = await page.evaluate(async () => {
            const FF=FileFlow;
            const file=(name,text,delay=0)=>({name,fullPath:'/root/'+name,isFile:true,isDirectory:false,file(ok){setTimeout(()=>ok(new File([text],name,{lastModified:123})),delay);}});
            const files=[file('a.js','a'),file('b.txt','b')];
            const root={name:'root',fullPath:'/root',isDirectory:true,isFile:false,createReader(){let done=false;return {readEntries(ok){ok(done?[]:(done=true,files));}};}};
            FF.state.appSettings.viewMode='tree'; FF.state.currentRootEntries=[root]; FF.state.searchQuery='*.js';
            await FF.ui.Render.renderFileList();
            await FF.views.Tree.toggleFolder(document.querySelector('.folder-toggle'));
            const hidden=document.querySelectorAll('.filtered-out').length;
            FF.state.searchQuery=''; FF.state.resetMetadata();
            await FF.actions.ActionManager.resolve('md').execute(files[0]);
            FF.state.appSettings.showFullPath=true;FF.state.appSettings.viewMode='list';
            await FF.ui.Render.renderFileList();
            const rows=FF.views.List.getCurrentData();
            const csv=FF.views.List.buildCsvText();
            FF.state.currentRootEntries=[file('slow.js','s',100)];
            const pending=FF.ui.Render.renderFileList();
            document.getElementById('clear-btn').click();
            await pending;
            const cleared=FF.views.List.getCurrentData().length===0 && document.getElementById('file-list').children.length===0;
            return {hidden,rows,csv,cleared};
        });
        assert.equal(result.hidden,1);
        assert.equal(result.rows[0][0],'a.js.md'); assert.equal(result.rows[0][3],'md'); assert.match(result.csv,/a.js.md/);
        assert.equal(result.cleared,true);
        const lock = await page.evaluate(async () => {
            let release;
            const running=FileFlow.ui.runOperation(()=>new Promise(ok=>{release=ok;}));
            const disabled=document.getElementById('clear-btn').disabled;
            let duplicateRan=false;
            await FileFlow.ui.runOperation(()=>{duplicateRan=true;});
            release();await running;
            try { await FileFlow.ui.runOperation(()=>Promise.reject(new Error('expected failure'))); } catch {}
            return {disabled,duplicateRan,restored:!document.getElementById('clear-btn').disabled};
        });
        assert.deepEqual(lock,{disabled:true,duplicateRan:false,restored:true});
        await page.evaluate(async () => {
            const names = ['ok.js','failed.js','large.js'];
            const entries = names.map(name => ({name,fullPath:'/root/'+name,isFile:true,isDirectory:false,file(ok,bad){
                if(name==='failed.js') bad(new Error('unreadable source'));
                else ok(new File([name==='large.js'?'x'.repeat(20000):'const ok = 1;'],name));
            }}));
            FileFlow.state.currentRootEntries=[{name:'root',fullPath:'/root',isDirectory:true,createReader(){let done=false;return {readEntries(ok){ok(done?[]:(done=true,entries));}};}}];
            FileFlow.state.searchQuery='';
            FileFlow.state.resetMetadata();
            FileFlow.state.appSettings.llmExportConfig={maxSingleFileSizeMB:0.01};
        });
        const downloadEvent = page.waitForEvent('download');
        await page.evaluate(() => FileFlow.llmExport.exportForLLM({maxPartSizeBytes:12000}));
        const download = await downloadEvent;
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const report = await zip.file('export_report.csv').async('string');
        assert.match(report,/failed.js,failed,unreadable source/);
        assert.match(report,/large.js,excluded,single-file-size-limit/);
        const csv = await zip.file('target_files_list.csv').async('string');
        assert.match(csv,/ok.js/); assert.doesNotMatch(csv,/failed.js|large.js/);
        const navigation = await zip.file('index.md').async('string');
        assert.deepEqual(YAML.parse(navigation.match(/^\uFEFF?---\n([\s\S]*?)\n---/)[1]),{okf_version:'0.2'});
        const index = await zip.file('codebase.md').async('string');
        for (const name of Object.keys(zip.files).filter(name=>name.endsWith('.md') && name!=='index.md')) {
            const text=await zip.file(name).async('string');
            const meta=YAML.parse(text.match(/^\uFEFF?---\n([\s\S]*?)\n---/)[1]);
            assert.ok(meta.type);assert.equal(meta.generated.by,'process:fileflow-export');
            assert.ok(meta.sources.every(source=>typeof source.resource==='string'));
            assert.equal(meta.verified,undefined);assert.equal(meta.generated_at,undefined);
        }
        assert.match(index,/exported_text_files: 1/); assert.match(index,/failed.js.*failed/);
        for(const name of Object.keys(zip.files).filter(name=>name.includes('_src_'))) {
            const bytes=await zip.file(name).async('uint8array');assert.ok(bytes.length<=12000);
        }
        await page.evaluate(() => { FileFlow.state.appSettings.llmExportConfig={maxSingleFileSizeMB:0.01,sourceExtensions:'.missing'}; });
        // All selected sources skipped still produces an auditable report package.
        await page.evaluate(() => { FileFlow.state.appSettings.llmExportConfig={maxSingleFileSizeMB:0.01,sourceExtensions:'.js'}; FileFlow.state.searchQuery='failed.js'; });
        const allFailedEvent=page.waitForEvent('download');
        await page.evaluate(() => FileFlow.llmExport.exportForLLM({maxPartSizeBytes:12000}));
        const failedDownload=await allFailedEvent;
        const failedZip=await JSZip.loadAsync(fs.readFileSync(await failedDownload.path()));
        assert.match(await failedZip.file('export_report.csv').async('string'),/failed.js,failed/);
        assert.match(await failedZip.file('codebase.md').async('string'),/exported_text_files: 0/);
        assert.deepEqual(errors,[]);
        console.log(`Browser: ${suite.passed} existing tests including XML; offline file://, settings reload, lazy filter, rename/CSV, Clear race, real LLM ZIP/report/index consistency passed.`);
    } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
