// FileFlow — Views (TreeView + ListView)
// DOM生成に専念。状態更新は行わない。表示文字列は必ず escape する。
(function () {
    'use strict';

    var FF = window.FileFlow;

    function U() { return FF.utils; }
    function S() { return FF.state; }

    function shouldInclude(entry) {
        return !(S().appSettings.excludeDots && entry.name && entry.name.charAt(0) === '.');
    }

    // =====================
    // TreeView
    // =====================

    function createTreeElement(entry, hooks) {
        hooks = hooks || FF.ui.TreeHooks || {};
        var li = document.createElement('li');
        var div = document.createElement('div');
        div.className = 'item';
        div.entry = entry;

        var icon = document.createElement('i');
        icon.className = entry.isDirectory ? 'fas fa-folder folder-icon' : 'far fa-file file-icon';
        div.appendChild(icon);

        var name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = entry.name; // textContent はXSS安全
        div.appendChild(name);
        li.appendChild(div);

        if (entry.isDirectory) {
            div.classList.add('folder-toggle');
            var arrow = document.createElement('span');
            arrow.className = 'arrow';
            arrow.innerHTML = '&#9656;';
            div.prepend(arrow);
            var nested = document.createElement('ul');
            nested.className = 'nested';
            li.appendChild(nested);
            li.dataset.loaded = 'false';
            li.entry = entry;
            div.addEventListener('click', function (e) { e.stopPropagation(); toggleFolder(div); });
        } else {
            div.classList.add('file-item');
            var meta = S().getMeta(entry.fullPath || entry.name);
            if (meta) {
                if (meta.newFilename) {
                    name.textContent = meta.newFilename;
                    div.classList.add('renamed');
                    div.downloadName = meta.newFilename;
                }
                if (meta.detectionInfo && hooks.renderBadges) hooks.renderBadges(div, meta.detectionInfo);
            }
            div.addEventListener('click', function (e) {
                e.stopPropagation();
                if (hooks.onFileClick) hooks.onFileClick(entry, div);
            });
        }
        return li;
    }

    function toggleFolder(div) {
        var li = div.parentElement;
        if (!li) return Promise.resolve();
        var arrow = li.querySelector('.arrow');
        var nested = li.querySelector('.nested');
        if (!nested) return Promise.resolve();
        if (nested.classList.contains('expanded')) {
            nested.classList.remove('expanded');
            div.classList.remove('open');
            if (arrow) arrow.style.transform = 'rotate(0deg)';
            return Promise.resolve();
        }
        var load = (li.dataset.loaded === 'false')
            ? loadChildren(li.entry, nested).then(function () { li.dataset.loaded = 'true'; })
            : Promise.resolve();
        return load.then(function () {
            nested.classList.add('expanded');
            div.classList.add('open');
            if (arrow) arrow.style.transform = 'rotate(90deg)';
        });
    }

    function loadChildren(dirEntry, container) {
        container.innerHTML = '';
        return U().FS.readDir(dirEntry).then(function (entries) {
            entries.sort(function (a, b) {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });
            entries.forEach(function (child) {
                if (shouldInclude(child)) container.appendChild(createTreeElement(child));
            });
        });
    }

    // =====================
    // ListView (Grid.js)
    // =====================

    var gridInstance = null;
    var originalGridData = [];
    var currentGridData = [];
    var activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
    var currentSort = { colIndex: null, direction: 'asc' };
    var currentFilterColIndex = null;

    function getColValue(row, col) {
        if (col === 1) return U().formatBytes(row[col]);
        if (col === 2) return U().formatDate(row[col]);
        var v = row[col];
        return String(v === null || v === undefined || v === '' ? '(None)' : v);
    }

    function toggleFilterMenu(btn, colIndex, colName) {
        var menu = document.getElementById('grid-filter-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'grid-filter-menu';
            menu.className = 'filter-popover hidden';
            document.body.appendChild(menu);
            document.addEventListener('click', function (e) {
                if (!menu.contains(e.target) && !(e.target.closest && e.target.closest('.filter-icon-btn'))) {
                    menu.classList.add('hidden');
                }
            });
        }
        if (!menu.classList.contains('hidden') && currentFilterColIndex === colIndex) {
            menu.classList.add('hidden');
            return;
        }
        currentFilterColIndex = colIndex;

        var base = originalGridData.slice();
        for (var c = 0; c < 6; c++) {
            if (c !== colIndex && activeFilters[c] && activeFilters[c].length) {
                base = base.filter(function (row) { return activeFilters[c].indexOf(getColValue(row, c)) >= 0; });
            }
        }
        var seen = {};
        base.forEach(function (r) { seen[getColValue(r, colIndex)] = true; });
        var unique = Object.keys(seen).sort(function (a, b) {
            if (a === '(None)') return 1;
            if (b === '(None)') return -1;
            return String(a).localeCompare(String(b));
        });

        var active = activeFilters[colIndex] || [];
        var allSelected = !active.length || active.length === unique.length;
        var checkboxes = unique.map(function (val) {
            var checked = (allSelected || active.indexOf(val) >= 0) ? 'checked' : '';
            return '<label class="filter-checkbox-item">' +
                '<input type="checkbox" value="' + U().escapeAttr(val) + '" ' + checked + '>' +
                '<span class="type-label" title="' + U().escapeAttr(val) + '">' + U().escapeHtml(val) + '</span></label>';
        }).join('');

        menu.innerHTML =
            '<div class="filter-actions">' +
            '<button class="text-btn outline sort-asc-btn">Sort Ascending</button>' +
            '<button class="text-btn outline sort-desc-btn">Sort Descending</button></div>' +
            '<hr class="filter-divider">' +
            '<div class="filter-search-container">' +
            '<input type="text" id="grid-filter-search" class="search-input full-width search-input-field" placeholder="Search ' + U().escapeAttr(colName) + '..."></div>' +
            '<div class="filter-bulk-actions"><a href="#" class="select-all-btn">Select All</a> - ' +
            '<a href="#" class="clear-all-btn">Clear</a></div>' +
            '<div class="filter-options-list" id="grid-checkbox-list">' + checkboxes + '</div>' +
            '<div class="filter-footer"><button class="text-btn outline cancel-btn">Cancel</button>' +
            '<button class="text-btn apply-btn">Apply</button></div>';

        menu.querySelector('.sort-asc-btn').addEventListener('click', function () { sortGridByColumn(colIndex, 'asc'); });
        menu.querySelector('.sort-desc-btn').addEventListener('click', function () { sortGridByColumn(colIndex, 'desc'); });
        menu.querySelector('.search-input-field').addEventListener('input', function (e) { filterCheckboxes(e.target.value); });
        menu.querySelector('.select-all-btn').addEventListener('click', function (e) { e.preventDefault(); toggleAllCheckboxes(true); });
        menu.querySelector('.clear-all-btn').addEventListener('click', function (e) { e.preventDefault(); toggleAllCheckboxes(false); });
        menu.querySelector('.cancel-btn').addEventListener('click', function () { menu.classList.add('hidden'); });
        menu.querySelector('.apply-btn').addEventListener('click', function () { applyColumnFilter(); });

        var rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY + 8) + 'px';
        menu.style.left = (rect.left + window.scrollX - 200 + rect.width) + 'px';
        menu.classList.remove('hidden');
        setTimeout(function () {
            var s = document.getElementById('grid-filter-search');
            if (s) s.focus();
        }, 50);
    }

    function toggleAllCheckboxes(check) {
        var list = document.getElementById('grid-checkbox-list');
        if (list) list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
            if (cb.parentElement.style.display !== 'none') cb.checked = check;
        });
    }

    function filterCheckboxes(query) {
        var list = document.getElementById('grid-checkbox-list');
        if (!list) return;
        var q = String(query || '').toLowerCase();
        list.querySelectorAll('.filter-checkbox-item').forEach(function (label) {
            var t = label.querySelector('.type-label').textContent.toLowerCase();
            label.style.display = t.indexOf(q) >= 0 ? 'flex' : 'none';
        });
    }

    function applyFiltersAndSort() {
        if (!gridInstance) return;
        var data = originalGridData.slice();
        for (var c = 0; c < 6; c++) {
            if (activeFilters[c] && activeFilters[c].length) {
                data = data.filter(function (row) { return activeFilters[c].indexOf(getColValue(row, c)) >= 0; });
            }
        }
        if (currentSort.colIndex !== null && currentSort.colIndex !== undefined) {
            (function () {
                var col = currentSort.colIndex, dir = currentSort.direction;
                data.sort(function (a, b) {
                    var va = a[col], vb = b[col];
                    if (col === 1 || col === 2) {
                        va = Number(va) || 0; vb = Number(vb) || 0;
                        return dir === 'asc' ? va - vb : vb - va;
                    }
                    va = String(va === null || va === undefined ? '' : va);
                    vb = String(vb === null || vb === undefined ? '' : vb);
                    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                });
            })();
        }
        currentGridData = data;
        gridInstance.updateConfig({ data: data }).forceRender();
        setTimeout(function () {
            document.querySelectorAll('.filter-icon-btn').forEach(function (btn, c) {
                var isActive = !!(activeFilters[c] && activeFilters[c].length);
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent-color)' : '';
                btn.style.backgroundColor = isActive ? 'rgba(var(--accent-color-rgb), 0.1)' : '';
            });
        }, 50);
    }

    function applyColumnFilter() {
        var menu = document.getElementById('grid-filter-menu');
        if (!menu || currentFilterColIndex === null) return;
        var cbs = menu.querySelectorAll('input[type="checkbox"]');
        var selected = Array.prototype.filter.call(cbs, function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
        var decoded = selected.map(function (v) {
            var t = document.createElement('textarea');
            t.innerHTML = v;
            return t.value;
        });
        activeFilters[currentFilterColIndex] = (decoded.length === cbs.length || !decoded.length) ? [] : decoded;
        menu.classList.add('hidden');
        applyFiltersAndSort();
    }

    function sortGridByColumn(colIndex, direction) {
        var menu = document.getElementById('grid-filter-menu');
        if (menu) menu.classList.add('hidden');
        currentSort = { colIndex: colIndex, direction: direction };
        applyFiltersAndSort();
    }

    function buildCsvText() {
        var headers = ['Name', 'Size (Bytes)', 'Date (Timestamp)', 'Type', 'Encode', 'EOL'];
        var lines = [headers.join(',')];
        currentGridData.forEach(function (row) {
            lines.push(row.map(U().csvEscape).join(','));
        });
        return lines.join('\n') + '\n';
    }

    function downloadCsv() {
        var Status = FF.ui.Status;
        if (!gridInstance || !currentGridData.length) {
            if (Status) Status.error('No data to export');
            return false;
        }
        var blob = U().bomTextBlob(buildCsvText(), 'text/csv;charset=utf-8;');
        var roots = S().currentRootEntries;
        var name = roots.length === 1 ? roots[0].name + '_export.csv' : 'file_flow_export.csv';
        U().downloadBlob(blob, name);
        return true;
    }

    // fileEntries: [{entry, relPath}]（モデル層から受領）
    function renderFlatList(listEl, fileEntries, onProgress) {
        listEl.innerHTML = '';
        listEl.classList.remove('file-tree');
        listEl.classList.add('file-grid');

        var gridData = [];
        var CHUNK = (FF.constants && FF.constants.LIST_CHUNK) || 1000;
        var showFull = S().appSettings.showFullPath;
        var i = 0;

        function processChunk() {
            var chunk = fileEntries.slice(i, i + CHUNK);
            var jobs = chunk.map(function (item) {
                var pathKey = item.entry.fullPath || item.relPath;
                var meta = S().getMeta(pathKey);
                var type = item.entry.name.indexOf('.') >= 0
                    ? item.entry.name.split('.').pop().toLowerCase() : '';
                if (meta && meta.size !== undefined && meta.size !== '') {
                    var det = meta.detectionInfo || {};
                    var dn = meta.newFilename || item.entry.name;
                    gridData.push([
                        showFull ? (item.relPath || dn) : dn,
                        meta.size,
                        (meta.date === undefined || meta.date === null) ? '' : meta.date,
                        type,
                        det.encoding || meta.encoding || '-',
                        det.eol || meta.eol || '-'
                    ]);
                    return Promise.resolve();
                }
                return U().readEntryFile(item.entry).then(function (file) {
                    var size = file.size;
                    var date = file.lastModified;
                    return U().Detect.detectFileInfo(file).then(function (info) {
                        S().updateMeta(pathKey, { size: size, date: date, encoding: info.encoding, eol: info.eol });
                        var m2 = S().getMeta(pathKey) || {};
                        var name2 = m2.newFilename || item.entry.name;
                        gridData.push([
                            showFull ? (item.relPath || name2) : name2,
                            size, date, type, info.encoding, info.eol
                        ]);
                    });
                }).catch(function () {
                    gridData.push([showFull ? (item.relPath || item.entry.name) : item.entry.name, '', '', type, '-', '-']);
                });
            });
            return Promise.all(jobs).then(function () {
                i += CHUNK;
                if (onProgress) onProgress(Math.min(i, fileEntries.length), fileEntries.length);
                if (i < fileEntries.length) {
                    return new Promise(function (r) { setTimeout(r, 0); }).then(processChunk);
                }
            });
        }

        return processChunk().then(function () {
            originalGridData = gridData;
            currentGridData = gridData;
            activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
            currentSort = { colIndex: null, direction: 'asc' };

            var wrapper = document.createElement('div');
            wrapper.style.height = '100%';
            listEl.appendChild(wrapper);

            wrapper.addEventListener('click', function (e) {
                var filterBtn = e.target.closest ? e.target.closest('.filter-icon-btn') : null;
                if (filterBtn) {
                    e.stopPropagation();
                    toggleFilterMenu(
                        filterBtn,
                        parseInt(filterBtn.getAttribute('data-col-index'), 10),
                        filterBtn.getAttribute('data-col-name')
                    );
                }
            });

            var headerHTML = function (name, idx) {
                return '<div style="display:flex;align-items:center;justify-content:space-between;position:relative">' +
                    U().escapeHtml(name) +
                    '<button class="filter-icon-btn" title="Filter / Sort by ' + U().escapeAttr(name) + '"' +
                    ' data-col-index="' + idx + '" data-col-name="' + U().escapeAttr(name) + '">' +
                    U().Icons.filter + '</button></div>';
            };

            var cols = [
                { name: 'Name', id: 'Name', formatter: function (c) { return window.gridjs.html('<span class="grid-filename" title="' + U().escapeAttr(c) + '">' + U().escapeHtml(c) + '</span>'); } },
                { name: 'Size', id: 'Size', width: '120px', formatter: function (c) { return U().formatBytes(c); } },
                { name: 'Date', id: 'Date', width: '180px', formatter: function (c) { return U().escapeHtml(U().formatDate(c === '' ? null : c)); } },
                { name: 'Type', id: 'Type', width: '90px' },
                { name: 'Encode', id: 'Encode', width: '120px' },
                { name: 'EOL', id: 'EOL', width: '90px' }
            ].map(function (col, idx) {
                return Object.assign({}, col, { name: window.gridjs.html(headerHTML(col.name, idx)), sort: false });
            });

            if (!window.gridjs) throw new Error('Grid.js is not loaded (CDN required)');
            gridInstance = new window.gridjs.Grid({
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
        });
    }

    FF.views.Tree = { createTreeElement: createTreeElement, toggleFolder: toggleFolder, loadChildren: loadChildren, shouldInclude: shouldInclude };
    FF.views.List = {
        renderFlatList: renderFlatList,
        downloadCsv: downloadCsv,
        buildCsvText: buildCsvText,
        getCurrentData: function () { return currentGridData; },
        reset: function () {
            gridInstance = null; originalGridData = []; currentGridData = [];
            activeFilters = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
            currentSort = { colIndex: null, direction: 'asc' };
        }
    };
})();
