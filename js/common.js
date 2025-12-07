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
        // Escape special regex characters except * and ?
        let regexString = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');

        // Convert * to .*
        regexString = regexString.replace(/\*/g, '.*');

        // Convert ? to .
        regexString = regexString.replace(/\?/g, '.');

        // Anchor start and end
        return new RegExp('^' + regexString + '$', 'i'); // Case insensitive
    }

    FileFlow.utils.Glob = {
        globToRegex: globToRegex
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

    FileFlow.utils.FileSystem = {
        readFileAsText: readFileAsText,
        readFileSliceAsArrayBuffer: readFileSliceAsArrayBuffer
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
