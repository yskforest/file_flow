document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');
    const clearBtn = document.getElementById('clear-btn');
    const applyBtn = document.getElementById('apply-btn');
    const downloadZipBtn = document.getElementById('download-zip-btn');
    const modeDisplayBtn = document.getElementById('mode-display-btn');

    // Filter
    const filterInput = document.getElementById('filter-input');

    // Buttons
    const settingsBtn = document.getElementById('settings-btn');
    const statsBtn = document.getElementById('stats-btn');
    const viewToggleBtn = document.getElementById('view-toggle-btn');
    const viewIconTree = document.getElementById('view-icon-tree');
    const viewIconList = document.getElementById('view-icon-list');

    // Modals & Status
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const statsModal = document.getElementById('stats-modal');
    const closeStatsBtn = document.getElementById('close-stats-btn');
    const statsContent = document.getElementById('stats-content');

    // Status Toast
    const statusToast = document.getElementById('status-toast');
    const statusText = document.getElementById('status-text');
    const statusSpinner = document.querySelector('#status-toast .spinner');

    // Settings
    const excludeDotsCheckbox = document.getElementById('exclude-dots-checkbox');
    const actionModeRadios = document.getElementsByName('action-mode');

    // App State
    let currentRootEntries = [];
    const appSettings = {
        excludeDotFiles: true,
        actionMode: 'md',
        viewMode: 'tree'
    };

    // Initialize
    updateModeDisplay();

    // --- Status Helpers ---
    let statusTimeout;

    function showStatus(message, showSpinner = true) {
        clearTimeout(statusTimeout);
        statusText.textContent = message;
        if (showSpinner) {
            statusSpinner.style.display = 'block';
        } else {
            statusSpinner.style.display = 'none';
        }
        statusToast.classList.remove('hidden');
    }

    function hideStatus(delay = 1000) {
        statusTimeout = setTimeout(() => {
            statusToast.classList.add('hidden');
        }, delay);
    }

    function showError(message) {
        showStatus(message, false);
        if (statusSpinner) statusSpinner.style.display = 'none';

        // Auto hide after longer delay
        hideStatus(4000);
    }

    // --- Glob Logic ---
    function globToRegex(glob) {
        // Simple implementation of glob patterns
        // Support: * (wildcard), ? (single char), relative paths
        // Special case: **/ for recursive (simplified)

        // Escape regex special chars except * and ?
        let regexStr = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');

        // Replace wildcards
        regexStr = regexStr.replace(/\*/g, '.*');
        regexStr = regexStr.replace(/\?/g, '.');

        // Support directory boundaries if needed? 
        // For now, simpler match is usually better for users.
        return new RegExp('^' + regexStr + '$', 'i'); // Case insensitive
    }

    // Debounce for filter
    let debounceTimer;
    if (filterInput) {
        filterInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                applyFilter(e.target.value);
            }, 300);
        });
    }

    function applyFilter(query) {
        const rawPatterns = query.split(/[\s,]+/).filter(p => p.trim() !== '');

        const includePatterns = [];
        const excludePatterns = [];

        rawPatterns.forEach(p => {
            if (p.startsWith('!')) {
                excludePatterns.push(globToRegex(p.substring(1)));
            } else {
                includePatterns.push(globToRegex(p));
            }
        });

        // If no includes, assume match all (unless excluded)
        const matchAll = includePatterns.length === 0;

        const allItems = fileList.querySelectorAll('.item'); // All items including folders?
        // Wait, filter applies to FILES usually.
        // If a file matches, its parents should be visible.

        // Strategy: 
        // 1. Reset: Remove .filtered-out from everything.
        // 2. Hide everything (add .filtered-out).
        // 3. Scan files. If match -> show file AND show all parents.

        // But folders need to be considered. 
        // Ideally, we traverse the DOM structure.

        const allLis = fileList.querySelectorAll('li');

        if (rawPatterns.length === 0) {
            allLis.forEach(li => li.classList.remove('filtered-out'));
            return;
        }

        // Hide all LIs initially
        allLis.forEach(li => li.classList.add('filtered-out'));

        // Find all file items (leaves)
        const fileItems = fileList.querySelectorAll('.item.file-item');

        fileItems.forEach(item => {
            const entry = item.entry;
            const fullPath = getFullPath(item); // We need a way to get full path for trees

            // Check Excludes
            let exclude = false;
            for (const regex of excludePatterns) {
                if (regex.test(fullPath) || regex.test(item.downloadName)) {
                    exclude = true;
                    break;
                }
            }
            if (exclude) return; // Keep hidden

            // Check Includes
            let include = matchAll;
            if (!matchAll) {
                for (const regex of includePatterns) {
                    if (regex.test(fullPath) || regex.test(item.downloadName)) {
                        include = true;
                        break;
                    }
                }
            }

            if (include) {
                // Show this item's LI using parentElement
                // Structure: li > div.item
                const li = item.parentElement;
                li.classList.remove('filtered-out');

                // Show parents (Walk up DOM)
                let parent = li.parentElement; // ul.nested or file-list
                while (parent && parent !== fileList) {
                    if (parent.tagName === 'UL' && parent.classList.contains('nested')) {
                        // Expand the UL
                        parent.classList.add('expanded');
                        // Show the parent LI of this UL
                        const parentLi = parent.parentElement;
                        parentLi.classList.remove('filtered-out');

                        // Ensure the folder item is marked as open
                        const folderItem = parentLi.querySelector('.item.folder-toggle');
                        if (folderItem) folderItem.classList.add('open');
                    }
                    parent = parent.parentElement;
                }
            }
        });
    }

    function getFullPath(itemDiv) {
        if (appSettings.viewMode === 'list') {
            const nameSpan = itemDiv.querySelector('.file-name');
            return nameSpan.textContent;
        } else {
            // Traverse up for tree view? 
            // Or just use name? 
            // Users often filter by extension: *.js
            // If they want path search: src/*.js
            // We need path.
            // Let's rely on constructing path from DOM or entry?
            // Entry has `fullPath` property in FileSystem API!
            return itemDiv.entry.fullPath.substring(1); // Remove leading /
        }
    }

    // --- Event Listeners ---

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const items = e.dataTransfer.items;
        if (items) {
            // Capture entries IMMEDIATELY before any await
            // DataTransfer items are only valid during the event
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) entries.push(entry);
            }

            try {
                showStatus("Scanning files...");
                await new Promise(r => setTimeout(r, 50));

                await handleEntries(entries);

                hideStatus(500);
            } catch (err) {
                console.error("Drop Handler Error:", err);
                showError("Error scanning files");
            }
        }
    });

    clearBtn.addEventListener('click', () => {
        currentRootEntries = [];
        renderFileList();
        fileListContainer.classList.add('hidden');
        if (filterInput) filterInput.value = '';
    });

    applyBtn.addEventListener('click', async () => {
        try {
            await applyExtensionAction();
            showStatus("Done!", false);
            hideStatus(1500);
        } catch (err) {
            console.error(err);
            showError("Error processing files");
        }
    });

    downloadZipBtn.addEventListener('click', async () => {
        try {
            showStatus("Generating ZIP...");
            await new Promise(r => setTimeout(r, 50));
            await downloadZip();
            showStatus("Done!", false);
            hideStatus(1500);
        } catch (err) {
            console.error(err);
            showError("Error generating ZIP");
        }
    });

    viewToggleBtn.addEventListener('click', async () => {
        try {
            appSettings.viewMode = appSettings.viewMode === 'tree' ? 'list' : 'tree';

            if (appSettings.viewMode === 'tree') {
                viewIconTree.classList.remove('hidden');
                viewIconList.classList.add('hidden');
            } else {
                viewIconTree.classList.add('hidden');
                viewIconList.classList.remove('hidden');
            }

            showStatus("Switching view...");
            await new Promise(r => setTimeout(r, 10));
            await renderFileList();

            // Re-apply filter if exists
            if (filterInput && filterInput.value) {
                applyFilter(filterInput.value);
            }

            hideStatus(0);
        } catch (e) {
            console.error(e);
            hideStatus(0);
        }
    });

    // Settings Modal
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    if (modeDisplayBtn) {
        modeDisplayBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });
    }

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });

    // Stats Modal
    statsBtn.addEventListener('click', async () => {
        try {
            showStatus("Calculating stats...");
            await new Promise(r => setTimeout(r, 10));
            await showStats();
            hideStatus(0);
            statsModal.classList.remove('hidden');
        } catch (e) {
            console.error(e);
            showError("Error calculating stats");
        }
    });

    closeStatsBtn.addEventListener('click', () => {
        statsModal.classList.add('hidden');
    });

    statsModal.addEventListener('click', (e) => {
        if (e.target === statsModal) {
            statsModal.classList.add('hidden');
        }
    });

    // Settings Changes
    excludeDotsCheckbox.addEventListener('change', (e) => {
        appSettings.excludeDotFiles = e.target.checked;
        renderFileList();
    });

    Array.from(actionModeRadios).forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                appSettings.actionMode = e.target.value;
                updateModeDisplay();
            }
        });
    });


    // --- Core Logic ---

    function updateModeDisplay() {
        if (modeDisplayBtn) {
            const modeText = appSettings.actionMode === 'md' ? 'Add .md' : 'Add .txt';
            modeDisplayBtn.textContent = `Mode: ${modeText}`;
        }
    }

    async function handleEntries(entries) {
        currentRootEntries = entries;
        await renderFileList();
    }

    async function renderFileList() {
        fileList.innerHTML = '';
        if (currentRootEntries.length > 0) {
            fileListContainer.classList.remove('hidden');
            dropZone.classList.add('hidden'); // Hide Drop Zone

            if (appSettings.viewMode === 'tree') {
                const shouldAutoExpand = currentRootEntries.length === 1 && currentRootEntries[0].isDirectory;

                for (const entry of currentRootEntries) {
                    // Tree Element creation is recursive and awaited.
                    if (shouldInclude(entry)) {
                        const element = await createTreeElement(entry);
                        if (element) {
                            if (shouldAutoExpand) {
                                const itemDiv = element.querySelector('.item.folder-toggle');
                                const nestedUl = element.querySelector('.nested');
                                if (itemDiv) itemDiv.classList.add('open');
                                if (nestedUl) nestedUl.classList.add('expanded');
                            }
                            fileList.appendChild(element);
                        }
                    }
                }
            } else {
                await renderFlatList();
            }

        } else {
            fileListContainer.classList.add('hidden');
            dropZone.classList.remove('hidden'); // Show Drop Zone
        }
    }

    // --- Tree Render ---
    async function createTreeElement(entry) {
        if (!shouldInclude(entry)) return null;

        const li = document.createElement('li');
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('item');
        itemDiv.entry = entry;

        const icon = document.createElement('span');
        if (entry.isDirectory) {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
            itemDiv.classList.add('folder-toggle');

            const arrow = document.createElement('span');
            arrow.classList.add('arrow');
            arrow.textContent = '▶';
            itemDiv.prepend(arrow);

            itemDiv.addEventListener('click', async (e) => {
                e.stopPropagation();
                itemDiv.classList.toggle('open');
                const nestedUl = li.querySelector('.nested');
                if (nestedUl) {
                    nestedUl.classList.toggle('expanded');
                }
            });

        } else {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
            itemDiv.classList.add('file-item');
            itemDiv.downloadName = entry.name;

            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadFile(entry, itemDiv.downloadName);
            });
        }

        itemDiv.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('file-name');
        nameSpan.textContent = entry.name;
        itemDiv.appendChild(nameSpan);

        li.appendChild(itemDiv);

        if (entry.isDirectory) {
            const ul = document.createElement('ul');
            ul.classList.add('nested');

            const reader = entry.createReader();
            const readEntries = async () => {
                return new Promise((resolve) => {
                    reader.readEntries(async (entries) => {
                        if (entries.length > 0) {
                            entries.sort((a, b) => {
                                if (a.isDirectory === b.isDirectory) {
                                    return a.name.localeCompare(b.name);
                                }
                                return a.isDirectory ? -1 : 1;
                            });

                            for (const childEntry of entries) {
                                if (shouldInclude(childEntry)) {
                                    // Recursive call
                                    const childElement = await createTreeElement(childEntry);
                                    if (childElement) {
                                        ul.appendChild(childElement);
                                    }
                                }
                            }
                            await readEntries();
                        }
                        resolve();
                    });
                });
            };

            await readEntries();
            li.appendChild(ul);
        }

        return li;
    }

    // --- Flat List Render ---
    async function renderFlatList() {
        const allFiles = [];

        async function traverse(entry, path) {
            if (entry.isDirectory) {
                if (!shouldInclude(entry)) return;
                const reader = entry.createReader();
                const readAll = async () => {
                    return new Promise(resolve => {
                        reader.readEntries(async (entries) => {
                            if (entries.length > 0) {
                                for (const child of entries) {
                                    await traverse(child, path + entry.name + '/');
                                }
                                await readAll();
                            }
                            resolve();
                        });
                    });
                }
                await readAll();
            } else {
                if (shouldInclude(entry)) {
                    allFiles.push({ entry, path: path + entry.name });
                }
            }
        }

        for (const root of currentRootEntries) {
            await traverse(root, '');
        }

        allFiles.sort((a, b) => a.path.localeCompare(b.path));

        const fragment = document.createDocumentFragment();

        for (const fileData of allFiles) {
            const li = document.createElement('li');
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('item', 'file-item');
            itemDiv.style.paddingLeft = '1rem';
            itemDiv.entry = fileData.entry;
            itemDiv.downloadName = fileData.entry.name;

            const icon = document.createElement('span');
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
            itemDiv.appendChild(icon);

            const nameSpan = document.createElement('span');
            nameSpan.classList.add('file-name');
            nameSpan.textContent = fileData.path;
            nameSpan.style.opacity = "0.9";
            itemDiv.appendChild(nameSpan);

            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadFile(fileData.entry, itemDiv.downloadName);
            });

            li.appendChild(itemDiv);
            fragment.appendChild(li);
        }
        fileList.appendChild(fragment);
    }


    function shouldInclude(entry) {
        if (appSettings.excludeDotFiles && entry.name.startsWith('.')) {
            return false;
        }
        return true;
    }

    async function applyExtensionAction() {
        const action = appSettings.actionMode;
        const targetExtension = '.' + action;

        // Only select items that are NOT filtered out
        // The .filtered-out class is on the LI, which is the parent of the .item div
        const allFileItems = Array.from(fileList.querySelectorAll('.item.file-item'));
        const fileItems = allFileItems.filter(item => !item.parentElement.classList.contains('filtered-out'));

        const total = fileItems.length;

        const binaryExtensions = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
            '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov', '.avi',
            '.zip', '.tar', '.gz', '.7z', '.rar',
            '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.dmg',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.ttf', '.otf', '.woff', '.woff2', '.eot'
        ]);

        const BATCH_SIZE = 50;

        for (let i = 0; i < fileItems.length; i += BATCH_SIZE) {
            // Update status every batch
            showStatus(`Processing: ${Math.min(i, total)} / ${total} files...`);

            const batch = fileItems.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async (itemDiv) => {
                const entry = itemDiv.entry;
                if (!entry || entry.isDirectory) return;

                const file = await new Promise(resolve => entry.file(resolve));
                const originalName = file.name;
                const lowercaseName = originalName.toLowerCase();

                // 1. Fast Check
                const lastDotIndex = lowercaseName.lastIndexOf('.');
                if (lastDotIndex !== -1) {
                    const ext = lowercaseName.substring(lastDotIndex);
                    if (binaryExtensions.has(ext)) return;
                }

                // 2. Content Check
                let isText = true;
                try {
                    const slice = file.slice(0, 512);
                    const buffer = await slice.arrayBuffer();
                    const view = new Uint8Array(buffer);
                    for (let j = 0; j < view.length; j++) {
                        if (view[j] === 0) {
                            isText = false;
                            break;
                        }
                    }
                } catch (e) {
                    console.error("Error reading file:", originalName, e);
                    return;
                }

                if (isText && !lowercaseName.endsWith(targetExtension)) {
                    const newName = originalName + targetExtension;

                    const nameSpan = itemDiv.querySelector('.file-name');
                    if (nameSpan) {
                        if (appSettings.viewMode === 'list') {
                            nameSpan.textContent = nameSpan.textContent + targetExtension;
                        } else {
                            nameSpan.textContent = newName;
                        }
                    }
                    itemDiv.classList.add('renamed');
                    itemDiv.downloadName = newName;
                }
            }));

            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function showStats() {
        const stats = {
            totalFiles: 0,
            excludedFiles: 0,
            extensions: {}
        };

        async function count(entry) {
            if (entry.name.startsWith('.')) {
                stats.excludedFiles++;
                if (appSettings.excludeDotFiles) return;
            }

            if (entry.isDirectory) {
                const reader = entry.createReader();
                const readAll = async () => {
                    return new Promise(resolve => {
                        reader.readEntries(async (entries) => {
                            if (entries.length > 0) {
                                for (const child of entries) {
                                    await count(child);
                                }
                                await readAll();
                            }
                            resolve();
                        });
                    });
                }
                await readAll();
            } else {
                if (entry.name.startsWith('.') && appSettings.excludeDotFiles) {
                    return;
                }

                stats.totalFiles++;
                const name = entry.name.toLowerCase();
                const lastDot = name.lastIndexOf('.');
                let ext = '(no extension)';
                if (lastDot !== -1 && lastDot !== 0) {
                    ext = name.substring(lastDot);
                } else if (name.startsWith('.')) {
                    ext = name;
                }

                stats.extensions[ext] = (stats.extensions[ext] || 0) + 1;
            }
        }

        for (const root of currentRootEntries) {
            await count(root);
        }

        renderStatsTable(stats);
    }

    function renderStatsTable(stats) {
        let html = `
            <div class="stats-summary">
                <div class="stat-box">
                    <div class="label">Total Files</div>
                    <div class="value">${stats.totalFiles}</div>
                </div>
                <div class="stat-box">
                    <div class="label">Excluded (Dot)</div>
                    <div class="value">${stats.excludedFiles}</div>
                </div>
            </div>
            <h4>By Extension</h4>
            <div style="max-height: 200px; overflow-y: auto;">
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Extension</th>
                        <th>Count</th>
                    </tr>
                </thead>
                <tbody>
        `;

        const sortedExts = Object.entries(stats.extensions).sort((a, b) => b[1] - a[1]);

        for (const [ext, count] of sortedExts) {
            html += `
                <tr>
                    <td>${ext}</td>
                    <td>${count}</td>
                </tr>
            `;
        }

        html += `</tbody></table></div>`;
        html += `</tbody></table></div>`;
        statsContent.innerHTML = html;
    }


    async function downloadZip() {
        const zip = new JSZip();

        if (appSettings.viewMode === 'list') {
            const items = Array.from(fileList.children).filter(li => !li.classList.contains('filtered-out'));
            for (const li of items) {
                const itemDiv = li.querySelector('.item');
                const entry = itemDiv.entry; // File entry

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

    function downloadFile(fileEntry, fileName) {
        fileEntry.file((file) => {
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
});
