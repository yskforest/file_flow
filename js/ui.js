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
    const FileSystem = FileFlow.utils.FileSystem;

    const fileList = document.getElementById('file-list');
    const fileListContainer = document.getElementById('file-list-container');
    const dropZone = document.getElementById('drop-zone');

    // Create Tree Element (Lazy or Filtered)
    async function createTreeElement(entry, matcher) {
        const hasFilter = !!matcher;

        // Filter Logic Early Reject for Files
        if (hasFilter && !entry.isDirectory) {
            if (!matcher(entry.name)) return null;
        }

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
        }

        // Append Item Row
        li.appendChild(itemDiv);

        // Container for children
        if (entry.isDirectory) {
            const ul = document.createElement('ul');
            ul.className = 'nested';
            li.appendChild(ul);

            // AUTO-LOAD if Filter is Active
            if (hasFilter) {
                // Force load children
                await loadChildren(li, entry, matcher);

                // Check if any children matches
                const hasVisibleChildren = ul.children.length > 0;
                const isSelfMatch = matcher(entry.name);

                if (!hasVisibleChildren && !isSelfMatch) {
                    return null; // Hide this folder
                }

                if (hasVisibleChildren) {
                    ul.classList.add('expanded');
                    itemDiv.classList.add('open');
                    itemDiv.setAttribute('data-loaded', 'true');
                    const arrow = itemDiv.querySelector('.arrow');
                    if (arrow) arrow.textContent = '▶';
                }
            }
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
                // Load children (Lazy)
                const arrow = itemDiv.querySelector('.arrow');
                if (arrow) arrow.textContent = '...';

                // Use shared matcher
                const matcher = FileFlow.utils.Glob.createMatcher(FileFlow.state.searchQuery);
                await loadChildren(li, itemDiv.entry, matcher);

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

    async function loadChildren(li, entry, matcher) {
        const ul = li.querySelector('.nested');
        if (!ul) return;

        // Use Shared Reader
        const children = await FileSystem.readDir(entry);

        // Sort
        children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        const fragment = document.createDocumentFragment();
        for (const child of children) {
            if (shouldInclude(child)) {
                // Recurse with matcher
                const childElement = await createTreeElement(child, matcher);
                if (childElement) fragment.appendChild(childElement);
            }
        }
        ul.appendChild(fragment);
    }

    async function renderFlatList(matcher) {
        // Collect all files recursively
        const files = [];

        // Simple customized traversal for flat list path-tracking
        async function traverseWithPaths(entry, path) {
            if (FileFlow.state.appSettings.excludeDots && entry.name.startsWith('.')) return;

            if (entry.isFile) {
                files.push({ entry, path: path + entry.name });
            } else if (entry.isDirectory) {
                const children = await FileSystem.readDir(entry);
                for (const child of children) {
                    await traverseWithPaths(child, path + entry.name + '/');
                }
            }
        }

        for (const root of FileFlow.state.currentRootEntries) {
            await traverseWithPaths(root, '');
        }

        files.sort((a, b) => a.path.localeCompare(b.path));

        const fragment = document.createDocumentFragment();

        for (const item of files) {
            if (matcher && !matcher(item.path)) continue; // Filter Path

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

        // Prepare Matcher
        const matcher = FileFlow.utils.Glob.createMatcher(FileFlow.state.searchQuery);

        if (FileFlow.state.currentRootEntries.length > 0) {
            if (fileListContainer) fileListContainer.classList.remove('hidden');
            if (dropZone) dropZone.classList.add('hidden');

            if (FileFlow.state.appSettings.viewMode === 'tree') {
                const shouldAutoExpand = FileFlow.state.currentRootEntries.length === 1 && FileFlow.state.currentRootEntries[0].isDirectory;

                for (const entry of FileFlow.state.currentRootEntries) {
                    if (shouldInclude(entry)) {
                        const element = await createTreeElement(entry, matcher);
                        if (element) {
                            list.appendChild(element);

                            // Manual auto-expand if no filter and single root
                            if (!matcher && shouldAutoExpand) {
                                const itemDiv = element.querySelector('.item.folder-toggle');
                                if (itemDiv) {
                                    await toggleFolder(itemDiv);
                                }
                            }
                        }
                    }
                }
            } else {
                await renderFlatList(matcher);
            }

        } else {
            if (fileListContainer) fileListContainer.classList.add('hidden');
            if (dropZone) dropZone.classList.remove('hidden');
        }
    }

    function applyFilter() {
        // Just trigger render, logic is inside render now
        renderFileList();
    }

    FileFlow.ui.Render = {
        renderFileList: renderFileList,
        applyFilter: applyFilter
    };

})();
