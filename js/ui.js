// Status UI
(function () {
    const statusToast = document.getElementById('status-toast');
    const statusText = document.getElementById('status-text');

    function showStatus(message) {
        if (statusText) statusText.textContent = message;
        if (statusToast) statusToast.classList.remove('hidden');
    }

    function hideStatus(delay = 0) {
        if (delay > 0) {
            setTimeout(() => {
                if (statusToast) statusToast.classList.add('hidden');
            }, delay);
        } else {
            if (statusToast) statusToast.classList.add('hidden');
        }
    }

    function showError(message) {
        showStatus("Error: " + message);
        setTimeout(() => hideStatus(), 3000);
    }

    FileFlow.ui.Status = {
        show: showStatus,
        hide: hideStatus,
        error: showError
    };
})();

// Render Logic
(function () {

    // Dependencies
    const Glob = FileFlow.utils.Glob;

    const fileList = document.getElementById('file-list');
    const fileListContainer = document.getElementById('file-list-container');
    const dropZone = document.getElementById('drop-zone');

    // Create Tree Element (Lazy)
    async function createTreeElement(entry) {
        const li = document.createElement('li');

        const itemDiv = document.createElement('div');
        itemDiv.className = 'item';
        itemDiv.entry = entry;

        // Icon
        if (entry.isDirectory) {
            itemDiv.innerHTML += `
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
            `;
            itemDiv.classList.add('folder-toggle');
        } else {
            itemDiv.innerHTML += `
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
            `;
            itemDiv.classList.add('file-item');
        }

        // Name
        // Name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';

        // Check for persisted metadata
        const metadata = FileFlow.state.entryMetadata[entry.fullPath] || {};

        // Check for persisted rename
        const displayName = metadata.newFilename || entry.name;
        nameSpan.textContent = displayName;
        itemDiv.appendChild(nameSpan);

        // Check for persisted detection info
        if (metadata.detectionInfo) {
            const { encoding, eol } = metadata.detectionInfo;

            const badgeEnc = document.createElement('span');
            badgeEnc.className = 'info-badge enc';
            badgeEnc.textContent = encoding;
            badgeEnc.style.cssText = "background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; font-family: monospace;";

            const badgeEol = document.createElement('span');
            badgeEol.className = 'info-badge eol';
            badgeEol.textContent = eol;
            badgeEol.style.cssText = "background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 4px; font-family: monospace;";

            itemDiv.appendChild(badgeEnc);
            itemDiv.appendChild(badgeEol);
        }

        if (metadata.newFilename) {
            itemDiv.classList.add('renamed');
            itemDiv.downloadName = metadata.newFilename;
        }

        // Arrow for folders
        if (entry.isDirectory) {
            const arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.textContent = '▶';
            itemDiv.prepend(arrow);

            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFolder(itemDiv);
            });
        } // Close folder setup

        // Append Item Row (Always)
        li.appendChild(itemDiv);

        // If directory, Append Children Container (after item row)
        if (entry.isDirectory) {
            const ul = document.createElement('ul');
            ul.className = 'nested';
            li.appendChild(ul);
        }

        return li;
    }

    async function toggleFolder(itemDiv) {
        const li = itemDiv.parentNode;
        const nested = li.querySelector('.nested');
        if (!nested) return;

        const isExpanded = nested.classList.contains('expanded');

        if (!isExpanded) {
            // Expand
            // Check if loaded
            if (!itemDiv.hasAttribute('data-loaded')) {
                // Load children
                const arrow = itemDiv.querySelector('.arrow');
                if (arrow) arrow.textContent = '...'; // Loading indicator

                await loadChildren(li, itemDiv.entry);

                itemDiv.setAttribute('data-loaded', 'true');
                if (arrow) arrow.textContent = '▶';
            }
            nested.classList.add('expanded');
            itemDiv.classList.add('open');
        } else {
            // Collapse
            nested.classList.remove('expanded');
            itemDiv.classList.remove('open');
        }
    }

    async function loadChildren(li, entry) {
        const ul = li.querySelector('.nested');
        if (!ul) return;

        const reader = entry.createReader();
        const readEntries = async () => {
            let allEntries = [];
            let finished = false;

            while (!finished) {
                const batch = await new Promise((resolve, reject) => {
                    reader.readEntries(resolve, reject);
                });
                if (batch.length === 0) {
                    finished = true;
                } else {
                    allEntries = allEntries.concat(batch);
                }
            }
            return allEntries;
        };

        const children = await readEntries();
        // Sort
        children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        const fragment = document.createDocumentFragment();
        for (const child of children) {
            if (shouldInclude(child)) {
                // Recursive call (createTreeElement is now lazy/synchronous-ish structure creation)
                const childElement = await createTreeElement(child);
                if (childElement) fragment.appendChild(childElement);
            }
        }
        ul.appendChild(fragment);
    }

    async function renderFlatList() {
        // Collect all files recursively
        const files = [];
        for (const root of FileFlow.state.currentRootEntries) {
            await traverseFiles(root, '', files);
        }

        files.sort((a, b) => a.path.localeCompare(b.path));

        // Use Fragment for perfo
        const fragment = document.createDocumentFragment();

        for (const item of files) {
            const li = document.createElement('li');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'item file-item';
            itemDiv.entry = item.entry;

            itemDiv.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
                <span class="file-name">${item.path}</span>
             `;
            li.appendChild(itemDiv);
            fragment.appendChild(li);
        }

        const list = document.getElementById('file-list');
        if (list) list.appendChild(fragment);
    }

    async function traverseFiles(entry, path, list) {
        if (!shouldInclude(entry)) return;

        if (entry.isFile) {
            list.push({ entry: entry, path: path + entry.name });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const readAll = async () => {
                let entries = [];
                let done = false;
                while (!done) {
                    const results = await new Promise(resolve => reader.readEntries(resolve));
                    if (results.length === 0) done = true;
                    else entries = entries.concat(results);
                }
                return entries;
            }

            const children = await readAll();
            for (const child of children) {
                await traverseFiles(child, path + entry.name + '/', list);
            }
        }
    }

    function shouldInclude(entry) {
        if (FileFlow.state.appSettings.excludeDots && entry.name.startsWith('.')) {
            return false;
        }
        return true;
    }

    async function renderFileList() {
        const list = document.getElementById('file-list');
        if (!list) return;

        list.innerHTML = '';

        if (FileFlow.state.currentRootEntries.length > 0) {
            if (fileListContainer) fileListContainer.classList.remove('hidden');
            if (dropZone) dropZone.classList.add('hidden');

            if (FileFlow.state.appSettings.viewMode === 'tree') {
                const shouldAutoExpand = FileFlow.state.currentRootEntries.length === 1 && FileFlow.state.currentRootEntries[0].isDirectory;

                for (const entry of FileFlow.state.currentRootEntries) {
                    if (shouldInclude(entry)) {
                        const element = await createTreeElement(entry);
                        if (element) {
                            list.appendChild(element); // Append first

                            if (shouldAutoExpand) {
                                const itemDiv = element.querySelector('.item.folder-toggle');
                                if (itemDiv) {
                                    // Trigger toggle to load contents
                                    await toggleFolder(itemDiv);
                                }
                            }
                        }
                    }
                }
            } else {
                await renderFlatList();
            }

            // Re-apply filter if exists
            applyFilter();

        } else {
            if (fileListContainer) fileListContainer.classList.add('hidden');
            if (dropZone) dropZone.classList.remove('hidden');
        }
    }

    function applyFilter() {
        const query = FileFlow.state.searchQuery;
        const input = document.getElementById('filter-input');

        // If query is empty, show all
        if (!query || query.trim() === '') {
            const allLi = document.querySelectorAll('#file-list li');
            allLi.forEach(li => {
                li.classList.remove('filtered-out');
                // Don't modify expanded state on clear? Or collpase all?
                // Let's leave state as is.
            });
            return;
        }

        const patterns = query.split(/[\s,]+/).filter(s => s.length > 0);
        const includePatterns = patterns.filter(p => !p.startsWith('!')).map(p => Glob.globToRegex(p));
        const excludePatterns = patterns.filter(p => p.startsWith('!')).map(p => Glob.globToRegex(p.slice(1)));

        // Helper to check match
        const matches = (name) => {
            // Exclude check
            for (const regex of excludePatterns) {
                if (regex.test(name)) return false;
            }
            // Include check
            if (includePatterns.length === 0) return true; // If no include patterns, everything matches (unless excluded)

            for (const regex of includePatterns) {
                if (regex.test(name)) return true;
            }
            return false;
        };

        const list = document.getElementById('file-list');
        if (!list) return;

        // Recursive visibility check for Tree Mode
        // For flat list, it's simple iteration.

        if (FileFlow.state.appSettings.viewMode === 'list') {
            const lis = Array.from(list.children);
            lis.forEach(li => {
                const nameSpan = li.querySelector('.file-name');
                const name = nameSpan ? nameSpan.textContent : '';
                if (matches(name)) {
                    li.classList.remove('filtered-out');
                } else {
                    li.classList.add('filtered-out');
                }
            });
        } else {
            // Tree Mode is tricky. 
            // We need to traverse DOM tree.
            // If a child matches, all parents must be visible and expanded.

            // First hide everything? No, let's iterate.

            // We will do a bottom-up check or recursive check on DOM?
            // Let's do recursive check on the DOM roots.
            const roots = Array.from(list.children); // top level styling li

            roots.forEach(rootLi => checkVisibility(rootLi));
        }

        function checkVisibility(li) {
            const itemDiv = li.querySelector('.item');
            const name = itemDiv.querySelector('.file-name').textContent;
            const nestedUl = li.querySelector('.nested');

            let isSelfMatch = matches(name);
            let hasVisibleChild = false;

            if (nestedUl) {
                const childLis = Array.from(nestedUl.children);
                childLis.forEach(child => {
                    if (checkVisibility(child)) {
                        hasVisibleChild = true;
                    }
                });
            }

            // Folder logic: Visible if self matches OR has visible child.
            // File logic: Visible if self matches.

            // NOTE: In tree view, usually we match files. If we match a folder name "src", do we show all children?
            // Implementation detail: If folder matches, we act as if it's a match.

            let isVisible = isSelfMatch || hasVisibleChild;

            if (isVisible) {
                li.classList.remove('filtered-out');
                // Auto expand if it's a folder containing visible children (and we are filtering)
                // If it's just self, maybe not expand?
                // Let's expand if hasVisibleChild to show the matches.
                if (hasVisibleChild && nestedUl) {
                    nestedUl.classList.add('expanded');
                    itemDiv.classList.add('open');
                }
            } else {
                li.classList.add('filtered-out');
            }

            return isVisible;
        }

    }

    FileFlow.ui.Render = {
        renderFileList: renderFileList,
        applyFilter: applyFilter
    };

})();
