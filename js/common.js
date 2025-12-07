// Core Application Namespace
window.FileFlow = {
    state: {
        currentRootEntries: [],
        appSettings: {
            viewMode: 'tree', // 'tree' or 'list'
            actionMode: 'md',   // 'md', 'txt', 'detect'
            excludeDots: true
        },
        entryMetadata: {}, // Persist action results by fullPath
        searchQuery: ''
    },
    actions: {}, // Registry for actions
    ui: {},      // UI Helpers
    utils: {}    // Utilities
};

// Glob Matching Utility
(function () {
    function globToRegex(glob) {
        let regexString = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        regexString = regexString.replace(/\*/g, '.*');
        regexString = regexString.replace(/\?/g, '.');
        return new RegExp('^' + regexString + '$', 'i');
    }

    function createMatcher(query) {
        if (!query || query.trim() === '') return null;
        const patterns = query.split(/[\s,]+/).filter(s => s.length > 0);
        const includePatterns = patterns.filter(p => !p.startsWith('!')).map(p => globToRegex(p));
        const excludePatterns = patterns.filter(p => p.startsWith('!')).map(p => globToRegex(p.slice(1)));

        return (name) => {
            for (const regex of excludePatterns) if (regex.test(name)) return false;
            if (includePatterns.length === 0) return true;
            for (const regex of includePatterns) if (regex.test(name)) return true;
            return false;
        };
    }

    FileFlow.utils.Glob = {
        globToRegex: globToRegex,
        createMatcher: createMatcher
    };
})();

// FileSystem Utilities
(function () {

    // Read a file as Text
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsText(file);
        });
    }

    // Read a file slice as ArrayBuffer
    function readFileSliceAsArrayBuffer(file, start, end) {
        const slice = file.slice(start, end);
        return slice.arrayBuffer();
    }

    // Read Directory Entries (Async Iterator would be nice, but Promise array is fine)
    async function readDir(entry) {
        if (!entry.isDirectory) return [];
        const reader = entry.createReader();
        let entries = [];
        let done = false;
        while (!done) {
            try {
                const results = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
                if (results.length === 0) done = true;
                else entries = entries.concat(results);
            } catch (e) { done = true; }
        }
        return entries;
    }

    /*
     * Generic Deep Traversal
     * @param {Array|Object} roots - Root entry or array of entries
     * @param {Function} visitFn - async (entry) => boolean|void. Return false to stop recursion into folder.
     * @param {Object} options - { excludeDots: boolean }
     */
    async function traverse(roots, visitFn, options = {}) {
        const entries = Array.isArray(roots) ? roots : [roots];

        for (const entry of entries) {
            if (options.excludeDots && entry.name.startsWith('.')) continue;

            const shouldRecurse = await visitFn(entry);

            if (entry.isDirectory && shouldRecurse !== false) {
                const children = await readDir(entry);
                await traverse(children, visitFn, options);
            }
        }
    }

    FileFlow.utils.FileSystem = {
        readFileAsText: readFileAsText,
        readFileSliceAsArrayBuffer: readFileSliceAsArrayBuffer,
        readDir: readDir,
        traverse: traverse
    };
})();

// Zip Utility
(function () {

    // Dependencies: JSZip (global), FileFlow.state

    async function downloadZip() {
        const zip = new JSZip();
        const fileList = document.getElementById('file-list');
        const currentRootEntries = FileFlow.state.currentRootEntries;

        if (!fileList) return;

        if (FileFlow.state.appSettings.viewMode === 'list') {
            const items = Array.from(fileList.children).filter(li => !li.classList.contains('filtered-out'));
            for (const li of items) {
                const itemDiv = li.querySelector('.item');
                const entry = itemDiv.entry;

                const nameSpan = itemDiv.querySelector('.file-name');
                const docPath = nameSpan.textContent;

                await new Promise(resolve => {
                    entry.file(file => {
                        zip.file(docPath, file);
                        resolve();
                    });
                });
            }
        } else {
            const rootItems = Array.from(fileList.children).filter(li => !li.classList.contains('filtered-out'));
            for (const li of rootItems) {
                await addToZip(li, zip);
            }
        }

        let zipFilename = "files.zip";
        if (currentRootEntries.length === 1) {
            zipFilename = `${currentRootEntries[0].name}.zip`;
        }

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function addToZip(li, zipFolder) {
        if (li.classList.contains('filtered-out')) return;

        const itemDiv = li.querySelector('.item');
        if (!itemDiv) return;

        const entry = itemDiv.entry;
        const name = itemDiv.downloadName || entry.name;

        if (entry.isDirectory) {
            const newFolder = zipFolder.folder(name);
            const nestedUl = li.querySelector('.nested');
            if (nestedUl) {
                const children = Array.from(nestedUl.children);
                for (const childLi of children) {
                    await addToZip(childLi, newFolder);
                }
            }
        } else {
            await new Promise((resolve) => {
                entry.file((file) => {
                    zipFolder.file(name, file);
                    resolve();
                });
            });
        }
    }

    FileFlow.utils.Zip = {
        downloadZip: downloadZip
    };

})();
