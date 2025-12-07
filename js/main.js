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
            document.getElementById('file-list').innerHTML = '';
            document.getElementById('file-list-container').classList.add('hidden');
            dropZone.classList.remove('hidden');
        });

        // Apply Action
        applyBtn.addEventListener('click', async () => {
            const mode = State.appSettings.actionMode;
            const action = ActionManager.getAction(mode);

            // Handle 'md' / 'txt' which map to 'RenameAction' with extension arg
            // But our registry uses ID like '.md'.

            let targetAction = null;
            if (mode === 'detect') {
                targetAction = ActionManager.getAction('detect');
            } else {
                targetAction = ActionManager.getAction('.' + mode);
            }

            if (!targetAction) {
                console.error("No action found for mode:", mode);
                return;
            }

            Status.show("Applying action...");
            // Iterate visible items
            const list = document.getElementById('file-list');
            // We need to iterate DOM to find items.
            // Best to select all '.item' that are not inside a hidden container?
            // Or just iterate all '.item' and check if filtered out?

            const items = Array.from(list.querySelectorAll('.item'));
            const total = items.length;
            let processed = 0;

            // Heuristic: batch process to avoid freezing UI
            const chunks = [];
            const chunkSize = 50;
            for (let i = 0; i < total; i += chunkSize) {
                chunks.push(items.slice(i, i + chunkSize));
            }

            for (const chunk of chunks) {
                await new Promise(r => setTimeout(r, 0)); // yield
                for (const itemDiv of chunk) {
                    // check filter
                    // The li is parent of itemDiv? No itemDiv is child of li.
                    const li = itemDiv.closest('li');
                    if (li && li.classList.contains('filtered-out')) continue;

                    const entry = itemDiv.entry; // Stored on DOM
                    if (entry && targetAction.shouldApply(entry, itemDiv.querySelector('.file-name').textContent)) {
                        await targetAction.execute(itemDiv, entry);
                    }
                }
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

        // Stats (Simple Layout)
        statsBtn.addEventListener('click', () => {
            // Calculate stats
            const stats = calculateStats();
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

    function calculateStats() {
        let totalFiles = 0;
        let totalFolders = 0;
        const extCounts = {};

        // We need to traverse everything for accurate stats
        // Cannot rely on DOM if tree is collapsed.
        // We need a helper to iterate all entries from State.currentRootEntries
        // But FileSystem traversal is async and we don't want to re-read everything if possible?
        // Actually, render logic already read them?
        // In Tree mode, expanding reads files. If not expanded, we don't know children.
        // So accurate stats require full traversal.

        // For now, let's just count WHAT IS LOADED/RENDERED in the DOM for simplicity, 
        // OR warn user that stats might be partial if tree not fully expanded.
        // Re-traversing is safer but slower. 
        // Let's rely on Render's traverseFiles Logic?

        // Actually, `Render.renderFlatList` does full traversal.
        // Let's assume we can reuse that traversal logic or accept that stats are simple for now.
        // Given user request for stats... let's do a quick deep scan if possible. 
        // But scanning 1000s files takes time.

        // Simpler approach: Iterate current DOM items. If user hasn't expanded tree, we only know top level.
        // This is a trade-off. 
        // BUT, `renderFlatList` is available. Let's lazily call the traversal that `renderFlatList` uses?
        // That function is inside Render closure.

        // Let's implement a simple DOM-based stat for now (Visible items) or
        // Just say "Items Loaded".

        const allItems = document.querySelectorAll('.item');
        allItems.forEach(div => {
            const entry = div.entry;
            if (entry.isDirectory) totalFolders++;
            else {
                totalFiles++;
                const name = entry.name;
                const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : 'no-ext';
                extCounts[ext] = (extCounts[ext] || 0) + 1;
            }
        });

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
