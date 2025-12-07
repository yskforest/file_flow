// Main Entry Point
(function () {

    // Shortcuts
    const Render = FileFlow.ui.Render;
    const Status = FileFlow.ui.Status;
    const Zip = FileFlow.utils.Zip;
    const ActionManager = FileFlow.actions.ActionManager;
    const State = FileFlow.state;

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const viewToggleBtn = document.getElementById('view-toggle-btn');
    const viewIconTree = document.getElementById('view-icon-tree');
    const viewIconList = document.getElementById('view-icon-list');
    const statsBtn = document.getElementById('stats-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const statsModal = document.getElementById('stats-modal');
    const closeStatsBtn = document.getElementById('close-stats-btn');
    const filterInput = document.getElementById('filter-input');
    const clearBtn = document.getElementById('clear-btn');
    const applyBtn = document.getElementById('apply-btn');
    const downloadZipBtn = document.getElementById('download-zip-btn');
    const modeDisplayBtn = document.getElementById('mode-display-btn');

    // Init
    function init() {
        setupEventListeners();
        updateModeDisplay();
    }

    function setupEventListeners() {
        // Drop Zone
        dropZone.addEventListener('click', () => {
            // Optional: File picker support could go here
        });

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
                const entries = [];
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry();
                    if (entry) entries.push(entry);
                }

                try {
                    Status.show("Scanning files...");
                    // Small delay to let UI render
                    await new Promise(r => setTimeout(r, 50));

                    await handleEntries(entries);
                    Status.hide(500);
                } catch (err) {
                    console.error("Drop Handler Error:", err);
                    Status.error("scanning files");
                }
            }
        });

        // View Toggle
        viewToggleBtn.addEventListener('click', () => {
            State.appSettings.viewMode = State.appSettings.viewMode === 'tree' ? 'list' : 'tree';

            // Icon Toggle
            if (State.appSettings.viewMode === 'tree') {
                viewIconTree.classList.remove('hidden');
                viewIconList.classList.add('hidden');
            } else {
                viewIconTree.classList.add('hidden');
                viewIconList.classList.remove('hidden');
            }

            Render.renderFileList();
        });

        // Settings Modal
        settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
        closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });

        // Settings Changes
        const modeRadios = document.querySelectorAll('input[name="action-mode"]');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                State.appSettings.actionMode = e.target.value;
                updateModeDisplay();
            });
        });

        const dotCheck = document.getElementById('exclude-dots-checkbox');
        dotCheck.addEventListener('change', (e) => {
            State.appSettings.excludeDots = e.target.checked;
            Render.renderFileList();
        });

        // Mode Button (Quick Switch? Or just display?)
        modeDisplayBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });

        // Filter
        let debounceTimer;
        filterInput.addEventListener('input', (e) => {
            State.searchQuery = e.target.value;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                Render.applyFilter();
            }, 300);
        });

        // Clear List
        clearBtn.addEventListener('click', () => {
            State.currentRootEntries = [];
            State.entryMetadata = {}; // Clear per-file persistent state
            document.getElementById('file-list').innerHTML = '';
            document.getElementById('file-list-container').classList.add('hidden');
            dropZone.classList.remove('hidden');
        });

        // Apply Action (Deep Recursive)
        applyBtn.addEventListener('click', async () => {
            const mode = State.appSettings.actionMode;
            const action = ActionManager.getAction(mode === 'detect' ? 'detect' : '.' + mode);

            if (!action) {
                console.error("No action found for mode:", mode);
                return;
            }

            Status.show("Applying action..."); // Initial
            await new Promise(r => setTimeout(r, 10));

            // Setup Filter Matcher (Same as Stats)
            const query = State.searchQuery;
            let matchFn = null;
            if (query && query.trim() !== '') {
                const patterns = query.split(/[\s,]+/).filter(s => s.length > 0);
                const includePatterns = patterns.filter(p => !p.startsWith('!')).map(p => FileFlow.utils.Glob.globToRegex(p));
                const excludePatterns = patterns.filter(p => p.startsWith('!')).map(p => FileFlow.utils.Glob.globToRegex(p.slice(1)));

                matchFn = (name) => {
                    for (const regex of excludePatterns) if (regex.test(name)) return false;
                    if (includePatterns.length === 0) return true;
                    for (const regex of includePatterns) if (regex.test(name)) return true;
                    return false;
                };
            }

            // Build Map of visible items for live updates
            const visibleItemMap = new Map();
            document.querySelectorAll('.item').forEach(div => {
                if (div.entry) visibleItemMap.set(div.entry.fullPath, div);
            });

            // Recursive Runner
            async function runTraverse(entry) {
                // Dotfile check
                if (State.appSettings.excludeDots && entry.name.startsWith('.')) return;

                if (entry.isDirectory) {
                    const reader = entry.createReader();
                    const readAll = async () => {
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
                    const children = await readAll();
                    for (const child of children) await runTraverse(child);
                } else {
                    // File
                    const isMatch = matchFn ? matchFn(entry.name) : true;
                    if (isMatch) {
                        // Apply Action
                        if (action.shouldApply(entry, entry.name)) {
                            // Check if visible using fullPath as key
                            const itemDiv = visibleItemMap.get(entry.fullPath);

                            // Pass itemDiv (can be undefined) to execute
                            // Action will update Global Metadata and UI if itemDiv exists
                            await action.execute(itemDiv, entry);
                        }
                    }
                }
            }

            // Run
            for (const root of State.currentRootEntries) {
                await runTraverse(root);
            }

            Status.hide();
        });

        // Download Zip
        downloadZipBtn.addEventListener('click', async () => {
            Status.show("Creating ZIP...");
            try {
                await Zip.downloadZip();
            } catch (e) {
                console.error(e);
                Status.error("ZIP creation failed");
            } finally {
                Status.hide();
            }
        });

        // Stats (Deep Scan)
        statsBtn.addEventListener('click', async () => {
            // Calculate stats
            const stats = await calculateStats();
            renderStats(stats);
            statsModal.classList.remove('hidden');
        });
        closeStatsBtn.addEventListener('click', () => statsModal.classList.add('hidden'));

    }

    async function handleEntries(entries) {
        State.currentRootEntries = entries;
        await Render.renderFileList();
    }

    function updateModeDisplay() {
        if (modeDisplayBtn) {
            let modeText = '';
            if (State.appSettings.actionMode === 'md') modeText = 'Add .md';
            else if (State.appSettings.actionMode === 'txt') modeText = 'Add .txt';
            else if (State.appSettings.actionMode === 'detect') modeText = 'Detect Info';

            modeDisplayBtn.textContent = `Mode: ${modeText}`;
        }
    }

    async function calculateStats() {
        // Show status because this might take time
        Status.show("Calculating statistics...");
        // Yield to render
        await new Promise(r => setTimeout(r, 10));

        let totalFiles = 0;
        let totalFolders = 0;
        const extCounts = {};

        const query = State.searchQuery;
        let matchFn = null;

        if (query && query.trim() !== '') {
            const patterns = query.split(/[\s,]+/).filter(s => s.length > 0);
            const includePatterns = patterns.filter(p => !p.startsWith('!')).map(p => FileFlow.utils.Glob.globToRegex(p));
            const excludePatterns = patterns.filter(p => p.startsWith('!')).map(p => FileFlow.utils.Glob.globToRegex(p.slice(1)));

            matchFn = (name) => {
                for (const regex of excludePatterns) {
                    if (regex.test(name)) return false;
                }
                if (includePatterns.length === 0) return true;
                for (const regex of includePatterns) {
                    if (regex.test(name)) return true;
                }
                return false;
            };
        }

        async function traverse(entry) {
            // Global exclude dots check
            if (State.appSettings.excludeDots && entry.name.startsWith('.')) return;

            if (entry.isDirectory) {
                totalFolders++;
                // If filtering, do we count folders? 
                // Usually stats count matching files. 
                // But let's count matching folders too? 
                // If filter is "*.js", folders don't match. 
                // But we must traverse them to find files.
                // Logic: Traversal is independent of match, counting is dependent?
                // Or: matchFn applies to current entry.

                // Note: The UI filter logic hides non-matching items.
                // If I search "*.js", folders are hidden unless they contain *.js.
                // The User asked: "Filter filtered things only".
                // If I search "*.js", I expect to see count of JS files. Folder count? Maybe 0 if folders don't match *.js?
                // Let's check name against matchFn.
                const isMatch = matchFn ? matchFn(entry.name) : true;

                // We ALWAYS traverse into folders to find files (unless folder itself is excluded by dotfiles)
                // But do we COUNT the folder?
                // If matchFn exists, only count if matches.
                // If matchFn is null (no filter), count.
                // Wait, if filter is *.js, folder "src" doesn't match.
                // So totalFolders should handle that.

                // However, we MUST traverse it.

                const reader = entry.createReader();
                const readAll = async () => {
                    let entries = [];
                    let done = false;
                    while (!done) {
                        try {
                            const results = await new Promise((resolve, reject) => {
                                reader.readEntries(resolve, reject);
                            });
                            if (results.length === 0) done = true;
                            else entries = entries.concat(results);
                        } catch (e) {
                            console.warn("Read error:", e);
                            done = true;
                        }
                    }
                    return entries;
                };

                const children = await readAll();
                for (const child of children) {
                    await traverse(child);
                }

                // Adjust folder count based on filter
                if (matchFn && !isMatch) {
                    totalFolders--;
                }

            } else {
                // File
                const isMatch = matchFn ? matchFn(entry.name) : true;
                if (isMatch) {
                    totalFiles++;
                    const name = entry.name;
                    const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : 'no-ext';
                    extCounts[ext] = (extCounts[ext] || 0) + 1;
                }
            }
        }

        for (const root of State.currentRootEntries) {
            await traverse(root);
        }

        Status.hide();
        return { totalFiles, totalFolders, extCounts };
    }

    function renderStats(stats) {
        const container = document.getElementById('stats-content');
        let html = `
            <div class="stats-summary">
                <div class="stat-box">
                     <div class="label">Files</div>
                     <div class="value">${stats.totalFiles}</div>
                </div>
                <div class="stat-box">
                     <div class="label">Folders</div>
                     <div class="value">${stats.totalFolders}</div>
                </div>
            </div>
            <h3>Extensions</h3>
            <table class="stats-table">
                <thead><tr><th>Extension</th><th>Count</th></tr></thead>
                <tbody>
        `;

        const sortedExts = Object.entries(stats.extCounts).sort((a, b) => b[1] - a[1]);
        for (const [ext, count] of sortedExts) {
            html += `<tr><td>${ext}</td><td>${count}</td></tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Run
    init();

})();
