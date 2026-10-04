// FileFlow — Application Entry Point
(function () {
    const { $, Icons, Glob, FS } = FileFlow.utils;
    const State = FileFlow.state;
    const Render = FileFlow.ui.Render;
    const Status = FileFlow.ui.Status;
    const ActionManager = FileFlow.actions.ActionManager;

    function init() {
        injectIcons();
        FileFlow.ui.initModals();
        setupReactivity();
        loadSettings();
        bindEvents();
        updateModeDisplay();
    }

    // --- Icons ---

    function injectIcons() {
        $('view-toggle-btn').innerHTML = Icons.list;
        $('stats-btn').innerHTML = Icons.chart;
        $('settings-btn').innerHTML = Icons.gear;
        $('upload-icon').innerHTML = Icons.upload;
        $('clear-btn').innerHTML = Icons.trash;
    }

    // --- Reactivity ---

    function setupReactivity() {
        // Auto-save settings when changed
        State.subscribe('appSettings', (newSettings) => {
            try {
                localStorage.setItem('FileFlowSettings', JSON.stringify(newSettings));
            } catch (e) {
                console.warn('Failed to save settings', e);
            }
        });

        // Sync mode display badge and modal input
        State.subscribe('setting:actionMode', (val) => {
            updateModeDisplay();
            const radio = document.querySelector(`input[name="action-mode"][value="${val}"]`);
            if (radio) radio.checked = true;
        });

        // Sync setting checkbox and trigger render list
        State.subscribe('setting:excludeDots', (val) => {
            const dc = $('exclude-dots-checkbox');
            if (dc) dc.checked = val;
            Render.renderFileList();
        });

        State.subscribe('setting:showFullPath', (val) => {
            const fp = $('show-fullpath-checkbox');
            if (fp) fp.checked = val;
            Render.renderFileList();
        });

        // Sync view mode and trigger render list
        State.subscribe('setting:viewMode', () => {
            Render.renderFileList();
        });
    }

    // --- Settings ---

    function loadSettings() {
        try {
            const saved = localStorage.getItem('FileFlowSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                State.appSettings = { ...State.appSettings, ...parsed };
            }
        } catch (e) { console.warn('Failed to load settings', e); }

        // Sync UI state
        const dc = $('exclude-dots-checkbox');
        if (dc) dc.checked = State.appSettings.excludeDots;
        const fp = $('show-fullpath-checkbox');
        if (fp) fp.checked = State.appSettings.showFullPath;
        const radio = document.querySelector(`input[name="action-mode"][value="${State.appSettings.actionMode}"]`);
        if (radio) radio.checked = true;

        // Sync LLM export settings (旧 notebookLMConfig から移行)
        const llmCfg = State.appSettings.llmExportConfig || State.appSettings.notebookLMConfig || {};
        const llmPartSize = $('llm-max-part-size');
        if (llmPartSize) llmPartSize.value = llmCfg.maxPartSizeMB || 4;
        const llmFileSize = $('llm-max-file-size');
        if (llmFileSize) llmFileSize.value = llmCfg.maxSingleFileSizeMB || 1;
        const llmMaxFiles = $('llm-max-files-per-part');
        if (llmMaxFiles) llmMaxFiles.value = (llmCfg.maxFilesPerPart === 0) ? 0 : (llmCfg.maxFilesPerPart || 1000);
        const llmExts = $('llm-extensions');
        if (llmExts) llmExts.value = llmCfg.sourceExtensions || FileFlow.llmExport.getDefaultExtensionsString();
    }

    function updateModeDisplay() {
        const btn = $('mode-display-btn');
        if (!btn) return;
        const labels = { md: 'Add .md', txt: 'Add .txt', detect: 'Detect Info' };
        btn.textContent = `Mode: ${labels[State.appSettings.actionMode] || ''}`;
    }

    // --- Events ---

    function bindEvents() {
        const dropZone = $('drop-zone');

        // Drop
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', async e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const items = e.dataTransfer.items;
            if (!items) return;
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) entries.push(entry);
            }
            try {
                Status.show('Scanning files...', true);
                await new Promise(r => setTimeout(r, 50));
                State.currentRootEntries = entries;
                await Render.renderFileList();
                Status.hide(500);
            } catch (err) {
                console.error('Drop Handler Error:', err);
                Status.error('scanning files');
            }
        });

        // View Toggle
        $('view-toggle-btn').addEventListener('click', () => {
            State.appSettings.viewMode = State.appSettings.viewMode === 'tree' ? 'list' : 'tree';
        });

        // Settings Modal
        const settingsModal = $('settings-modal');
        $('settings-btn').addEventListener('click', () => settingsModal.classList.remove('hidden'));
        $('mode-display-btn').addEventListener('click', () => settingsModal.classList.remove('hidden'));

        // Settings Changes
        document.querySelectorAll('input[name="action-mode"]').forEach(radio => {
            radio.addEventListener('change', e => {
                State.appSettings.actionMode = e.target.value;
            });
        });

        const bindCheckbox = (id, key) => {
            const el = $(id);
            if (el) el.addEventListener('change', e => {
                State.appSettings[key] = e.target.checked;
            });
        };
        bindCheckbox('exclude-dots-checkbox', 'excludeDots');
        bindCheckbox('show-fullpath-checkbox', 'showFullPath');

        // LLM Export settings change handlers
        const saveLLMConfig = () => {
            const cfg = State.appSettings.llmExportConfig || State.appSettings.notebookLMConfig || {};
            const partSize = $('llm-max-part-size');
            if (partSize) cfg.maxPartSizeMB = parseFloat(partSize.value) || 4;
            const fileSize = $('llm-max-file-size');
            if (fileSize) cfg.maxSingleFileSizeMB = parseFloat(fileSize.value) || 1;
            const exts = $('llm-extensions');
            if (exts) cfg.sourceExtensions = exts.value;
            const maxFiles = $('llm-max-files-per-part');
            if (maxFiles) cfg.maxFilesPerPart = Math.max(0, parseInt(maxFiles.value, 10) || 0);
            State.appSettings.llmExportConfig = cfg;
            if (State.appSettings.notebookLMConfig) delete State.appSettings.notebookLMConfig;
        };
        ['llm-max-part-size', 'llm-max-file-size', 'llm-extensions', 'llm-max-files-per-part'].forEach(id => {
            const el = $(id);
            if (el) el.addEventListener('change', saveLLMConfig);
        });

        // Filter
        let debounce;
        $('filter-input').addEventListener('input', e => {
            State.searchQuery = e.target.value;
            clearTimeout(debounce);
            debounce = setTimeout(() => Render.applyFilter(), 300);
        });

        // Clear
        $('clear-btn').addEventListener('click', () => {
            State.currentRootEntries = [];
            State.entryMetadata = {};
            $('file-list').innerHTML = '';
            $('file-list-container').classList.add('hidden');
            $('drop-zone').classList.remove('hidden');
        });

        // Apply Action
        $('apply-btn').addEventListener('click', async () => {
            const action = ActionManager.resolve(State.appSettings.actionMode);
            if (!action) return;

            Status.show('Applying action...');
            await new Promise(r => setTimeout(r, 10));

            const matcher = Glob.createMatcher(State.searchQuery);
            const visibleItems = new Map();
            document.querySelectorAll('.item').forEach(div => {
                if (div.entry) visibleItems.set(div.entry.fullPath || div.entry.name, div);
            });
            const rootNames = State.currentRootEntries.map(r => r.name || '');
            const relOf = (entry) => (FileFlow.utils.Entries && FileFlow.utils.Entries.buildRelPath)
                ? FileFlow.utils.Entries.buildRelPath(entry, rootNames) || entry.name
                : entry.name;

            await FS.traverse(State.currentRootEntries, async entry => {
                if (entry.isFile && (!matcher || matcher(entry.name, relOf(entry))) && action.shouldApply(entry)) {
                    const res = await action.execute(entry);
                    FileFlow.ui.applyActionResult(entry, visibleItems.get(entry.fullPath || entry.name), res);
                }
                return true;
            }, { excludeDots: State.appSettings.excludeDots });

            if (State.appSettings.viewMode === 'list') Render.renderFileList();
            Status.hide();
        });

        // Downloads
        $('download-zip-btn').addEventListener('click', async () => {
            Status.show('Creating ZIP...');
            try { await FileFlow.utils.Zip.downloadZip(); }
            catch (e) { console.error(e); Status.error('ZIP creation failed'); }
            finally { Status.hide(); }
        });

        $('download-csv-btn').addEventListener('click', () => {
            if (State.appSettings.viewMode !== 'list') { Status.error('CSV download is only available in List View'); return; }
            try { Render.downloadCsv(); Status.show('CSV downloaded successfully'); }
            catch (e) { console.error(e); Status.error('CSV creation failed'); }
        });

        // LLM Export (Preview & Export)
        $('export-llm-btn').addEventListener('click', async () => {
            try { await FileFlow.llmExport.showVcxprojPreviewModal(); }
            catch (e) { console.error(e); Status.error('Failed to open VS Projects preview: ' + e.message); }
        });

        // Stats
        $('stats-btn').addEventListener('click', () => FileFlow.ui.Stats.show());
    }

    init();
})();
