// FileFlow Test Suite — Test Runner & Cases
(function (global) {
    const tests = [];

    // --- Assertions ---
    const assert = {
        ok(val, msg) {
            if (!val) throw new Error(msg || `Expected truthy, got ${val}`);
        },
        equal(a, b, msg) {
            if (a !== b) throw new Error(msg || `Expected ${a} === ${b}, got: ${a} and ${b}`);
        },
        deepEqual(a, b, msg) {
            const sa = JSON.stringify(a);
            const sb = JSON.stringify(b);
            if (sa !== sb) throw new Error(msg || `Expected ${sa} to deeply equal ${sb}`);
        },
        throws(fn, regex, msg) {
            try {
                fn();
            } catch (e) {
                if (regex && !regex.test(e.message)) {
                    throw new Error(`Expected error matching ${regex}, got: ${e.message}`);
                }
                return;
            }
            throw new Error(msg || "Expected function to throw");
        }
    };

    // --- Test Registration ---
    function test(name, fn) {
        tests.push({ name, fn });
    }

    // --- Helper to create Mock File/Blob ---
    function createMockFile(contentArray, options = {}) {
        const bytes = new Uint8Array(contentArray);
        if (typeof Blob !== 'undefined') {
            return new Blob([bytes], options);
        } else {
            return {
                size: bytes.length,
                type: options.type || '',
                arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                slice(start, end) {
                    return createMockFile(contentArray.slice(start, end), options);
                }
            };
        }
    }

    // --- Helper to create Mock FileSystemFileEntry ---
    function createMockFileEntry(name, fullPath, fileContentArray) {
        return {
            isFile: true,
            isDirectory: false,
            name,
            fullPath,
            file(successCallback, errorCallback) {
                const file = createMockFile(fileContentArray);
                successCallback(file);
            }
        };
    }

    // --- Helper to create Mock FileSystemDirectoryEntry ---
    function createMockDirectoryEntry(name, fullPath) {
        return {
            isFile: false,
            isDirectory: true,
            name,
            fullPath
        };
    }

    // ==========================================
    // 1. Glob Filtering Tests
    // ==========================================
    test("Glob.createMatcher — Single Pattern", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("*.js");

        assert.ok(matcher("app.js"));
        assert.ok(matcher("utils.JS")); // Case-insensitive
        assert.ok(!matcher("style.css"));
        assert.ok(!matcher("README.md"));
    });

    test("Glob.createMatcher — Multiple Patterns", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("*.js *.ts, *.tsx");

        assert.ok(matcher("main.js"));
        assert.ok(matcher("types.ts"));
        assert.ok(matcher("component.tsx"));
        assert.ok(!matcher("style.css"));
    });

    test("Glob.createMatcher — Exclude Patterns", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("!*.log !*.tmp");

        assert.ok(matcher("app.js"));
        assert.ok(!matcher("error.log"));
        assert.ok(!matcher("temp.tmp"));
    });

    test("Glob.createMatcher — Include and Exclude Combinations", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("*.js !*.test.js");

        assert.ok(matcher("app.js"));
        assert.ok(matcher("utils.js"));
        assert.ok(!matcher("app.test.js"));
        assert.ok(!matcher("style.css"));
    });

    test("Glob.createMatcher — Empty or Spaces", () => {
        const { Glob } = FileFlow.utils;
        assert.equal(Glob.createMatcher(""), null);
        assert.equal(Glob.createMatcher("   "), null);
    });

    test("Glob.createMatcher — Path Pattern src/**/*.py", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("src/**/*.py");

        assert.ok(matcher("a.py", "src/a.py"));
        assert.ok(matcher("b.py", "src/sub/b.py"));
        assert.ok(!matcher("c.js", "src/sub/c.js"));
        assert.ok(!matcher("a.py", "lib/a.py"));
    });

    test("Glob.createMatcher — Path Exclude", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("*.js !src/**/*.test.js");

        assert.ok(matcher("app.js", "src/app.js"));
        assert.ok(!matcher("app.test.js", "src/app.test.js"));
        assert.ok(matcher("app.test.js", "lib/app.test.js"));
    });

    test("Glob.createMatcher — ** matches nested dirs", () => {
        const { Glob } = FileFlow.utils;
        const matcher = Glob.createMatcher("**/*.md");

        assert.ok(matcher("readme.md", "readme.md"));
        assert.ok(matcher("readme.md", "docs/readme.md"));
        assert.ok(matcher("readme.md", "a/b/c/readme.md"));
        assert.ok(!matcher("app.js", "a/b/app.js"));
    });

    // ==========================================
    // 2. Encoding and EOL Detection Tests
    // ==========================================
    test("Detect.detectFileInfo — UTF-8 with BOM", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0xEF, 0xBB, 0xBF, 0x61, 0x62, 0x63]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "UTF-8 (BOM)");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — UTF-16 BE BOM", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0xFE, 0xFF, 0x00, 0x61]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "UTF-16 BE");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — UTF-16 LE BOM", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0xFF, 0xFE, 0x61, 0x00]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "UTF-16 LE");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — ASCII", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x62, 0x63, 0x0A]); // abc\n
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "ASCII");
        assert.equal(info.eol, "LF");
    });

    test("Detect.detectFileInfo — UTF-8 (No BOM, Japanese)", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0xE3, 0x81, 0x82]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "UTF-8");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — Shift_JIS (Japanese)", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x82, 0xA0]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "Shift_JIS");
    });

    test("Detect.detectFileInfo — Binary (Null Byte)", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x62, 0x00, 0x63]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "Binary");
        assert.equal(info.isBinary, true);
        assert.equal(info.eol, "-");
    });

    test("Detect.detectFileInfo — Empty File", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([]);
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.encoding, "Empty");
        assert.equal(info.eol, "None");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — EOL CRLF", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x0D, 0x0A, 0x62, 0x0D, 0x0A]); // a\r\nb\r\n
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.eol, "CRLF");
    });

    test("Detect.detectFileInfo — EOL LF", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x0A, 0x62, 0x0A]); // a\nb\n
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.eol, "LF");
    });

    test("Detect.detectFileInfo — EOL CR", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x0D, 0x62, 0x0D]); // a\rb\r
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.eol, "CR");
    });

    test("Detect.detectFileInfo — EOL Mixed", async () => {
        const { Detect } = FileFlow.utils;
        const file = createMockFile([0x61, 0x0D, 0x0A, 0x62, 0x0A]); // CRLF and LF (tied or mixed)
        const info = await Detect.detectFileInfo(file);

        assert.equal(info.eol, "Mixed");
    });

    // ==========================================
    // 3. Action System Tests (DOM-free)
    // ==========================================
    test("RenameAction — shouldApply", () => {
        const { RenameAction } = FileFlow.actions;
        const actionMd = new RenameAction(".md");

        const fileTxt = createMockFileEntry("test.txt", "/root/test.txt", []);
        const fileMd = createMockFileEntry("test.md", "/root/test.md", []);
        const dir = createMockDirectoryEntry("docs", "/root/docs");

        assert.ok(actionMd.shouldApply(fileTxt));
        assert.ok(!actionMd.shouldApply(fileMd)); // Already has .md
        assert.ok(!actionMd.shouldApply(dir));    // Directory
    });

    test("RenameAction — execute (pure, no DOM)", async () => {
        const { RenameAction } = FileFlow.actions;
        const State = FileFlow.state;

        State.entryMetadata = {};
        const actionMd = new RenameAction(".md");
        const file = createMockFileEntry("test.txt", "/root/test.txt", []);

        const res = await actionMd.execute(file);

        assert.ok(res.applied);
        assert.equal(res.newName, "test.txt.md");
        assert.equal(State.entryMetadata["/root/test.txt"].newFilename, "test.txt.md");
    });

    test("RenameAction — execute legacy (itemDiv, entry) compat", async () => {
        const { RenameAction } = FileFlow.actions;
        const State = FileFlow.state;
        State.entryMetadata = {};

        const actionMd = new RenameAction(".md");
        const file = createMockFileEntry("a.txt", "/root/a.txt", []);
        const fakeDiv = { querySelector() { return null; } };

        const res = await actionMd.execute(fakeDiv, file);
        assert.ok(res.applied);
        assert.equal(State.entryMetadata["/root/a.txt"].newFilename, "a.txt.md");
    });

    test("RenameAction — execute skips already-renamed", async () => {
        const { RenameAction } = FileFlow.actions;
        const State = FileFlow.state;
        State.entryMetadata = {};

        const actionMd = new RenameAction(".md");
        const file = createMockFileEntry("test.md", "/root/test.md", []);
        const res = await actionMd.execute(file);
        assert.ok(!res.applied);
        assert.equal(State.entryMetadata["/root/test.md"], undefined);
    });

    test("DetectAction — shouldApply", () => {
        const { DetectAction } = FileFlow.actions;
        const action = new DetectAction();

        const file = createMockFileEntry("test.txt", "/root/test.txt", []);
        const dir = createMockDirectoryEntry("docs", "/root/docs");

        assert.ok(action.shouldApply(file));
        assert.ok(!action.shouldApply(dir));
    });

    test("DetectAction — execute (pure, no DOM)", async () => {
        const { DetectAction } = FileFlow.actions;
        const State = FileFlow.state;

        State.entryMetadata = {};
        const action = new DetectAction();
        const file = createMockFileEntry("test.txt", "/root/test.txt", [0x61, 0x0A, 0x62]);

        const res = await action.execute(file);

        assert.ok(res.applied);
        assert.equal(res.encoding, "ASCII");
        assert.equal(res.eol, "LF");
        assert.ok(State.entryMetadata["/root/test.txt"].detectionInfo);
        assert.equal(State.entryMetadata["/root/test.txt"].detectionInfo.encoding, "ASCII");
    });

    test("ActionManager.resolve — mode mapping centralized", () => {
        const { ActionManager } = FileFlow.actions;
        assert.ok(ActionManager.resolve('md'));
        assert.ok(ActionManager.resolve('txt'));
        assert.ok(ActionManager.resolve('detect'));
        assert.ok(ActionManager.resolve('.md'));
        assert.equal(ActionManager.resolve('unknown'), undefined);
    });

    // ==========================================
    // 4. Utility / State Tests
    // ==========================================
    test("utils.formatBytes", () => {
        const { formatBytes } = FileFlow.utils;
        assert.equal(formatBytes(0), "0 Bytes");
        assert.equal(formatBytes(512), "512 Bytes");
        assert.equal(formatBytes(1024), "1 KiB");
        assert.equal(formatBytes(1536), "1.5 KiB");
        assert.equal(formatBytes(1048576), "1 MiB");
        assert.equal(formatBytes(1073741824), "1 GiB");
    });

    test("utils.formatBytes — edge cases", () => {
        const { formatBytes } = FileFlow.utils;
        assert.equal(formatBytes(-5), "0 Bytes");
        assert.equal(formatBytes(NaN), "0 Bytes");
        assert.equal(formatBytes("1024"), "1 KiB");
    });

    test("utils.formatDate", () => {
        const { formatDate } = FileFlow.utils;
        assert.equal(formatDate(null), "-");
        assert.equal(formatDate(undefined), "-");
        assert.equal(formatDate(""), "-");

        const testDateStr = "2026-07-15T14:50:00.000Z";
        const expected = new Date(testDateStr).toLocaleString();
        assert.equal(formatDate(testDateStr), expected);
    });

    test("utils.escapeHtml — XSS safe", () => {
        const { escapeHtml } = FileFlow.utils;
        assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
        assert.equal(escapeHtml('"quoted" & \'single\''), '&quot;quoted&quot; &amp; &#39;single&#39;');
        assert.equal(escapeHtml(null), '');
    });

    test("state.updateMeta — merges and notifies", async () => {
        const State = FileFlow.state;
        State.entryMetadata = {};
        let notified = null;
        const off = State.subscribe('entryMetadata', (v) => { notified = v; });
        try {
            State.updateMeta('/a.txt', { size: 10 });
            State.updateMeta('/a.txt', { newFilename: 'a.txt.md' });
            assert.equal(State.entryMetadata['/a.txt'].size, 10);
            assert.equal(State.entryMetadata['/a.txt'].newFilename, 'a.txt.md');
            assert.ok(notified);
        } finally { off(); }
    });

    test("Entries.buildRelPath — single root strips prefix", () => {
        const { Entries } = FileFlow.utils;
        const entry = { name: 'a.py', fullPath: '/root/src/a.py' };
        assert.equal(Entries.buildRelPath(entry, ['root']), 'src/a.py');
        assert.equal(Entries.buildRelPath(entry, ['root', 'other']), 'root/src/a.py');
    });

    // ==========================================
    // 5. LLM Export Tests
    // ==========================================
    test("llmExport — namespace renamed with compat alias", () => {
        assert.ok(FileFlow.llmExport);
        assert.equal(FileFlow.notebookLM, FileFlow.llmExport);
        assert.ok(FileFlow.llmExport.SourceConsolidator);
        assert.ok(FileFlow.llmExport.VcxprojParser);
    });

    test("llmExport internals — getExtension/detectLanguage", () => {
        const t = FileFlow.llmExport._internals;
        assert.equal(t.getExtension('Engine.cpp'), '.cpp');
        assert.equal(t.getExtension('noext'), '');
        assert.equal(t.detectLanguage('a.cpp'), 'cpp');
        assert.equal(t.detectLanguage('b.py'), 'python');
        assert.equal(t.detectLanguage('c.unknown'), 'text');
    });

    test("llmExport internals — fuzzyMatchProject", () => {
        const t = FileFlow.llmExport._internals;
        const map = new Map([['c:/proj/src/a.cpp', { projectName: 'P', filter: 'F' }]]);
        assert.deepEqual(t.fuzzyMatchProject({ name: 'a.cpp' }, map), { projectName: 'P', filter: 'F' });
        assert.equal(t.fuzzyMatchProject({ name: 'other.cpp' }, map), null);
    });

    test("llmExport — SourceConsolidator splits by part size", async () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const mk = (rel, text) => ({
            entry: { name: rel.split('/').pop(), fullPath: '/root/' + rel, file: (ok) => ok(new Blob([text])) },
            relativePath: rel, projectName: '', filter: '', size: text.length
        });
        const items = [mk('src/a.cpp', 'int a;\n'), mk('src/b.cpp', 'int b;\n')];
        const { results } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 1, maxSingleFileSize: 0, onProgress: null
        });
        assert.ok(results.length >= 2);
        assert.ok(results[0].filename.endsWith('.md'));
        const text = await results[0].blob.text();
        assert.ok(text.includes('type: codebase_export'));
        assert.ok(text.includes('## File:'));
    });

    test("llmExport — CSV generators escape correctly", async () => {
        const t = FileFlow.llmExport._internals;
        const items = [{ relativePath: 'a,"b".cpp', projectName: 'P', filter: '', size: 3 }];
        const csvText = await t.generateTargetFilesCsv(items).text();
        assert.ok(csvText.includes('"a,""b"".cpp"'));
        const folders = await t.generateFolderStructureCsv([{ relativePath: 'src/a.cpp', size: 10 }]).text();
        assert.ok(folders.includes('Folder Path'));
        assert.ok(folders.includes('src'));
    });

    test("llmExport — VcxprojParser (browser only)", () => {
        if (typeof DOMParser === 'undefined') return; // Node.js ではスキップ
        const { VcxprojParser } = FileFlow.llmExport;
        const xml = '<?xml version="1.0"?><Project><ItemGroup><ClCompile Include="src\\a.cpp" /></ItemGroup></Project>';
        const info = VcxprojParser.parseProject(xml, '/root/p.vcxproj');
        assert.equal(info.name, 'p');
        assert.deepEqual(info.sourceFiles, ['src/a.cpp']);
    });

    test("llmExport — fenced block survives backticks in content", () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        const item = { relativePath: 'docs/a.md', projectName: '', filter: '', size: 10 };
        const block = SourceConsolidator._buildOKFFileBlock(item, 'hello\n```js\ncode\n```\nbye\n');
        // 長いフェンスに自動切替し、本文が壊れずに残ること
        assert.ok(block.includes('````'));
        assert.ok(block.includes('hello\n```js\ncode\n```\nbye'));
        assert.ok(block.includes('*End of file `docs/a.md`*'));
    });

    test("llmExport — file block footer carries path", () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        const item = { relativePath: 'src/a.cpp', projectName: '', filter: '', size: 1 };
        const block = SourceConsolidator._buildOKFFileBlock(item, 'x');
        assert.ok(block.includes('```cpp'));
        assert.ok(block.includes('*End of file `src/a.cpp`*'));
    });

    test("llmExport — oversized single file is chunked with continuation", async () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const big = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n') + '\n';
        const items = [{
            entry: { name: 'big.cpp', fullPath: '/root/big.cpp', file: (ok) => ok(new Blob([big])) },
            relativePath: 'big.cpp', projectName: '', filter: '', size: big.length
        }];
        const { results, partFileList } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 9000, maxFilesPerPart: 0, maxSingleFileSize: 0, onProgress: null
        });
        assert.ok(results.length >= 1);
        const text = await results[0].blob.text();
        // チャンク分割時は継続見出し、各断片にパスが付くこと
        if (partFileList[0].length > 1) {
            assert.ok(text.includes('(split 1/'));
            assert.ok(text.includes('(split 2/'));
        } else {
            assert.ok(text.includes('## File: `big.cpp`'));
        }
        assert.ok(text.includes('*End of file `big.cpp`*'));
    });

    test("llmExport — splitContent chunks by budget", () => {
        const t = FileFlow.llmExport._internals;
        assert.deepEqual(t.splitContent('a\nb\n', Infinity), ['a\nb\n']);
        const src = Array.from({ length: 200 }, () => '01234567').join('\n') + '\n';
        const chunks = t.splitContent(src, 1024);
        assert.ok(chunks.length >= 2);
        assert.equal(chunks.join(''), src);
        assert.ok(chunks.every(c => new TextEncoder().encode(c).length <= 1024));
        // 長大1行は文字単位で切断される
        const long = t.splitContent('x'.repeat(3000), 1024);
        assert.ok(long.length > 1);
        assert.equal(long.join(''), 'x'.repeat(3000));
    });

    test("llmExport — exclude matcher drops generated noise", () => {
        const t = FileFlow.llmExport._internals;
        const m = t.createExcludeMatcher(FileFlow.llmExport.DEFAULT_CONFIG.excludePatterns);
        assert.ok(m);
        assert.ok(!m('app.js', 'src/app.js'));
        assert.ok(m('a.js', 'node_modules/pkg/a.js'));
        assert.ok(m('b.js', 'proj/dist/b.js'));
        assert.ok(m('c.min.js', 'src/c.min.js'));
        assert.ok(m('d.js', 'build/d.js'));
        assert.equal(t.createExcludeMatcher(''), null);
        assert.equal(t.createExcludeMatcher('   '), null);
    });

    test("llmExport — sortFileItems pins README first", () => {
        const t = FileFlow.llmExport._internals;
        const mk = (rel, proj) => ({ relativePath: rel, projectName: proj || '' });
        const items = [mk('src/z.cpp', 'B'), mk('README.md'), mk('src/a.cpp', 'A')];
        t.sortFileItems(items, 'folder_structure');
        assert.equal(items[0].relativePath, 'README.md');
        const vcx = [mk('src/z.cpp', 'B'), mk('README.md'), mk('src/a.cpp', 'A')];
        t.sortFileItems(vcx, 'vcxproj');
        assert.equal(vcx[0].relativePath, 'README.md');
        assert.equal(vcx[1].projectName, 'A');
    });

    test("llmExport — getExportConfig excludes default", () => {
        FileFlow.state.appSettings = { llmExportConfig: {} };
        const cfg = FileFlow.llmExport.getExportConfig();
        assert.ok(cfg.excludePatterns.includes('node_modules'));
        FileFlow.state.appSettings = { llmExportConfig: { excludePatterns: '' } };
        assert.equal(FileFlow.llmExport.getExportConfig().excludePatterns, '');
        FileFlow.state.appSettings = {};
    });

    test("llmExport — assignParts honors size and count limits", () => {
        const t = FileFlow.llmExport._internals;
        const items = [
            { relativePath: 'a.cpp', size: 100 },
            { relativePath: 'b.cpp', size: 100 },
            { relativePath: 'c.cpp', size: 100 }
        ];
        assert.deepEqual(t.assignParts(items, Infinity, 1), [[0], [1], [2]]);
        assert.deepEqual(t.assignParts(items, Infinity, Infinity), [[0, 1, 2]]);
        assert.deepEqual(t.assignParts(items, 700, Infinity), [[0], [1], [2]]);
        assert.deepEqual(t.assignParts(items, 100000, 2), [[0, 1], [2]]);
        assert.deepEqual(t.assignParts([], 100, 100), []);
    });

    test("llmExport — consolidate splits by file count", async () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const mk = (rel, text) => ({
            entry: { name: rel.split('/').pop(), fullPath: '/root/' + rel, file: (ok) => ok(new Blob([text])) },
            relativePath: rel, projectName: '', filter: '', size: text.length
        });
        const items = [mk('src/a.cpp', 'int a;\n'), mk('src/b.cpp', 'int b;\n'), mk('src/c.cpp', 'int c;\n')];
        const { results } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 100 * 1024 * 1024, maxFilesPerPart: 1, maxSingleFileSize: 0, onProgress: null
        });
        assert.equal(results.length, 3);
        assert.ok(results[0].filename.includes('_001_of_003'));
    });

    test("llmExport — part contains directory subtree", async () => {
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const mk = (rel, text) => ({
            entry: { name: rel.split('/').pop(), fullPath: '/root/' + rel, file: (ok) => ok(new Blob([text])) },
            relativePath: rel, projectName: '', filter: '', size: text.length
        });
        const { results } = await SourceConsolidator.consolidate({
            fileItems: [mk('src/core/a.cpp', 'int a;\n')], projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 0, maxFilesPerPart: 0, maxSingleFileSize: 0, onProgress: null
        });
        assert.equal(results.length, 1);
        const text = await results[0].blob.text();
        assert.ok(text.includes('Directory Subtree'));
        assert.ok(text.includes('src/'));
    });

    test("llmExport — index shards when over limit", async () => {
        const t = FileFlow.llmExport._internals;
        FileFlow.state.currentRootEntries = [];
        const info = [];
        for (let i = 0; i < 10; i++) {
            info.push({ relativePath: `src/f${i}.cpp`, size: 100, extension: '.cpp', isExportTarget: true });
        }
        const files = t.generateIndexMd({
            rootName: 'root', mode: 'folder_structure', ext: '.md',
            allFilesInfo: info, fileItems: info.map(f => ({ ...f, projectName: '', filter: '' })),
            results: [{ filename: 'x' }], partFileList: [info.map(f => ({ path: f.relativePath, project: '', filter: '', size: 100 }))],
            projects: [], maxIndexBytes: 700
        });
        assert.ok(files.length > 1);
        assert.equal(files[0].filename, 'index.md');
        assert.ok(files[1].filename.startsWith('index_files_'));
        const shardText = await files[1].blob.text();
        assert.ok(shardText.includes('codebase_index_shard'));
        assert.ok(shardText.includes('Load `index.md` first'));
    });

    test("llmExport — getExportConfig defaults maxFilesPerPart", () => {
        FileFlow.state.appSettings = { llmExportConfig: {} };
        const cfg = FileFlow.llmExport.getExportConfig();
        assert.equal(cfg.maxFilesPerPart, 1000);
        FileFlow.state.appSettings = { llmExportConfig: { maxFilesPerPart: 0 } };
        assert.equal(FileFlow.llmExport.getExportConfig().maxFilesPerPart, 0);
        FileFlow.state.appSettings = {};
    });

    test("llmExport — countWords counts tokens plus CJK", () => {
        const t = FileFlow.llmExport._internals;
        assert.equal(t.countWords(''), 0);
        assert.equal(t.countWords('hello world'), 2);
        assert.equal(t.countWords('a  b\nc'), 3);
        // 日本語は空白区切り1トークン + CJK文字数で保守的に加算
        assert.ok(t.countWords('あいうえお') >= 5, 'CJK chars counted');
        assert.ok(t.countWords('hello 世界') >= 3, 'mixed content counted');
    });

    test("llmExport — splitContentByWords chunks losslessly", () => {
        const t = FileFlow.llmExport._internals;
        assert.deepEqual(t.splitContentByWords('a\nb\n', Infinity), ['a\nb\n']);
        const src = Array.from({ length: 200 }, () => 'word1 word2').join('\n') + '\n';
        const chunks = t.splitContentByWords(src, 100);
        assert.ok(chunks.length >= 2);
        assert.equal(chunks.join(''), src);
        assert.ok(chunks.every(c => t.countWords(c) <= 100));
        // 長大1行は単語ラン単位で切断される
        const longSrc = ('w '.repeat(3000)).trim();
        const long = t.splitContentByWords(longSrc, 1024);
        assert.ok(long.length > 1);
        assert.equal(long.join(''), longSrc);
        assert.ok(long.every(c => t.countWords(c) <= 1024));
        // 空白なしCJK長大行は文字単位で切断される
        const cjk = 'あ'.repeat(3000);
        const cchunks = t.splitContentByWords(cjk, 1024);
        assert.ok(cchunks.length > 1);
        assert.equal(cchunks.join(''), cjk);
    });

    test("llmExport — every src part is under 500k words even with huge byte limit", async () => {
        const t = FileFlow.llmExport._internals;
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const body = 'lorem ipsum dolor sit amet consectetur adipiscing\n'.repeat(5000); // 約4万語
        const mk = (rel) => ({
            entry: { name: rel.split('/').pop(), fullPath: '/root/' + rel, file: (ok) => ok(new Blob([body])) },
            relativePath: rel, projectName: '', filter: '', size: body.length
        });
        const items = [];
        for (let i = 0; i < 20; i++) items.push(mk(`src/f${i}.cpp`));
        const { results } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 100 * 1024 * 1024, maxFilesPerPart: 0, maxSingleFileSize: 0, onProgress: null
        });
        assert.ok(results.length > 1);
        for (const r of results) {
            const text = await r.blob.text();
            assert.ok(t.countWords(text) < 500000, `part ${r.filename} has ${t.countWords(text)} words`);
        }
    });

    test("llmExport — single huge file spills across parts under 500k words", async () => {
        const t = FileFlow.llmExport._internals;
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const big = 'word '.repeat(600000);
        const items = [{
            entry: { name: 'big.cpp', fullPath: '/root/big.cpp', file: (ok) => ok(new Blob([big])) },
            relativePath: 'big.cpp', projectName: '', filter: '', size: big.length
        }];
        const { results } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 0, maxFilesPerPart: 0, maxSingleFileSize: 0, onProgress: null
        });
        assert.ok(results.length > 1);
        for (const r of results) {
            const text = await r.blob.text();
            assert.ok(t.countWords(text) < 500000, `part ${r.filename} has ${t.countWords(text)} words`);
        }
    });

    test("llmExport — parts are balanced without tiny tails", async () => {
        const t = FileFlow.llmExport._internals;
        const { SourceConsolidator } = FileFlow.llmExport;
        FileFlow.state.currentRootEntries = [];
        const body = 'alpha beta gamma delta epsilon zeta\n'.repeat(3000); // 約1.8万語
        const mk = (i) => ({
            entry: { name: `f${i}.cpp`, fullPath: '/root/src/f' + i + '.cpp', file: (ok) => ok(new Blob([body])) },
            relativePath: `src/f${i}.cpp`, projectName: '', filter: '', size: body.length
        });
        const items = [];
        for (let i = 0; i < 30; i++) items.push(mk(i));
        const { results } = await SourceConsolidator.consolidate({
            fileItems: items, projects: [], mode: 'folder_structure', ext: '.md',
            maxPartSize: 4 * 1024 * 1024, maxFilesPerPart: 1000, maxSingleFileSize: 0, onProgress: null
        });
        assert.ok(results.length <= 3, `too many parts: ${results.length}`);
        for (const r of results) {
            const text = await r.blob.text();
            const w = t.countWords(text);
            assert.ok(w < 500000, `over limit: ${r.filename} ${w}`);
            assert.ok(w > 100000, `tiny tail part: ${r.filename} ${w}`);
        }
    });
    test("llmExport — CSV shards stay under 500k words with headers", async () => {
        const t = FileFlow.llmExport._internals;
        const header = 'col one col two col three';
        const rows = [];
        for (let i = 0; i < 12000; i++) {
            rows.push(Array.from({ length: 50 }, (_, k) => `w${i}_${k}`).join(' '));
        }
        const shards = t.shardCsvRows(header, rows, 'target_files_list.csv');
        assert.ok(shards.length > 1);
        assert.equal(shards[0].filename, 'target_files_list_001_of_' + String(shards.length).padStart(3, '0') + '.csv');
        let totalRows = 0;
        for (const s of shards) {
            const text = await s.blob.text();
            assert.ok(t.countWords(text) < 500000, `${s.filename} has ${t.countWords(text)} words`);
            assert.ok(text.startsWith(header));
            totalRows += text.trim().split('\n').length - 1;
        }
        assert.equal(totalRows, rows.length);
    });

    test("llmExport — index shards stay under 500k words with unlimited bytes", async () => {
        const t = FileFlow.llmExport._internals;
        FileFlow.state.currentRootEntries = [];
        const info = [];
        for (let i = 0; i < 60000; i++) {
            info.push({ relativePath: `src/some directory name/f${i}.cpp`, size: 100, extension: '.cpp', isExportTarget: true });
        }
        const files = t.generateIndexMd({
            rootName: 'root', mode: 'folder_structure', ext: '.md',
            allFilesInfo: info, fileItems: info.map(f => ({ ...f, projectName: '', filter: '' })),
            results: [{ filename: 'a' }, { filename: 'b' }],
            partFileList: [[{ path: 'src/a.cpp', project: '', filter: '', size: 1 }], [{ path: 'src/b.cpp', project: '', filter: '', size: 1 }]],
            projects: [], maxIndexBytes: 0
        });
        assert.ok(files.length > 1);
        for (const f of files) {
            const text = await f.blob.text();
            assert.ok(t.countWords(text) < 500000, `${f.filename} has ${t.countWords(text)} words`);
        }
    });

    // --- Execution Runner ---
    async function run(onStart, onTestResult, onComplete) {
        if (onStart) onStart(tests.length);
        let passed = 0;
        let failed = 0;

        for (const t of tests) {
            try {
                await t.fn();
                passed++;
                if (onTestResult) onTestResult(t.name, true, null);
            } catch (err) {
                failed++;
                if (onTestResult) onTestResult(t.name, false, err);
            }
        }

        if (onComplete) onComplete(passed, failed, tests.length);
        return { passed, failed, total: tests.length };
    }

    // --- Export ---
    const runner = { tests, run, assert };
    if (typeof exports !== 'undefined') {
        module.exports = runner;
    } else {
        global.TestRunner = runner;
    }
})(typeof window !== 'undefined' ? window : global);
