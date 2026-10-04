// FileFlow — UI Layer
(function () {
    const { $, formatBytes, formatDate, Icons, Glob, FS, Detect, downloadBlob } = FileFlow.utils;
    const { escapeHtml, escapeAttr } = FileFlow.utils;
    const State = FileFlow.state;

    // =====================
    //  Status Toast
    // =====================

    let hideTimeout = null;
    let showToken = 0;
    const Status = {
        show(msg, isLoading = false) {
            clearTimeout(hideTimeout);
            const token = ++showToken;
            const toast = $('status-toast'), text = $('status-text');
            if (!toast || !text) return;
            text.textContent = msg;
            toast.classList.remove('hidden');
            const spinner = toast.querySelector('.spinner');
            if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
            if (!isLoading) hideTimeout = setTimeout(() => { if (token === showToken) toast.classList.add('hidden'); }, 3000);
        },
        hide(delay = 0) {
            clearTimeout(hideTimeout);
            const token = showToken;
            const toast = $('status-toast');
            if (!toast) return;
            delay > 0 ? (hideTimeout = setTimeout(() => { if (token === showToken) toast.classList.add('hidden'); }, delay)) : toast.classList.add('hidden');
        },
        error(msg) { Status.show(`Error: ${msg}`); }
    };

    // =====================
    //  Modal Factory
    // =====================

    let escBound = false;
    function createModal(id, title, bodyHTML) {
        const { escapeHtml } = FileFlow.utils;
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
                    <h3>${escapeHtml(title)}</h3>
                    <button class="icon-btn close-modal-btn">${Icons.close}</button>
                </div>
                <div class="modal-body">${bodyHTML}</div>
            </div>`;
        const close = () => modal.classList.add('hidden');
        modal.querySelector('.close-modal-btn').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
        if (!escBound) {
            escBound = true;
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape') {
                    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
                    const gf = document.getElementById('grid-filter-menu');
                    if (gf) gf.classList.add('hidden');
                }
            });
        }
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
            </div>
            <div class="setting-group">
                <h4>LLM Export Settings</h4>
                <div class="setting-item-block">
                    <label class="setting-label">Max part size (MB)</label>
                    <input type="number" id="llm-max-part-size" class="setting-input-sm" value="4" min="1" max="50" step="1">
                </div>
                <div class="setting-item-block">
                    <label class="setting-label">Max single file size (MB)</label>
                    <input type="number" id="llm-max-file-size" class="setting-input-sm" value="1" min="0.1" max="10" step="0.1">
                </div>
                <div class="setting-item-block">
                    <label class="setting-label">Target extensions (comma separated)</label>
                    <textarea id="llm-extensions" class="setting-textarea" rows="3"></textarea>
                </div>
            </div>`);
        createModal('stats-modal', 'Statistics', '<div id="stats-content"></div>');
        createModal('vcxproj-modal', 'Visual Studio Projects & LLM Export Preview', '<div id="vcxproj-preview-content"></div>');
    }

    // =====================
    //  Action Result Rendering (DOM反映の一元化・XSS安全)
    // =====================

    function renderBadgesInto(itemDiv, info) {
        itemDiv.querySelectorAll('.info-badge').forEach(b => b.remove());
        const nameSpan = itemDiv.querySelector('.file-name');
        if (!nameSpan || !info) return;
        const badge = (text, bg, color, ml) => {
            const s = document.createElement('span');
            s.className = 'info-badge';
            s.textContent = text;
            s.style.cssText = `background:${bg};color:${color};padding:2px 6px;border-radius:4px;font-size:.75rem;margin-left:${ml}px;font-family:monospace`;
            return s;
        };
        nameSpan.after(badge(info.eol, 'rgba(168,85,247,.2)', '#c084fc', 4));
        nameSpan.after(badge(info.encoding, 'rgba(56,189,248,.2)', '#38bdf8', 8));
    }

    function applyActionResult(entry, itemDiv, result) {
        if (!result || !result.applied || !itemDiv) return;
        if (result.newName) {
            const nameSpan = itemDiv.querySelector('.file-name');
            if (nameSpan) {
                if (State.appSettings.viewMode === 'list' && nameSpan.textContent.includes('/')) {
                    const parts = nameSpan.textContent.split('/');
                    parts[parts.length - 1] = result.newName;
                    nameSpan.textContent = parts.join('/');
                } else {
                    nameSpan.textContent = result.newName;
                }
            }
            itemDiv.classList.add('renamed');
            itemDiv.downloadName = result.newName;
        }
        if (result.encoding) renderBadgesInto(itemDiv, { encoding: result.encoding, eol: result.eol });
    }

    // ツリー遅延読込時から参照できる公開フック（views.js が遅延解決する）
    const TreeHooks = {
        renderBadges: renderBadgesInto,
        onFileClick: async (entry, div) => {
            const action = FileFlow.actions.ActionManager.resolve(State.appSettings.actionMode);
            if (action && action.shouldApply(entry)) {
                applyActionResult(entry, div, await action.execute(entry));
            }
        }
    };

    // =====================
    //  Main Render
    // =====================

    function applyTreeFilter(listEl, matcher) {
        const rootNames = State.currentRootEntries.map(r => r.name || '');
        listEl.querySelectorAll('li').forEach(li => {
            const item = li.querySelector('.item');
            const entry = (item && item.entry) || li.entry;
            if (!entry || entry.isDirectory) return;
            const rel = FileFlow.utils.Entries.buildRelPath(entry, rootNames) || entry.name;
            li.classList.toggle('filtered-out', !matcher(entry.name, rel));
        });
    }

    async function renderFileList() {
        const list = $('file-list');
        if (!list) return;
        const matcher = Glob.createMatcher(State.searchQuery);
        const container = $('file-list-container'), dropZone = $('drop-zone');

        if (State.currentRootEntries.length > 0) {
            if (container) container.classList.remove('hidden');
            if (dropZone) dropZone.classList.add('hidden');

            if (State.appSettings.viewMode === 'tree') {
                list.innerHTML = '';
                list.classList.add('file-tree');
                list.classList.remove('file-grid');
                FileFlow.views.List.reset();
                const autoExpand = State.currentRootEntries.length === 1 && State.currentRootEntries[0].isDirectory;
                for (const entry of State.currentRootEntries) {
                    if (!FileFlow.views.Tree.shouldInclude(entry)) continue;
                    const el = FileFlow.views.Tree.createTreeElement(entry, TreeHooks);
                    list.appendChild(el);
                    if (!matcher && autoExpand) {
                        const toggle = el.querySelector('.item.folder-toggle');
                        if (toggle) await FileFlow.views.Tree.toggleFolder(toggle);
                    }
                }
                if (matcher) applyTreeFilter(list, matcher);
            } else {
                Status.show('Processing files...', true);
                try {
                    const items = await FileFlow.utils.Entries.collectFiles(State.currentRootEntries, {
                        matcher, excludeDots: State.appSettings.excludeDots
                    });
                    Status.show('Finalizing UI...', true);
                    await FileFlow.views.List.renderFlatList(list, items, (done, total) => {
                        Status.show(`Processing files... (${done} / ${total})`, true);
                    });
                    Status.hide(500);
                } catch (e) {
                    console.error(e);
                    Status.error('List render failed');
                }
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
        const roots = State.currentRootEntries || [];
        const rootNames = roots.map(r => r.name || '');
        const relOf = (entry) => FileFlow.utils.Entries.buildRelPath(entry, rootNames) || entry.name;

        // 単一走査（relパス追跡でGlobのパス対応を統計にも適用）
        async function walk(entries, prefix) {
            for (const entry of entries) {
                const rel = entry.fullPath ? relOf(entry) : (prefix ? `${prefix}/${entry.name}` : entry.name);
                if (State.appSettings.excludeDots && entry.name && entry.name.startsWith('.')) {
                    if (entry.isDirectory) ignoredFolders[entry.name] = (ignoredFolders[entry.name] || 0) + 1;
                    continue;
                }
                const isMatch = !matcher || matcher(entry.name, rel);
                if (entry.isDirectory) {
                    if (isMatch) totalFolders++;
                    await walk(await FS.readDir(entry), rel);
                } else if (isMatch) {
                    totalFiles++;
                    const ext = entry.name.includes('.') ? '.' + entry.name.split('.').pop().toLowerCase() : 'no-ext';
                    extCounts[ext] = (extCounts[ext] || 0) + 1;
                    const meta = State.getMeta(entry.fullPath || entry.name);
                    if (meta && meta.size !== undefined && meta.size !== '') { totalFileSize += Number(meta.size) || 0; }
                    else { try { totalFileSize += (await FileFlow.utils.readEntryFile(entry)).size || 0; } catch { /* skip */ } }
                }
            }
        }
        await walk(roots, '');

        Status.hide();
        return { totalFiles, totalFolders, extCounts, totalFileSize, ignoredFolders };
    }

    function renderStats(stats) {
        const totalIgnored = Object.values(stats.ignoredFolders).reduce((a, b) => a + b, 0);
        const extRows = Object.entries(stats.extCounts).sort((a, b) => b[1] - a[1])
            .map(([ext, n]) => `<tr><td>${escapeHtml(ext)}</td><td>${escapeHtml(String(n))}</td></tr>`).join('');

        let ignoredHTML = '';
        if (totalIgnored > 0) {
            const rows = Object.entries(stats.ignoredFolders).sort((a, b) => b[1] - a[1])
                .map(([name, n]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(String(n))}</td></tr>`).join('');
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
    //  LLM Export & Preview Modal
    // =====================

    const VcxprojPreview = {
        show(data) {
            const container = $('vcxproj-preview-content');
            if (!container) return;

            const { projects, fileItems, totalSizeBytes, activeFilterLabel } = data;
            const config = FileFlow.llmExport.getExportConfig();

            // Default state
            let currentMode = projects.length > 0 ? 'vcxproj' : 'folder_structure';
            let currentExt = config.ext || '.md';
            let currentPartSizeMB = config.maxPartSizeBytes
                ? config.maxPartSizeBytes / (1024 * 1024)
                : 4;

            // Render container shell
            container.innerHTML = `
                <div class="export-options-bar">
                    <div class="option-section">
                        <label class="option-label">解析モード (Export Mode)</label>
                        <div class="segmented-control" id="export-mode-toggle">
                            <button type="button" class="segment-btn ${currentMode === 'vcxproj' ? 'active' : ''}" data-mode="vcxproj" ${projects.length === 0 ? 'disabled title="vcxprojファイルが検出されませんでした"' : ''}>
                                📦 vcxproj モード ${projects.length > 0 ? `(${projects.length})` : ''}
                            </button>
                            <button type="button" class="segment-btn ${currentMode === 'folder_structure' ? 'active' : ''}" data-mode="folder_structure">
                                📁 フォルダ構造モード
                            </button>
                        </div>
                    </div>

                    <div class="option-section">
                        <label class="option-label">出力拡張子 (Format)</label>
                        <div class="segmented-control" id="export-ext-toggle">
                            <button type="button" class="segment-btn ${currentExt === '.md' ? 'active' : ''}" data-ext=".md">.md (OKF Markdown)</button>
                            <button type="button" class="segment-btn ${currentExt === '.txt' ? 'active' : ''}" data-ext=".txt">.txt (Text)</button>
                        </div>
                    </div>
                </div>

                <div class="export-size-bar">
                    <label class="option-label">ファイル分割サイズ (Part Size Limit)</label>
                    <div class="size-presets">
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 1 ? 'active' : ''}" data-mb="1">1 MB</button>
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 2 ? 'active' : ''}" data-mb="2">2 MB</button>
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 4 ? 'active' : ''}" data-mb="4">4 MB (LLM)</button>
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 8 ? 'active' : ''}" data-mb="8">8 MB</button>
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 16 ? 'active' : ''}" data-mb="16">16 MB</button>
                        <button type="button" class="size-preset-btn ${currentPartSizeMB === 0 ? 'active' : ''}" data-mb="0">分割なし (一括)</button>
                        <div class="custom-size-wrapper">
                            <input type="number" id="custom-part-mb-input" class="custom-mb-input" placeholder="カスタム" min="1" max="500" value="${[1,2,4,8,16,0].includes(currentPartSizeMB) ? '' : currentPartSizeMB}">
                            <span class="mb-unit">MB</span>
                        </div>
                    </div>
                </div>

                <div class="stats-summary vcxproj-summary">
                    <div class="stat-box">
                        <div class="label">選択モード</div>
                        <div class="value" id="preview-mode-name" style="font-size:0.95rem;color:var(--accent-color)">
                            ${currentMode === 'vcxproj' ? 'vcxproj (VS Proj)' : 'フォルダ構造'}
                        </div>
                    </div>
                    <div class="stat-box">
                        <div class="label">対象ファイル</div>
                        <div class="value" id="preview-file-count">${fileItems.length.toLocaleString()}</div>
                    </div>
                    <div class="stat-box">
                        <div class="label">元データ容量</div>
                        <div class="value" id="preview-total-size">${formatBytes(totalSizeBytes)}</div>
                    </div>
                    <div class="stat-box">
                        <div class="label">推定出力ファイル数</div>
                        <div class="value" id="preview-parts-count">1</div>
                    </div>
                    ${activeFilterLabel ? `
                    <div class="stat-box">
                        <div class="label">適用フィルタ</div>
                        <div class="value" style="font-size:0.8rem;color:var(--accent-color)">${escapeHtml(activeFilterLabel)}</div>
                    </div>` : ''}
                </div>

                <div id="export-mode-view-container"></div>

                <div class="modal-actions-footer">
                    <button class="text-btn outline" id="vcxproj-cancel-btn">Cancel</button>
                    <button class="text-btn llm-export-btn" id="vcxproj-execute-btn">Execute Export for LLM</button>
                </div>`;

            const modal = $('vcxproj-modal');
            modal.classList.remove('hidden');

            // --- Inner Render Function ---
            const updatePreview = () => {
                const partsCountEl = modal.querySelector('#preview-parts-count');
                const modeNameEl = modal.querySelector('#preview-mode-name');
                const viewContainer = modal.querySelector('#export-mode-view-container');

                modeNameEl.textContent = currentMode === 'vcxproj' ? 'vcxproj (VS Proj)' : 'フォルダ構造';

                // Recalculate parts count
                const partSizeBytes = currentPartSizeMB > 0 ? currentPartSizeMB * 1024 * 1024 : Infinity;
                const estParts = (currentPartSizeMB === 0 || partSizeBytes === Infinity)
                    ? 1
                    : Math.max(1, Math.ceil(totalSizeBytes / partSizeBytes));

                partsCountEl.textContent = estParts > 1 ? `${estParts} ファイル (.zip)` : `1 ファイル`;

                // Render mode content view
                if (currentMode === 'vcxproj') {
                    let projectListHTML = '';
                    if (projects.length === 0) {
                        projectListHTML = `
                            <div class="empty-vcxproj-notice">
                                <p>No Visual Studio (.vcxproj) project files detected in the loaded folder.</p>
                                <p class="sub-text">Switch to <strong>フォルダ構造モード</strong> above to export using disk directory structure.</p>
                            </div>`;
                    } else {
                        projectListHTML = projects.map(p => {
                            const srcCount = p.sourceFiles.length;
                            const hdrCount = p.headerFiles.length;
                            const resCount = p.resourceFiles.length;
                            const configs = p.configurations.length ? p.configurations.map(escapeHtml).join(', ') : 'Default';

                            const definesBadges = p.defines.slice(0, 10).map(d =>
                                `<span class="tag-badge define-tag" title="${escapeAttr(d)}">${escapeHtml(d)}</span>`
                            ).join('') + (p.defines.length > 10 ? `<span class="tag-badge define-tag">+${p.defines.length - 10} more</span>` : '');

                            const includeBadges = p.includeDirs.slice(0, 5).map(inc =>
                                `<span class="tag-badge inc-tag" title="${escapeAttr(inc)}">${escapeHtml(inc)}</span>`
                            ).join('') + (p.includeDirs.length > 5 ? `<span class="tag-badge inc-tag">+${p.includeDirs.length - 5} more</span>` : '');

                            return `
                                <div class="vcxproj-card">
                                    <div class="vcxproj-card-header">
                                        <label class="vcxproj-checkbox-label">
                                            <input type="checkbox" class="vcxproj-select-cb" data-proj-name="${escapeAttr(p.name)}" checked>
                                            <span class="vcxproj-name">${escapeHtml(p.name)}.vcxproj</span>
                                        </label>
                                        <span class="vcxproj-path" title="${escapeAttr(p.path)}">${escapeHtml(p.path)}</span>
                                    </div>
                                    <div class="vcxproj-card-body">
                                        <div class="vcxproj-stat-row">
                                            <span class="vstat"><strong>Sources:</strong> ${srcCount}</span>
                                            <span class="vstat"><strong>Headers:</strong> ${hdrCount}</span>
                                            <span class="vstat"><strong>Resources:</strong> ${resCount}</span>
                                            <span class="vstat"><strong>Configs:</strong> ${configs}</span>
                                        </div>
                                        ${p.defines.length ? `<div class="vcxproj-tags-row"><span class="tags-label">Defines:</span> <div class="tags-wrapper">${definesBadges}</div></div>` : ''}
                                        ${p.includeDirs.length ? `<div class="vcxproj-tags-row"><span class="tags-label">Includes:</span> <div class="tags-wrapper">${includeBadges}</div></div>` : ''}
                                    </div>
                                </div>`;
                        }).join('');
                    }

                    viewContainer.innerHTML = `
                        <div class="vcxproj-list-container">
                            <div class="vcxproj-list-header">
                                <h4>Visual Studio Projects (${projects.length})</h4>
                                ${projects.length > 0 ? `
                                <div class="vcxproj-bulk-actions">
                                    <a href="#" id="vcxproj-select-all">Select All</a> | 
                                    <a href="#" id="vcxproj-clear-all">Clear All</a>
                                </div>` : ''}
                            </div>
                            <div class="vcxproj-cards-scroll">
                                ${projectListHTML}
                            </div>
                        </div>`;

                    const selectAllBtn = viewContainer.querySelector('#vcxproj-select-all');
                    const clearAllBtn = viewContainer.querySelector('#vcxproj-clear-all');
                    if (selectAllBtn) {
                        selectAllBtn.addEventListener('click', e => {
                            e.preventDefault();
                            viewContainer.querySelectorAll('.vcxproj-select-cb').forEach(cb => cb.checked = true);
                        });
                    }
                    if (clearAllBtn) {
                        clearAllBtn.addEventListener('click', e => {
                            e.preventDefault();
                            viewContainer.querySelectorAll('.vcxproj-select-cb').forEach(cb => cb.checked = false);
                        });
                    }

                } else {
                    // Folder structure view
                    viewContainer.innerHTML = `
                        <div class="folder-structure-preview-box">
                            <div class="folder-preview-header">
                                <h4>📁 Physical Folder Structure Overview (OKF Format)</h4>
                                <span class="folder-preview-note">OKF Frontmatter &amp; ASCII Tree will be automatically prepended to the exported ${escapeHtml(currentExt)} files.</span>
                            </div>
                            <div class="folder-tree-box">
                                <pre class="ascii-tree-preview">${_buildTreeSnippet(fileItems)}</pre>
                            </div>
                        </div>`;
                }
            };

            // Initial render
            updatePreview();

            // --- Event Listeners ---
            modal.querySelector('#vcxproj-cancel-btn').addEventListener('click', () => modal.classList.add('hidden'));

            // Mode switch
            modal.querySelectorAll('#export-mode-toggle .segment-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.hasAttribute('disabled')) return;
                    modal.querySelectorAll('#export-mode-toggle .segment-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentMode = btn.getAttribute('data-mode');
                    updatePreview();
                });
            });

            // Ext switch
            modal.querySelectorAll('#export-ext-toggle .segment-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    modal.querySelectorAll('#export-ext-toggle .segment-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentExt = btn.getAttribute('data-ext');
                    updatePreview();
                });
            });

            // Size presets
            modal.querySelectorAll('.size-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    modal.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentPartSizeMB = parseFloat(btn.getAttribute('data-mb'));
                    const customInput = modal.querySelector('#custom-part-mb-input');
                    if (customInput) customInput.value = '';
                    updatePreview();
                });
            });

            // Custom MB input
            const customInput = modal.querySelector('#custom-part-mb-input');
            if (customInput) {
                customInput.addEventListener('input', () => {
                    const val = parseFloat(customInput.value);
                    if (!isNaN(val) && val > 0) {
                        modal.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
                        currentPartSizeMB = val;
                        updatePreview();
                    }
                });
            }

            // Execute export button
            modal.querySelector('#vcxproj-execute-btn').addEventListener('click', async () => {
                const selectedCbs = [...modal.querySelectorAll('.vcxproj-select-cb:checked')];
                const selectedNames = (currentMode === 'vcxproj' && projects.length > 0)
                    ? selectedCbs.map(cb => cb.getAttribute('data-proj-name'))
                    : null;

                modal.classList.add('hidden');
                try {
                    await FileFlow.llmExport.exportForLLM({
                        selectedProjectNames: selectedNames,
                        mode: currentMode,
                        ext: currentExt,
                        maxPartSizeBytes: currentPartSizeMB > 0 ? currentPartSizeMB * 1024 * 1024 : 0
                    });
                } catch (err) {
                    console.error('Export error:', err);
                    Status.error('Export failed: ' + err.message);
                }
            });
        }
    };

    function _buildTreeSnippet(fileItems) {
        const root = {};
        for (const item of fileItems.slice(0, 80)) { // limit preview
            const parts = item.relativePath.split('/');
            let curr = root;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isFile = (i === parts.length - 1);
                if (!curr[part]) {
                    curr[part] = isFile ? null : {};
                }
                if (!isFile) curr = curr[part];
            }
        }

        const lines = [];
        function formatTree(node, prefix = '', depth = 1) {
            if (depth > 3) {
                lines.push(prefix + '└── ...');
                return;
            }
            const keys = Object.keys(node).sort((a, b) => {
                const aIsDir = node[a] !== null;
                const bIsDir = node[b] !== null;
                if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                return a.localeCompare(b);
            });
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const isLast = (i === keys.length - 1);
                const isDir = node[key] !== null;
                lines.push(prefix + (isLast ? '└── ' : '├── ') + key + (isDir ? '/' : ''));
                if (isDir) {
                    formatTree(node[key], prefix + (isLast ? '    ' : '│   '), depth + 1);
                }
            }
        }
        formatTree(root, '', 1);
        if (fileItems.length > 80) lines.push('└── ... (total ' + fileItems.length + ' files)');
        return lines.join('\n');
    }

    // =====================
    //  Export
    // =====================

    FileFlow.ui.Status = Status;
    FileFlow.ui.initModals = initModals;
    FileFlow.ui.applyActionResult = applyActionResult;
    FileFlow.ui.renderBadgesInto = renderBadgesInto;
    FileFlow.ui.TreeHooks = TreeHooks;
    FileFlow.ui.Render = {
        renderFileList, applyFilter: renderFileList,
        downloadCsv: (...args) => FileFlow.views.List.downloadCsv(...args)
    };
    FileFlow.ui.Stats = {
        async show() {
            renderStats(await calculateStats());
            $('stats-modal').classList.remove('hidden');
        }
    };
    FileFlow.ui.VcxprojPreview = VcxprojPreview;
})();
