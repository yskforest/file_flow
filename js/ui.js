// FileFlow — UI Layer
(function () {
    const { $, formatBytes, formatDate, Icons, Glob, FS, Detect, downloadBlob } = FileFlow.utils;
    const State = FileFlow.state;

    // =====================
    //  Status Toast
    // =====================

    let hideTimeout = null;
    const Status = {
        show(msg, isLoading = false) {
            clearTimeout(hideTimeout);
            const toast = $('status-toast'), text = $('status-text');
            if (!toast || !text) return;
            text.textContent = msg;
            toast.classList.remove('hidden');
            const spinner = toast.querySelector('.spinner');
            if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
            if (!isLoading) hideTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
        },
        hide(delay = 0) {
            clearTimeout(hideTimeout);
            const toast = $('status-toast');
            if (!toast) return;
            delay > 0 ? (hideTimeout = setTimeout(() => toast.classList.add('hidden'), delay)) : toast.classList.add('hidden');
        },
        error(msg) { Status.show(`Error: ${msg}`); }
    };

    // =====================
    //  Modal Factory
    // =====================

    function createModal(id, title, bodyHTML) {
        let modal = $(id);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = id;
            modal.className = 'modal hidden';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="icon-btn close-modal-btn">${Icons.close}</button>
                </div>
                <div class="modal-body">${bodyHTML}</div>
            </div>`;
        const close = () => modal.classList.add('hidden');
        modal.querySelector('.close-modal-btn').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        return modal;
    }

    function initModals() {
        createModal('settings-modal', 'Settings', `
            <div class="setting-group">
                <h4>Action Mode</h4>
                <label class="setting-item radio"><input type="radio" name="action-mode" value="md" checked><span>Add .md extension</span></label>
                <label class="setting-item radio"><input type="radio" name="action-mode" value="txt"><span>Add .txt extension</span></label>
                <label class="setting-item radio"><input type="radio" name="action-mode" value="detect"><span>Detect Info (Encoding/EOL)</span></label>
            </div>
            <div class="setting-group">
                <h4>Filters &amp; Display</h4>
                <label class="setting-item"><input type="checkbox" id="exclude-dots-checkbox" checked><span>Exclude files/folders starting with "." (dotfiles)</span></label>
                <label class="setting-item"><input type="checkbox" id="show-fullpath-checkbox" checked><span>Show full path in List View</span></label>
            </div>`);
        createModal('stats-modal', 'Statistics', '<div id="stats-content"></div>');
    }

    // =====================
    //  Tree View
    // =====================

    function shouldInclude(entry) {
        return !(State.appSettings.excludeDots && entry.name.startsWith('.'));
    }

    function createTreeElement(entry) {
        const li = document.createElement('li');
        const div = document.createElement('div');
        div.className = 'item';
        div.entry = entry;

        const icon = document.createElement('i');
        icon.className = entry.isDirectory ? 'fas fa-folder folder-icon' : 'far fa-file file-icon';
        div.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = entry.name;
        div.appendChild(name);
        li.appendChild(div);

        if (entry.isDirectory) {
            div.classList.add('folder-toggle');
            const arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.innerHTML = '&#9656;';
            div.prepend(arrow);
            const nested = document.createElement('ul');
            nested.className = 'nested';
            li.appendChild(nested);
            li.dataset.loaded = 'false';
            li.entry = entry;
            div.addEventListener('click', e => { e.stopPropagation(); toggleFolder(div); });
        } else {
            div.classList.add('file-item');
            div.addEventListener('click', async e => {
                e.stopPropagation();
                const mode = State.appSettings.actionMode;
                const action = FileFlow.actions.ActionManager.getAction(mode === 'detect' ? 'detect' : '.' + mode);
                if (action && action.shouldApply(entry)) await action.execute(div, entry);
            });
        }
        return li;
    }

    async function toggleFolder(div) {
        const li = div.parentElement, arrow = div.querySelector('.arrow'), nested = li.querySelector('.nested');
        if (nested.classList.contains('expanded')) {
            nested.classList.remove('expanded');
            div.classList.remove('open');
            arrow.style.transform = 'rotate(0deg)';
        } else {
            if (li.dataset.loaded === 'false') {
                await loadChildren(li.entry, nested);
                li.dataset.loaded = 'true';
            }
            nested.classList.add('expanded');
            div.classList.add('open');
            arrow.style.transform = 'rotate(90deg)';
        }
    }

    async function loadChildren(dirEntry, container) {
        container.innerHTML = '';
        const entries = await FS.readDir(dirEntry);
        entries.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
        for (const child of entries)
            if (shouldInclude(child)) container.appendChild(createTreeElement(child));
    }

    // =====================
    //  Grid.js List View
    // =====================

    let gridInstance = null, originalGridData = [], currentGridData = [];
    let activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
    let currentSort = { colIndex: null, direction: 'asc' };
    let currentFilterColIndex = null;

    function getColValue(row, col) {
        if (col === 1) return formatBytes(row[col]);
        if (col === 2) return formatDate(row[col]);
        return String(row[col] || '(None)');
    }

    // --- Filter Popover ---

    function toggleFilterMenu(btn, colIndex, colName) {
        let menu = $('grid-filter-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'grid-filter-menu';
            menu.className = 'filter-popover hidden';
            document.body.appendChild(menu);
            document.addEventListener('click', e => {
                if (!menu.contains(e.target) && !e.target.closest('.filter-icon-btn'))
                    menu.classList.add('hidden');
            });
        }

        if (!menu.classList.contains('hidden') && currentFilterColIndex === colIndex) {
            menu.classList.add('hidden');
            return;
        }
        currentFilterColIndex = colIndex;

        // Build dataset filtered by OTHER columns
        let base = [...originalGridData];
        for (let c = 0; c < 6; c++) {
            if (c !== colIndex && activeFilters[c]?.length)
                base = base.filter(row => activeFilters[c].includes(getColValue(row, c)));
        }

        const unique = [...new Set(base.map(r => getColValue(r, colIndex)))].sort((a, b) =>
            a === '(None)' ? 1 : b === '(None)' ? -1 : String(a).localeCompare(String(b)));

        const active = activeFilters[colIndex];
        const allSelected = !active.length || active.length === unique.length;

        const checkboxes = unique.map(val =>
            `<label class="filter-checkbox-item">
                <input type="checkbox" value="${val}" ${allSelected || active.includes(val) ? 'checked' : ''}>
                <span class="type-label" title="${val}">${val}</span>
            </label>`).join('');

        menu.innerHTML = `
            <div class="filter-actions">
                <button class="text-btn outline sort-asc-btn">Sort Ascending</button>
                <button class="text-btn outline sort-desc-btn">Sort Descending</button>
            </div>
            <hr class="filter-divider">
            <div class="filter-search-container">
                <input type="text" id="grid-filter-search" class="search-input full-width search-input-field" placeholder="Search ${colName}...">
            </div>
            <div class="filter-bulk-actions">
                <a href="#" class="select-all-btn">Select All</a> -
                <a href="#" class="clear-all-btn">Clear</a>
            </div>
            <div class="filter-options-list" id="grid-checkbox-list">${checkboxes}</div>
            <div class="filter-footer">
                <button class="text-btn outline cancel-btn">Cancel</button>
                <button class="text-btn apply-btn">Apply</button>
            </div>`;

        // Bind events programmatically
        menu.querySelector('.sort-asc-btn').addEventListener('click', () => sortGridByColumn(colIndex, 'asc'));
        menu.querySelector('.sort-desc-btn').addEventListener('click', () => sortGridByColumn(colIndex, 'desc'));
        
        const searchInput = menu.querySelector('.search-input-field');
        searchInput.addEventListener('input', e => filterCheckboxes(e.target.value));

        menu.querySelector('.select-all-btn').addEventListener('click', e => {
            e.preventDefault();
            toggleAllCheckboxes(true);
        });
        menu.querySelector('.clear-all-btn').addEventListener('click', e => {
            e.preventDefault();
            toggleAllCheckboxes(false);
        });

        menu.querySelector('.cancel-btn').addEventListener('click', () => menu.classList.add('hidden'));
        menu.querySelector('.apply-btn').addEventListener('click', () => applyColumnFilter());

        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY + 8) + 'px';
        menu.style.left = (rect.left + window.scrollX - 200 + rect.width) + 'px';
        menu.classList.remove('hidden');

        setTimeout(() => { const s = $('grid-filter-search'); if (s) s.focus(); }, 50);
    }

    function toggleAllCheckboxes(check) {
        const list = $('grid-checkbox-list');
        if (list) list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (cb.parentElement.style.display !== 'none') cb.checked = check;
        });
    }

    function filterCheckboxes(query) {
        const list = $('grid-checkbox-list');
        if (!list) return;
        const q = query.toLowerCase();
        list.querySelectorAll('.filter-checkbox-item').forEach(label => {
            label.style.display = label.querySelector('.type-label').textContent.toLowerCase().includes(q) ? 'flex' : 'none';
        });
    }

    function applyFiltersAndSort() {
        if (!gridInstance) return;
        let data = [...originalGridData];

        // Filter
        for (let c = 0; c < 6; c++) {
            if (activeFilters[c]?.length)
                data = data.filter(row => activeFilters[c].includes(getColValue(row, c)));
        }

        // Sort
        if (currentSort.colIndex !== null) {
            const col = currentSort.colIndex, dir = currentSort.direction;
            data.sort((a, b) => {
                let va = a[col], vb = b[col];
                if (col === 1 || col === 2) { va = Number(va) || 0; vb = Number(vb) || 0; return dir === 'asc' ? va - vb : vb - va; }
                va = String(va || ''); vb = String(vb || '');
                return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            });
        }

        currentGridData = data;
        gridInstance.updateConfig({ data }).forceRender();

        // Update filter icon states
        setTimeout(() => {
            document.querySelectorAll('.filter-icon-btn').forEach((btn, c) => {
                const isActive = activeFilters[c]?.length > 0;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent-color)' : '';
                btn.style.backgroundColor = isActive ? 'rgba(var(--accent-color-rgb), 0.1)' : '';
            });
        }, 50);
    }

    function applyColumnFilter() {
        const menu = $('grid-filter-menu');
        if (!menu || currentFilterColIndex === null) return;
        const cbs = menu.querySelectorAll('input[type="checkbox"]');
        const selected = [...cbs].filter(cb => cb.checked).map(cb => cb.value);
        activeFilters[currentFilterColIndex] = selected.length === cbs.length || !selected.length ? [] : selected;
        menu.classList.add('hidden');
        applyFiltersAndSort();
    }

    function sortGridByColumn(colIndex, direction) {
        const menu = $('grid-filter-menu');
        if (menu) menu.classList.add('hidden');
        currentSort = { colIndex, direction };
        applyFiltersAndSort();
    }

    // --- CSV Export ---

    function downloadCsv() {
        if (!gridInstance || !currentGridData.length) { Status.error('No data to export'); return; }
        const headers = ['Name', 'Size (Bytes)', 'Date (Timestamp)', 'Type', 'Encode', 'EOL'];
        const escape = s => { s = String(s || ''); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const csv = [headers.join(','), ...currentGridData.map(row => row.map(escape).join(','))].join('\n') + '\n';
        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
        const name = State.currentRootEntries.length === 1 ? State.currentRootEntries[0].name + '_export.csv' : 'file_flow_export.csv';
        downloadBlob(blob, name);
    }

    // --- Render Flat List (Grid.js) ---

    async function renderFlatList(matcher) {
        const list = $('file-list');
        if (!list) return;
        list.innerHTML = '';
        list.classList.remove('file-tree');
        list.classList.add('file-grid');

        const roots = State.currentRootEntries;
        const isSingleRoot = roots.length === 1 && roots[0].isDirectory;
        const fileEntries = [];

        // Collect all files with paths
        async function collect(entries, path = '', depth = 0) {
            for (const entry of entries) {
                if (!shouldInclude(entry)) continue;
                let p = path ? `${path}/${entry.name}` : entry.name;
                if (isSingleRoot && depth === 0) p = '';
                if (entry.isDirectory) {
                    await collect(await FS.readDir(entry), p, depth + 1);
                } else {
                    if (!matcher || matcher(entry.name)) fileEntries.push({ handle: entry, path: p });
                }
            }
        }
        await collect(roots, '', 0);

        // Build grid data in chunks
        const gridData = [], CHUNK = 1000, showFull = State.appSettings.showFullPath;

        for (let i = 0; i < fileEntries.length; i += CHUNK) {
            const chunk = fileEntries.slice(i, i + CHUNK);
            await Promise.all(chunk.map(async item => {
                const pathKey = item.handle.fullPath || item.path;
                let meta = State.entryMetadata[pathKey];
                let size = 0, date = null, encoding = '-', eol = '-';
                const type = item.handle.name.includes('.') ? item.handle.name.split('.').pop().toLowerCase() : '';

                if (meta?.size !== undefined) {
                    ({ size, date, encoding = '-', eol = '-' } = meta);
                } else {
                    try {
                        const file = await new Promise((res, rej) => item.handle.file(res, rej));
                        size = file.size; date = file.lastModified;
                        const info = await Detect.detectFileInfo(file);
                        encoding = info.encoding; eol = info.eol;
                        State.entryMetadata[pathKey] = { ...State.entryMetadata[pathKey], size, date, encoding, eol };
                    } catch { /* skip */ }
                }

                let displayName = item.handle.name;
                meta = State.entryMetadata[pathKey];
                if (meta?.newFilename) displayName = meta.newFilename;
                gridData.push([showFull ? item.path : displayName, size, date, type, encoding, eol]);
            }));

            Status.show(`Processing files... (${Math.min(i + CHUNK, fileEntries.length)} / ${fileEntries.length})`, true);
            await new Promise(r => setTimeout(r, 0));
        }

        // Reset grid state
        originalGridData = gridData;
        currentGridData = gridData;
        activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
        currentSort = { colIndex: null, direction: 'asc' };

        Status.show('Finalizing UI...', true);
        await new Promise(r => setTimeout(r, 0));

        const wrapper = document.createElement('div');
        wrapper.style.height = '100%';
        list.appendChild(wrapper);

        // Delegated event listener for filter icon button inside wrapper
        wrapper.addEventListener('click', e => {
            const filterBtn = e.target.closest('.filter-icon-btn');
            if (filterBtn) {
                e.stopPropagation();
                const colIndex = parseInt(filterBtn.getAttribute('data-col-index'), 10);
                const colName = filterBtn.getAttribute('data-col-name');
                toggleFilterMenu(filterBtn, colIndex, colName);
            }
        });

        const headerHTML = (name, idx) => `
            <div style="display:flex;align-items:center;justify-content:space-between;position:relative">
                ${name}
                <button class="filter-icon-btn" title="Filter / Sort by ${name}" data-col-index="${idx}" data-col-name="${name}">
                    ${Icons.filter}
                </button>
            </div>`;

        const cols = [
            { name: 'Name', id: 'Name', formatter: c => gridjs.html(`<span class="grid-filename" title="${c}">${c}</span>`) },
            { name: 'Size', id: 'Size', width: '120px', formatter: c => formatBytes(c) },
            { name: 'Date', id: 'Date', width: '180px', formatter: c => formatDate(c) },
            { name: 'Type', id: 'Type', width: '90px' },
            { name: 'Encode', id: 'Encode', width: '120px' },
            { name: 'EOL', id: 'EOL', width: '90px' },
        ].map((col, i) => ({ ...col, name: gridjs.html(headerHTML(col.name, i)), sort: false }));

        gridInstance = new gridjs.Grid({
            columns: cols,
            data: gridData,
            search: false, sort: false, resizable: true,
            pagination: { limit: 500 },
            fixedHeader: true, height: '100%',
            style: {
                th: { 'background-color': 'var(--bg-secondary)', 'color': 'var(--text-primary)', 'border': '1px solid var(--border-color)' },
                td: { 'background-color': 'var(--bg-primary)', 'color': 'var(--text-secondary)', 'border': '1px solid var(--border-color)' }
            },
            className: { table: 'custom-grid-table', th: 'custom-grid-th', td: 'custom-grid-td' }
        }).render(wrapper);

        Status.hide(500);
    }

    // =====================
    //  Main Render
    // =====================

    async function renderFileList() {
        const list = $('file-list');
        if (!list) return;
        list.innerHTML = '';
        const matcher = Glob.createMatcher(State.searchQuery);
        const container = $('file-list-container'), dropZone = $('drop-zone');

        if (State.currentRootEntries.length > 0) {
            if (container) container.classList.remove('hidden');
            if (dropZone) dropZone.classList.add('hidden');

            if (State.appSettings.viewMode === 'tree') {
                list.classList.add('file-tree');
                list.classList.remove('file-grid');
                const autoExpand = State.currentRootEntries.length === 1 && State.currentRootEntries[0].isDirectory;
                for (const entry of State.currentRootEntries) {
                    if (!shouldInclude(entry)) continue;
                    const el = createTreeElement(entry);
                    list.appendChild(el);
                    if (!matcher && autoExpand) {
                        const toggle = el.querySelector('.item.folder-toggle');
                        if (toggle) await toggleFolder(toggle);
                    }
                }
            } else {
                await renderFlatList(matcher);
            }
        } else {
            if (container) container.classList.add('hidden');
            if (dropZone) dropZone.classList.remove('hidden');
        }
    }

    // =====================
    //  Statistics
    // =====================

    async function calculateStats() {
        Status.show('Calculating statistics...', true);
        await new Promise(r => setTimeout(r, 10));

        let totalFiles = 0, totalFolders = 0, totalFileSize = 0;
        const extCounts = {}, ignoredFolders = {};
        const matcher = Glob.createMatcher(State.searchQuery);

        await FS.traverse(State.currentRootEntries, async entry => {
            const isMatch = !matcher || matcher(entry.name);

            if (State.appSettings.excludeDots && entry.name.startsWith('.')) {
                if (entry.isDirectory) ignoredFolders[entry.name] = (ignoredFolders[entry.name] || 0) + 1;
                return false;
            }

            if (entry.isDirectory) {
                if (isMatch) totalFolders++;
            } else if (isMatch) {
                totalFiles++;
                const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop().toLowerCase() : 'no-ext';
                extCounts[ext] = (extCounts[ext] || 0) + 1;
                const meta = State.entryMetadata[entry.fullPath || entry.name];
                if (meta?.size !== undefined) { totalFileSize += meta.size; }
                else { try { totalFileSize += (await new Promise(r => entry.file(r))).size; } catch { /* skip */ } }
            }
            return true;
        }, { excludeDots: false });

        Status.hide();
        return { totalFiles, totalFolders, extCounts, totalFileSize, ignoredFolders };
    }

    function renderStats(stats) {
        const totalIgnored = Object.values(stats.ignoredFolders).reduce((a, b) => a + b, 0);
        const extRows = Object.entries(stats.extCounts).sort((a, b) => b[1] - a[1])
            .map(([ext, n]) => `<tr><td>${ext}</td><td>${n}</td></tr>`).join('');

        let ignoredHTML = '';
        if (totalIgnored > 0) {
            const rows = Object.entries(stats.ignoredFolders).sort((a, b) => b[1] - a[1])
                .map(([name, n]) => `<tr><td>${name}</td><td>${n}</td></tr>`).join('');
            ignoredHTML = `
                <div style="flex:1">
                    <h3 style="color:var(--text-muted)">Ignored Details</h3>
                    <table class="stats-table" style="color:var(--text-muted)">
                        <thead><tr><th>Folder Name</th><th>Count</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        $('stats-content').innerHTML = `
            <div class="stats-summary" style="margin-bottom:20px">
                <div class="stat-box"><div class="label">Total Size</div><div class="value">${formatBytes(stats.totalFileSize)}</div></div>
                <div class="stat-box"><div class="label">Files</div><div class="value">${stats.totalFiles}</div></div>
                <div class="stat-box"><div class="label">Folders</div><div class="value">${stats.totalFolders}</div></div>
                <div class="stat-box" style="border-left:1px solid var(--border-color);padding-left:15px">
                    <div class="label" style="color:var(--text-muted)">Ignored Folders</div>
                    <div class="value" style="color:var(--text-muted)">${totalIgnored}</div>
                </div>
            </div>
            <div style="display:flex;gap:20px;text-align:left">
                <div style="flex:1">
                    <h3>Extensions</h3>
                    <table class="stats-table">
                        <thead><tr><th>Extension</th><th>Count</th></tr></thead>
                        <tbody>${extRows}</tbody>
                    </table>
                </div>
                ${ignoredHTML}
            </div>`;
    }

    // =====================
    //  Export
    // =====================

    FileFlow.ui.Status = Status;
    FileFlow.ui.initModals = initModals;
    FileFlow.ui.Render = {
        renderFileList, applyFilter: renderFileList,
        downloadCsv
    };
    FileFlow.ui.Stats = {
        async show() {
            renderStats(await calculateStats());
            $('stats-modal').classList.remove('hidden');
        }
    };
})();
