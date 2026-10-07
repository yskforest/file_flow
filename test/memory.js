// Informational benchmark. Do not assert platform-dependent RSS values.
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
global.window = global;
global.document = { getElementById() { return null; } };
global.FileFlow = {};
for (const name of ['state','utils','core','actions','views','ui','export-common','export-consolidator','export-format','export-llm']) {
    vm.runInThisContext(fs.readFileSync(`js/${name}.js`,'utf8'), {filename:`js/${name}.js`});
}
async function main() {
    const size=512*1024, count=128;
    const items=Array.from({length:count},(_,index)=>({
        entry:{name:`f${index}.js`,fullPath:`/root/f${index}.js`,file(ok){ok(new Blob(['const sample = 1;\n'.repeat(Math.ceil(size/18)).slice(0,size)]));}},
        relativePath:`f${index}.js`,size
    }));
    if(global.gc) global.gc();
    const before=process.memoryUsage();
    let peak=before.heapUsed, peakRss=before.rss;
    const sample=()=>{ const m=process.memoryUsage();peak=Math.max(peak,m.heapUsed);peakRss=Math.max(peakRss,m.rss); };
    const timer=setInterval(sample,10);
    const start=Date.now();
    try {
        const result=await FileFlow.llmExport.SourceConsolidator.consolidate({fileItems:items,projects:[],maxPartSize:4*1024*1024,maxFilesPerPart:1000,maxSingleFileSize:0,onProgress:sample});
        sample();
        const mib=n=>Math.round(n/1024/1024*10)/10;
        console.log(JSON.stringify({inputMiB:count*size/1024/1024,parts:result.results.length,seconds:(Date.now()-start)/1000,heapStartMiB:mib(before.heapUsed),sampledPeakHeapMiB:mib(peak),sampledPeakRssMiB:mib(peakRss)}));
    } finally {clearInterval(timer);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
