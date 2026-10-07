'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const YAML = require('yaml');
global.window = global;
global.document = { getElementById() { return null; } };
global.FileFlow = {};
global.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onload({ target: this }); }, error => this.onerror(error)); } };
global.JSZip = require('jszip');
for (const name of ['state','utils','core','actions','views','ui','export-common','export-consolidator','export-format','export-llm']) {
    vm.runInThisContext(fs.readFileSync(`js/${name}.js`, 'utf8'), { filename: `js/${name}.js` });
}
const FF = FileFlow;
const entry = (name, text, fail = false) => ({ name: name.split('/').pop(), fullPath: '/root/' + name, isFile: true, isDirectory: false,
    file(ok, bad) { fail ? bad(new Error('permission denied')) : ok(new Blob([text])); } });
const item = (name, text, fail = false) => ({ entry: entry(name, text, fail), relativePath: name, relPath: name, size: new TextEncoder().encode(text).length });
async function run() {
    const a = item('foo', 'original'), b = item('foo.md', 'other');
    await FF.actions.ActionManager.resolve('md').execute(a.entry);
    await assert.rejects(FF.utils.Zip.createZip([a,b]), /Duplicate ZIP path: foo.md/);
    await assert.rejects(FF.utils.Zip.createZip([a,item('foo.md/child.js','nested')]), /file\/directory conflict: foo.md/);
    FF.state.resetMetadata();
    const reportCollision = await FF.utils.Zip.createZip([item('_fileflow_export_report.csv/child.js','nested')]);
    const collisionZip = await JSZip.loadAsync(await reportCollision.blob.arrayBuffer());
    assert.ok(collisionZip.file('__fileflow_export_report.csv'));
    assert.equal(await collisionZip.file('_fileflow_export_report.csv/child.js').async('string'),'nested');
    const zipResult = await FF.utils.Zip.createZip([item('src/a.js','const a = 1;'), item('bad.js','',true)]);
    const zip = await JSZip.loadAsync(await zipResult.blob.arrayBuffer());
    assert.equal(await zip.file('src/a.js').async('string'), 'const a = 1;');
    assert.equal(zip.file('bad.js'), null);
    assert.match(await zip.file('_fileflow_export_report.csv').async('string'), /bad.js,failed,permission denied/);
    const outcomes = await FF.llmExport.SourceConsolidator.consolidate({
        fileItems: [item('ok.js','const ok = 1;'),item('fail.js','',true),item('large.js','x'.repeat(500))],
        projects: [], maxPartSize: 16384, maxSingleFileSize: 100
    });
    assert.deepEqual(outcomes.report.map(r => r.status), ['exported','failed','excluded']);
    const content = '😀日本語\n'.repeat(2000);
    const packed = await FF.llmExport.SourceConsolidator.consolidate({fileItems: [item('unicode.js', content)], projects: [], maxPartSize: 12000, maxSingleFileSize: 0});
    let restored = '';
    for (const result of packed.results) {
        assert.ok(result.blob.size <= 12000, result.blob.size);
        const text = await result.blob.text();
        assert.ok(FF.llmExport._internals.countWords(text) < 500000);
        const body = text.slice(text.indexOf('## File:'));
        const match = body.match(/```javascript\n([\s\S]*?)\n```/);
        assert.ok(match); restored += match[1];
    }
    assert.equal(restored, content);
    await assert.rejects(FF.llmExport.SourceConsolidator.consolidate({fileItems:[item('a.js','x')],projects:[],maxPartSize:1}), /too small/);
    assert.equal(FF.llmExport.SourceConsolidator._decodeToUtf8(new Uint8Array([255,254,65,0,10,0])), 'A\n');
    let active = 0, peak = 0;
    const results = await FF.utils.mapLimit(Array.from({length:100}, (_,i)=>i),8,async i => { active++; peak = Math.max(peak,active); await new Promise(r=>setTimeout(r,1)); active--; return i; });
    assert.equal(peak,8); assert.equal(results.length,100);
    const scanErrors=[];
    const directory={name:'broken',fullPath:'/broken',isDirectory:true,createReader(){return {readEntries(ok,bad){bad(new Error('directory denied'));}};}};
    const scanned=await FF.utils.Entries.collectFiles([directory],{onError(entry,e){scanErrors.push({path:entry.fullPath,status:'failed',reason:e.message});}});
    assert.equal(scanned.length,0);assert.equal(scanErrors.length,1);
    const failedScan=await FF.utils.Zip.createZip(scanned,scanErrors);
    assert.equal(failedScan.report[0].reason,'directory denied');
    assert.throws(()=>FF.llmExport._internals.generateIndexMd({rootName:'root',mode:'folder_structure',ext:'.md',allFilesInfo:[],fileItems:[],results:[],partFileList:[],projects:[],maxIndexBytes:1}),/Index size limit/);
    const nested=item('src/root/nested.js','const nested = 1;');
    FF.state.currentRootEntries=[{name:'root',fullPath:'/root',isDirectory:true,createReader(){let done=false;return {readEntries(ok){ok(done?[]:(done=true,[nested.entry]));}};}}];
    const scan=await FF.llmExport.scanProjects();
    assert.equal(scan.fileItems[0].relativePath,'src/root/nested.js');
    assert.equal(FF.utils.csvEscape('a\rb'), '"a\rb"');
    FF.state.currentRootEntries=[{name:'repo "quoted"\\name',isDirectory:true}];
    const oddPath='src/quote"file.js';
    const exported=await FF.llmExport.SourceConsolidator.consolidate({fileItems:[item(oddPath,'const n = 1;')],projects:[],maxPartSize:16000,generatedAt:'2026-10-08T00:00:00Z'});
    const partMeta=YAML.parse((await exported.results[0].blob.text()).match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.equal(partMeta.generated.at,'2026-10-08T00:00:00Z');
    assert.equal(partMeta.sources[0].resource,'Local input file: '+oddPath);
    assert.equal(partMeta.sources[0].title,oddPath);
    assert.equal(partMeta.verified,undefined);
    assert.equal(partMeta.format_version,undefined);
    const catalogue=FF.llmExport._internals.generateIndexMd({rootName:'repo "quoted"\\name',mode:'folder_structure',ext:'.md',allFilesInfo:[{relativePath:oddPath,size:12,isExportTarget:true}],fileItems:[item(oddPath,'const n = 1;')],results:exported.results,partFileList:exported.partFileList,projects:[],maxIndexBytes:16000});
    const navigation=await catalogue[0].blob.text();
    assert.deepEqual(YAML.parse(navigation.match(/^---\n([\s\S]*?)\n---/)[1]),{okf_version:'0.2'});
    const filenames=new Set(catalogue.concat(exported.results).map(f=>f.filename));
    for(const match of navigation.matchAll(/\]\(([^)]+)\)/g)) assert.ok(filenames.has(decodeURIComponent(match[1])),match[1]);
    await assert.rejects(FF.llmExport.SourceConsolidator.consolidate({fileItems:[],projects:[],ext:'.txt'}),/must use .md/);
    console.log('Integration: ZIP contents/collisions, failure reports, lossless Unicode splitting, limits, UTF-16, bounded I/O passed.');
}
run().catch(e => { console.error(e); process.exitCode=1; });
