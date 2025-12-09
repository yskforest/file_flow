(function () {
    const statusToast = document.getElementById('status-toast');
    const statusText = document.getElementById('status-text');
    const dropZone = document.getElementById('drop-zone');
    const fileListContainer = document.getElementById('file-list-container');

    let gridInstance = null;
    let originalGridData = []; // Store full dataset locally for filtering

    function showStatus(message, isLoading = false) {
        if (!statusToast || !statusText) return;
        statusText.textContent = message;
        statusToast.classList.remove('hidden');
        const spinner = statusToast.querySelector('.spinner');
        if (spinner) {
            spinner.style.display = isLoading ? 'block' : 'none';
        }

        // Auto hide after 3s if not loading
        if (!isLoading) {
            setTimeout(() => {
                statusToast.classList.add('hidden');
            }, 3000);
        }
    }

    function createTreeElement(entry, matcher = null) {
        const li = document.createElement('li');
        // Filter logic for Tree View
        if (matcher && !entry.isDirectory && !matcher(entry.name)) {
            // If file and matches filter -> show. If not -> return null.
        }

        const itemDiv = document.createElement('div');
        itemDiv.className = 'item';

        // Icon
        const icon = document.createElement('i');
        icon.className = entry.isDirectory ? 'fas fa-folder folder-icon' : 'far fa-file file-icon';
        itemDiv.appendChild(icon);

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = entry.name;
        itemDiv.appendChild(nameSpan);

        li.appendChild(itemDiv);

        if (entry.isDirectory) {
            itemDiv.classList.add('folder-toggle');
            // Arrow
            const arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.innerHTML = '&#9656;'; // Right triangle
            itemDiv.prepend(arrow);

            const childrenContainer = document.createElement('ul');
            childrenContainer.className = 'nested';
            li.appendChild(childrenContainer);

            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFolder(itemDiv);
            });

            // Mark as loaded/unloaded
            li.dataset.loaded = 'false';
            li.entry = entry; // Attach entry for lazy loading
        } else {
            itemDiv.classList.add('file-item');
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                // Select file action
                FileFlow.actions.execute(entry);
            });
        }

        return li;
    }

    async function toggleFolder(itemDiv) {
        const li = itemDiv.parentElement;
        const arrow = itemDiv.querySelector('.arrow');
        const childrenContainer = li.querySelector('.nested');
        const entry = li.entry;

        if (childrenContainer.classList.contains('expanded')) {
            // Collapse
            childrenContainer.classList.remove('expanded');
            itemDiv.classList.remove('open');
            arrow.style.transform = 'rotate(0deg)';
        } else {
            // Expand
            if (li.dataset.loaded === 'false') {
                await loadChildren(entry, childrenContainer);
                li.dataset.loaded = 'true';
            }
            childrenContainer.classList.add('expanded');
            itemDiv.classList.add('open');
            arrow.style.transform = 'rotate(90deg)';
        }
    }

    async function loadChildren(directoryEntry, container) {
        container.innerHTML = ''; // Clear placeholders
        const entries = await FileFlow.utils.FileSystem.readDir(directoryEntry);

        // Sort: Folders first, then files
        entries.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) {
                return a.name.localeCompare(b.name);
            }
            return a.isDirectory ? -1 : 1;
        });

        const matcher = FileFlow.utils.Glob.createMatcher(FileFlow.state.searchQuery);

        for (const child of entries) {
            if (shouldInclude(child)) {
                const el = await createTreeElement(child, matcher);
                if (el) container.appendChild(el);
            }
        }
    }

    // --- Flat List (Grid.js) Logic ---

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function formatDate(date) {
        if (!date) return '-';
        return new Date(date).toLocaleString();
    }

    // Custom Filter Logic for Grid.js
    function filterGridDataType(typeFilter) {
        if (!gridInstance) return;

        let filtered = originalGridData;
        if (typeFilter && typeFilter !== "") {
            filtered = filtered.filter(row => row[3] === typeFilter); // row[3] is Type
        }

        gridInstance.updateConfig({
            data: filtered
        }).forceRender();
    }

    async function renderFlatList(matcher) {
        const list = document.getElementById('file-list');
        if (!list) return;

        list.innerHTML = '';
        list.classList.remove('file-tree');
        list.classList.add('file-grid');

        const fileEntries = [];

        // Recursive collector
        async function traverseWithPaths(entries) {
            for (const entry of entries) {
                if (!shouldInclude(entry)) continue;

                if (entry.isDirectory) {
                    const children = await FileFlow.utils.FileSystem.readDir(entry);
                    await traverseWithPaths(children);
                } else {
                    // Check filter
                    if (matcher && !matcher(entry.name)) continue;
                    fileEntries.push(entry);
                }
            }
        }

        await traverseWithPaths(FileFlow.state.currentRootEntries);

        // Prepare Data for Grid.js
        const gridData = [];
        await Promise.all(fileEntries.map(async (item) => {
            let size = 0;
            let date = null;
            let type = item.name.split('.').pop();
            if (type === item.name) type = ''; // No extension

            try {
                const file = await item.getFile();
                size = file.size;
                date = file.lastModified;
            } catch (e) { console.warn("Metadata read error", e); }

            gridData.push([
                item.name,
                size,
                date,
                type
            ]);
        }));

        // Store Original Data for Filtering
        originalGridData = gridData;

        if (gridInstance) {
            // Grid.js cleanup if needed
        }

        const gridWrapper = document.createElement('div');
        list.appendChild(gridWrapper);

        // Generate Type Options for Dropdown
        const uniqueTypes = [...new Set(gridData.map(r => r[3]))].sort();
        const typeOptions = uniqueTypes.map(t => `<option value="${t}">${t || '(None)'}</option>`).join('');

        // Custom Header HTML for Type
        const typeHeaderHtml = `
            <div style="display:flex; align-items:center; justify-content:space-between;">
                Type
                <select 
                    onclick="event.stopPropagation()" 
                    onchange="FileFlow.ui.Render.onTypeFilterChange(this.value)"
                    style="
                        background-color: var(--bg-color); 
                        color: var(--text-primary); 
                        border: 1px solid var(--border-color); 
                        border-radius: 4px; 
                        padding: 2px; 
                        font-size: 0.75rem;
                        margin-left: 5px;
                        max-width: 80px;
                    "
                >
                    <option value="">All</option>
                    ${typeOptions}
                </select>
            </div>
        `;

        gridInstance = new gridjs.Grid({
            columns: [
                {
                    name: 'Name',
                    width: '50%',
                    formatter: (cell) => gridjs.html(`<span class="grid-filename" title="${cell}">${cell}</span>`)
                },
                {
                    name: 'Size',
                    width: '15%',
                    formatter: (cell) => formatBytes(cell)
                },
                {
                    name: 'Date',
                    width: '25%',
                    formatter: (cell) => formatDate(cell)
                },
                {
                    name: gridjs.html(typeHeaderHtml),
                    id: 'Type',
                    width: '15%',
                    sort: false // Disable sort on header click for this column
                }
            ],
            data: gridData,
            search: true,
            sort: true,
            pagination: { limit: 20 },
            style: {
                table: { 'width': '100%' },
                th: {
                    'background-color': 'var(--bg-secondary)',
                    'color': 'var(--text-primary)',
                    'border': '1px solid var(--border-color)'
                },
                td: {
                    'background-color': 'var(--bg-primary)',
                    'color': 'var(--text-secondary)',
                    'border': '1px solid var(--border-color)'
                }
            },
            className: {
                table: 'custom-grid-table',
                th: 'custom-grid-th',
                td: 'custom-grid-td'
            }
        }).render(gridWrapper);
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
                            if (!matcher && shouldAutoExpand) {
                                const itemDiv = element.querySelector('.item.folder-toggle');
                                if (itemDiv) await toggleFolder(itemDiv);
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
        renderFileList();
    }

    // Export to Namespace
    FileFlow.ui.Render = {
        renderFileList: renderFileList,
        applyFilter: applyFilter,
        onTypeFilterChange: filterGridDataType
    };

    // FIX: Renamed from Toast to Status to match main.js usage
    FileFlow.ui.Status = {
        show: showStatus,
        hide: (delay = 0) => {
            if (statusToast) {
                if (delay > 0) {
                    setTimeout(() => statusToast.classList.add('hidden'), delay);
                } else {
                    statusToast.classList.add('hidden');
                }
            }
        },
        error: (message) => showStatus(`Error: ${message}`, false)
    };

    FileFlow.ui.ElementFactory = {
        createTreeElement: createTreeElement
    };

})();
