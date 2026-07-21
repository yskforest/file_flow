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
            // Node.js mock blob using a custom API or buffer
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


    // ==========================================
    // 2. Encoding and EOL Detection Tests
    // ==========================================
    test("Detect.detectFileInfo — UTF-8 with BOM", async () => {
        const { Detect } = FileFlow.utils;
        // BOM: EF BB BF + "abc" (61 62 63)
        const file = createMockFile([0xEF, 0xBB, 0xBF, 0x61, 0x62, 0x63]);
        const info = await Detect.detectFileInfo(file);
        
        assert.equal(info.encoding, "UTF-8 (BOM)");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — UTF-16 BE BOM", async () => {
        const { Detect } = FileFlow.utils;
        // BOM: FE FF + "a" (00 61)
        const file = createMockFile([0xFE, 0xFF, 0x00, 0x61]);
        const info = await Detect.detectFileInfo(file);
        
        assert.equal(info.encoding, "UTF-16 BE");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — UTF-16 LE BOM", async () => {
        const { Detect } = FileFlow.utils;
        // BOM: FF FE + "a" (61 00)
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
        // "あ" (E3 81 82)
        const file = createMockFile([0xE3, 0x81, 0x82]);
        const info = await Detect.detectFileInfo(file);
        
        assert.equal(info.encoding, "UTF-8");
        assert.equal(info.isBinary, false);
    });

    test("Detect.detectFileInfo — Shift_JIS (Japanese)", async () => {
        const { Detect } = FileFlow.utils;
        // "あ" in Shift_JIS: 82 A0
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
    // 3. Action System Tests
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

    test("RenameAction — execute", async () => {
        const { RenameAction } = FileFlow.actions;
        const State = FileFlow.state;

        // Reset state
        State.entryMetadata = {};
        State.appSettings.viewMode = 'tree';

        const actionMd = new RenameAction(".md");
        const file = createMockFileEntry("test.txt", "/root/test.txt", []);

        // Mock DOM element
        const nameSpan = { textContent: "test.txt" };
        const mockDiv = {
            classList: {
                add(cls) { mockDiv.classes.push(cls); }
            },
            querySelector(selector) {
                if (selector === '.file-name') return nameSpan;
                return null;
            },
            classes: [],
            downloadName: ""
        };

        await actionMd.execute(mockDiv, file);

        // Verification
        assert.equal(State.entryMetadata["/root/test.txt"].newFilename, "test.txt.md");
        assert.equal(nameSpan.textContent, "test.txt.md");
        assert.ok(mockDiv.classes.includes("renamed"));
        assert.equal(mockDiv.downloadName, "test.txt.md");
    });

    test("DetectAction — shouldApply", () => {
        const { DetectAction } = FileFlow.actions;
        const action = new DetectAction();

        const file = createMockFileEntry("test.txt", "/root/test.txt", []);
        const dir = createMockDirectoryEntry("docs", "/root/docs");

        assert.ok(action.shouldApply(file));
        assert.ok(!action.shouldApply(dir));
    });

    test("DetectAction — execute", async () => {
        const { DetectAction } = FileFlow.actions;
        const State = FileFlow.state;

        // Reset state
        State.entryMetadata = {};

        const action = new DetectAction();
        // File containing ascii content and LF newlines
        const file = createMockFileEntry("test.txt", "/root/test.txt", [0x61, 0x0A, 0x62]);

        // Mock DOM element and document setup
        const nameSpan = {
            textContent: "test.txt",
            after(badgeElement) {
                mockDiv.badges.push(badgeElement);
            }
        };
        const mockDiv = {
            querySelectorAll(selector) {
                if (selector === '.info-badge') {
                    return {
                        forEach(cb) {
                            mockDiv.badges.forEach(cb);
                            mockDiv.badges = [];
                        }
                    };
                }
                return [];
            },
            querySelector(selector) {
                if (selector === '.file-name') return nameSpan;
                return null;
            },
            badges: []
        };

        // Standard document creation mock for badge creation
        const oldCreateElement = typeof document !== 'undefined' ? document.createElement : null;
        if (typeof document !== 'undefined') {
            document.createElement = (tag) => {
                return {
                    style: {},
                    textContent: "",
                    className: ""
                };
            };
        }

        try {
            await action.execute(mockDiv, file);

            // Verification
            assert.ok(State.entryMetadata["/root/test.txt"].detectionInfo);
            assert.equal(State.entryMetadata["/root/test.txt"].detectionInfo.encoding, "ASCII");
            assert.equal(State.entryMetadata["/root/test.txt"].detectionInfo.eol, "LF");

            if (oldCreateElement) {
                // Verified HTML elements are added
                assert.equal(mockDiv.badges.length, 2);
                assert.equal(mockDiv.badges[0].textContent, "LF");
                assert.equal(mockDiv.badges[1].textContent, "ASCII");
            }
        } finally {
            if (oldCreateElement) {
                document.createElement = oldCreateElement;
            }
        }
    });

    // ==========================================
    // 4. Utility Tests
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

    test("utils.formatDate", () => {
        const { formatDate } = FileFlow.utils;
        assert.equal(formatDate(null), "-");
        assert.equal(formatDate(undefined), "-");
        assert.equal(formatDate(""), "-");
        
        const testDateStr = "2026-07-15T14:50:00.000Z";
        const expected = new Date(testDateStr).toLocaleString();
        assert.equal(formatDate(testDateStr), expected);
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
