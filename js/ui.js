(function () {
    const statusToast = document.getElementById('status-toast');
    const statusText = document.getElementById('status-text');
    const dropZone = document.getElementById('drop-zone');
    const fileListContainer = document.getElementById('file-list-container');

    let gridInstance = null;
    let originalGridData = []; // Store full dataset locally for filtering
    let currentGridData = []; // Store currently filtered/sorted dataset
    
    let activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] }; // Name, Size, Date, Type, Encode, EOL
    let currentSort = { colIndex: null, direction: 'asc' };
    let currentFilterColIndex = null;

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
        itemDiv.entry = entry; // Expose entry for ActionManager in main.js

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
            itemDiv.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Select file action
                const mode = FileFlow.state.appSettings.actionMode;
                const action = FileFlow.actions.ActionManager.getAction(mode === 'detect' ? 'detect' : '.' + mode);
                if (action && action.shouldApply(entry, entry.name)) {
                    await action.execute(itemDiv, entry);
                }
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

    function getFormattedColumnValue(row, colIndex) {
        // Now row is strictly a raw Array [v1, v2, ...]
        const val = row[colIndex];
        
        if (colIndex === 1) return formatBytes(val);
        if (colIndex === 2) return formatDate(val);
        return String(val || '(None)');
    }

    function toggleFilterMenu(btnElement, colIndex, colName) {
        let menu = document.getElementById('grid-filter-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'grid-filter-menu';
            menu.className = 'filter-popover hidden';
            document.body.appendChild(menu);

            // Close on click outside
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target) && !e.target.closest('.filter-icon-btn')) {
                    menu.classList.add('hidden');
                }
            });
        }

        // If clicking the same open menu, close it
        if (!menu.classList.contains('hidden') && currentFilterColIndex === colIndex) {
            menu.classList.add('hidden');
            return;
        }

        currentFilterColIndex = colIndex;

        // Build a dataset filtered by ALL OTHER active column filters, ignoring THIS column's filter.
        let baseDataForMenu = [...originalGridData];
        for (let c = 0; c < 6; c++) {
            if (c !== colIndex && activeFilters[c] && activeFilters[c].length > 0) {
                baseDataForMenu = baseDataForMenu.filter(row => {
                    const rowVal = getFormattedColumnValue(row, c);
                    return activeFilters[c].includes(String(rowVal));
                });
            }
        }

        // Get unique values from this filtered base data for the current column
        const uniqueValues = [...new Set(baseDataForMenu.map(r => getFormattedColumnValue(r, colIndex)))];
        
        // Sort the unique values depending on column type
        uniqueValues.sort((a,b) => {
            if(a === '(None)') return 1;
            if(b === '(None)') return -1;
            // For Size/Date filters we sort alphabetically by the formatted string for the checkbox list, 
            // the actual Grid sorting will be type-aware.
            return String(a).localeCompare(String(b)); 
        });

        // Current active filters for this column (if empty, assume all selected)
        const activeColFilters = activeFilters[colIndex];
        const isAllSelected = activeColFilters.length === 0 || activeColFilters.length === uniqueValues.length;

        // Build HTML
        let html = `
            <div class="filter-actions">
                <button onclick="FileFlow.ui.Render.sortGridByColumn(${colIndex}, 'asc')" class="text-btn outline">Sort Ascending</button>
                <button onclick="FileFlow.ui.Render.sortGridByColumn(${colIndex}, 'desc')" class="text-btn outline">Sort Descending</button>
            </div>
            <hr class="filter-divider">
            <div class="filter-search-container">
                <input type="text" id="grid-filter-search" class="search-input full-width" placeholder="Search ${colName}..." onkeyup="FileFlow.ui.Render.filterCheckboxes(this.value)">
            </div>
            <div class="filter-bulk-actions">
                <a href="#" onclick="event.preventDefault(); FileFlow.ui.Render.toggleAllCheckboxes(true)">Select All</a> - 
                <a href="#" onclick="event.preventDefault(); FileFlow.ui.Render.toggleAllCheckboxes(false)">Clear</a>
            </div>
            <div class="filter-options-list" id="grid-checkbox-list">
        `;

        uniqueValues.forEach(val => {
            const isChecked = isAllSelected || activeColFilters.includes(val) ? 'checked' : '';
            html += `
                <label class="filter-checkbox-item">
                    <input type="checkbox" value="${val}" ${isChecked}>
                    <span class="type-label" title="${val}">${val}</span>
                </label>
            `;
        });

        html += `
            </div>
            <div class="filter-footer">
                <button onclick="document.getElementById('grid-filter-menu').classList.add('hidden')" class="text-btn outline">Cancel</button>
                <button onclick="FileFlow.ui.Render.applyColumnFilter()" class="text-btn">Apply</button>
            </div>
        `;

        menu.innerHTML = html;

        // Position menu relative to the button
        const rect = btnElement.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY + 8) + 'px';
        menu.style.left = (rect.left + window.scrollX - 200 + rect.width) + 'px'; // Align right edge approximately

        menu.classList.remove('hidden');
        
        // Focus search
        setTimeout(() => {
            const searchInput = document.getElementById('grid-filter-search');
            if (searchInput) searchInput.focus();
        }, 50);
    }

    function toggleAllCheckboxes(check) {
        const list = document.getElementById('grid-checkbox-list');
        if (!list) return;
        const checkboxes = list.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            if (cb.parentElement.style.display !== 'none') {
                cb.checked = check;
            }
        });
    }

    function filterCheckboxes(query) {
        const list = document.getElementById('grid-checkbox-list');
        if (!list) return;
        const labels = list.querySelectorAll('.filter-checkbox-item');
        const lowerQuery = query.toLowerCase();
        labels.forEach(label => {
            const text = label.querySelector('.type-label').textContent.toLowerCase();
            if (text.includes(lowerQuery)) {
                label.style.display = 'flex';
            } else {
                label.style.display = 'none';
            }
        });
    }

    function applyFiltersAndSort() {
        if (!gridInstance) return;
        
        let processed = [...originalGridData];
        
        // 1. Filter
        for (let col = 0; col < 6; col++) {
            if (activeFilters[col] && activeFilters[col].length > 0) {
                processed = processed.filter(row => {
                    const rowVal = getFormattedColumnValue(row, col);
                    // Match the stored string values
                    return activeFilters[col].includes(String(rowVal));
                });
            }
        }
        
        // 2. Sort
        if (currentSort.colIndex !== null) {
            const colIndex = currentSort.colIndex;
            const dir = currentSort.direction;
            
            processed.sort((a, b) => {
                let valA = a[colIndex];
                let valB = b[colIndex];
                
                // Numeric Sort (Size or Date timestamp)
                if (colIndex === 1 || colIndex === 2) {
                    valA = Number(valA) || 0;
                    valB = Number(valB) || 0;
                    return dir === 'asc' ? valA - valB : valB - valA;
                }
                
                // String sort
                valA = String(valA || '');
                valB = String(valB || '');
                return dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            });
        }
        
        currentGridData = processed;
        gridInstance.updateConfig({
            data: processed
        }).forceRender();

        // Update Filter Icons UI
        setTimeout(() => {
            const buttons = document.querySelectorAll('.filter-icon-btn');
            for (let c = 0; c < 6; c++) {
                if (buttons[c]) {
                    if (activeFilters[c] && activeFilters[c].length > 0) {
                        buttons[c].classList.add('active');
                        buttons[c].style.color = 'var(--accent-color)';
                        buttons[c].style.backgroundColor = 'rgba(var(--accent-color-rgb), 0.1)';
                    } else {
                        buttons[c].classList.remove('active');
                        buttons[c].style.color = '';
                        buttons[c].style.backgroundColor = '';
                    }
                }
            }
        }, 50); // slight delay to ensure Grid.js finished rendering headers
    }

    function applyColumnFilter() {
        const menu = document.getElementById('grid-filter-menu');
        if (!menu || currentFilterColIndex === null) return;
        
        const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
        const selected = [];
        let allCount = 0;
        checkboxes.forEach(cb => {
            allCount++;
            if (cb.checked) selected.push(cb.value);
        });

        // If all are selected, we can just clear the active filter for this column
        if (selected.length === allCount || selected.length === 0) {
            activeFilters[currentFilterColIndex] = [];
        } else {
            activeFilters[currentFilterColIndex] = selected;
        }

        menu.classList.add('hidden');
        applyFiltersAndSort();
    }

    function sortGridByColumn(colIndex, direction) {
        const menu = document.getElementById('grid-filter-menu');
        if (menu) menu.classList.add('hidden');
        
        currentSort = { colIndex: colIndex, direction: direction };
        applyFiltersAndSort();
    }

    function downloadCsv() {
        if (!gridInstance) return;

        // Get currently filtered and sorted data
        const data = currentGridData;
        if (!data || data.length === 0) {
            FileFlow.ui.Status.error("No data to export");
            return;
        }

        // Define headers matching grid columns
        const headers = ['Name', 'Size (Bytes)', 'Date (Timestamp)', 'Type', 'Encode', 'EOL'];

        // Convert data to CSV format
        let csvContent = headers.join(',') + '\n';

        data.forEach(row => {
            const csvRow = row.map(cell => {
                // Escape double quotes and wrap in double quotes if there's a comma
                let str = String(cell || '');
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    str = '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            });
            csvContent += csvRow.join(',') + '\n';
        });

        // Add BOM for Excel UTF-8 support
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        let filename = 'file_flow_export.csv';
        if (FileFlow.state.currentRootEntries.length === 1) {
            filename = FileFlow.state.currentRootEntries[0].name + '_export.csv';
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function renderFlatList(matcher) {
        const list = document.getElementById('file-list');
        if (!list) return;

        list.innerHTML = '';
        list.classList.remove('file-tree');
        list.classList.add('file-grid');

        const fileEntries = [];
        const rootEntries = FileFlow.state.currentRootEntries;
        const isSingleRootFolder = rootEntries.length === 1 && rootEntries[0].isDirectory;

        // Recursive collector with virtual path building
        async function traverseWithPaths(entries, currentPath = '', depth = 0) {
            for (const entry of entries) {
                if (!shouldInclude(entry)) continue;

                // Build relative path string
                let entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

                // Exclude root folder name if single folder drop
                if (isSingleRootFolder && depth === 0) {
                    entryPath = ''; 
                }

                if (entry.isDirectory) {
                    const children = await FileFlow.utils.FileSystem.readDir(entry);
                    await traverseWithPaths(children, entryPath, depth + 1);
                } else {
                    // Check filter
                    if (matcher && !matcher(entry.name)) continue;
                    fileEntries.push({ handle: entry, path: entryPath });
                }
            }
        }

        await traverseWithPaths(rootEntries, '', 0);

        // Prepare Data for Grid.js
        const gridData = [];
        const showFull = FileFlow.state.appSettings.showFullPath;
        
        // Process in chunks to unblock UI thread
        const CHUNK_SIZE = 1000;
        for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
            const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
            
            await Promise.all(chunk.map(async (item) => {
                let size = 0;
                let date = null;
                let type = item.handle.name.split('.').pop();
                if (type === item.handle.name) type = ''; // No extension
                let encoding = '-';
                let eol = '-';

                const pathKey = item.handle.fullPath || item.path;
                let meta = FileFlow.state.entryMetadata[pathKey];

                if (meta && meta.size !== undefined) {
                    // Use cached metadata to prevent re-reading massive numbers of files from disk
                    size = meta.size;
                    date = meta.date;
                    encoding = meta.encoding || '-';
                    eol = meta.eol || '-';
                } else {
                    try {
                        const file = await new Promise((resolve, reject) => item.handle.file(resolve, reject));
                        size = file.size;
                        date = file.lastModified;
                        
                        const detectInfo = await FileFlow.utils.Detect.detectFileInfo(file);
                        encoding = detectInfo.encoding;
                        eol = detectInfo.eol;

                        // Cache it
                        if (!FileFlow.state.entryMetadata[pathKey]) {
                            FileFlow.state.entryMetadata[pathKey] = {};
                        }
                        FileFlow.state.entryMetadata[pathKey].size = size;
                        FileFlow.state.entryMetadata[pathKey].date = date;
                        FileFlow.state.entryMetadata[pathKey].encoding = encoding;
                        FileFlow.state.entryMetadata[pathKey].eol = eol;
                        
                    } catch (e) { /* ignore single file errors to continue */ }
                }

                // Determine displayed name vs potentially renamed name
                let displayName = item.handle.name;
                meta = FileFlow.state.entryMetadata[pathKey]; // Re-fetch in case we just created it
                if (meta && meta.newFilename) {
                    displayName = meta.newFilename;
                }

                gridData.push([
                    showFull ? item.path : displayName,
                    size,
                    date,
                    type,
                    encoding,
                    eol
                ]);
            }));
            
            // Re-calc spinner / Update Status optionally, but more importantly yield to main thread
            FileFlow.ui.Status.show(`Processing files... (${Math.min(i + CHUNK_SIZE, fileEntries.length)} / ${fileEntries.length})`, true);
            await new Promise(r => setTimeout(r, 0)); // Yield to UI
        }


        // Store Original Data for Filtering
        originalGridData = gridData;
        currentGridData = gridData;
        activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
        currentSort = { colIndex: null, direction: 'asc' };

        if (gridInstance) {
            // Grid.js cleanup if needed
        }

        FileFlow.ui.Status.show(`Finalizing UI...`, true);
        await new Promise(r => setTimeout(r, 0)); // Yield to UI
        
        const gridWrapper = document.createElement('div');
        gridWrapper.style.height = '100%';
        list.appendChild(gridWrapper);

        function createHeaderHTML(colName, colIndex) {
            // Apply immediately if already active
            const isActive = activeFilters[colIndex] && activeFilters[colIndex].length > 0;
            const colorStyle = isActive ? 'color: var(--accent-color); background-color: rgba(var(--accent-color-rgb, 0,122,255), 0.1);' : '';
            const activeClass = isActive ? 'active' : '';

            return `
                <div style="display:flex; align-items:center; justify-content:space-between; position: relative;">
                    ${colName}
                    <button 
                        class="filter-icon-btn ${activeClass}" 
                        style="${colorStyle}"
                        title="Filter / Sort by ${colName}"
                        onclick="event.stopPropagation(); FileFlow.ui.Render.toggleFilterMenu(this, ${colIndex}, '${colName}')"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                    </button>
                </div>
            `;
        }

        gridInstance = new gridjs.Grid({
            columns: [
                {
                    name: gridjs.html(createHeaderHTML('Name', 0)),
                    id: 'Name',
                    formatter: (cell) => gridjs.html(`<span class="grid-filename" title="${cell}">${cell}</span>`),
                    sort: false // Handled by custom filter popover
                },
                {
                    name: gridjs.html(createHeaderHTML('Size', 1)),
                    id: 'Size',
                    width: '120px',
                    formatter: (cell) => formatBytes(cell),
                    sort: false // Handled by custom filter popover
                },
                {
                    name: gridjs.html(createHeaderHTML('Date', 2)),
                    id: 'Date',
                    width: '180px',
                    formatter: (cell) => formatDate(cell),
                    sort: false // Handled by custom filter popover
                },
                {
                    name: gridjs.html(createHeaderHTML('Type', 3)),
                    id: 'Type',
                    width: '90px',
                    sort: false // Disable sort on header click for this column
                },
                {
                    name: gridjs.html(createHeaderHTML('Encode', 4)),
                    id: 'Encode',
                    width: '120px',
                    sort: false
                },
                {
                    name: gridjs.html(createHeaderHTML('EOL', 5)),
                    id: 'EOL',
                    width: '90px',
                    sort: false
                }
            ],
            data: gridData,
            search: false, // Turned off internal search to prevent crashing
            sort: false, // Turned off internal sort pipeline for performance
            resizable: true,
            pagination: { limit: 500 },
            fixedHeader: true,
            height: '100%',
            style: {
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
        
        // Hide 'Finalizing UI...' message
        FileFlow.ui.Status.hide(500);
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
        toggleFilterMenu: toggleFilterMenu,
        sortGridByColumn: sortGridByColumn,
        filterCheckboxes: filterCheckboxes,
        toggleAllCheckboxes: toggleAllCheckboxes,
        applyColumnFilter: applyColumnFilter,
        downloadCsv: downloadCsv
    };

    // FIX: Renamed from Toast to Status to match main.js usage
    let hideTimeout = null;
    FileFlow.ui.Status = {
        show: (message, isLoading = false) => {
            if (hideTimeout) clearTimeout(hideTimeout);
            showStatus(message, isLoading);
        },
        hide: (delay = 0) => {
            if (hideTimeout) clearTimeout(hideTimeout);
            if (statusToast) {
                if (delay > 0) {
                    hideTimeout = setTimeout(() => statusToast.classList.add('hidden'), delay);
                } else {
                    statusToast.classList.add('hidden');
                }
            }
        },
        error: (message) => {
            if (hideTimeout) clearTimeout(hideTimeout);
            showStatus(`Error: ${message}`, false);
        }
    };

    FileFlow.ui.ElementFactory = {
        createTreeElement: createTreeElement
    };

})();
