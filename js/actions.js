// FileFlow — Action System
(function () {
    const State = FileFlow.state;

    // Base Action
    class BaseAction {
        constructor(id, label) { this.id = id; this.label = label; }
        shouldApply(entry) { return true; }
        async execute(itemDiv, entry) { throw new Error('Not implemented'); }
    }

    // Registry
    const registry = {};
    const ActionManager = {
        register(action) { registry[action.id] = action; },
        getAction(id) { return registry[id]; }
    };

    // --- Rename Action (.md / .txt) ---

    class RenameAction extends BaseAction {
        constructor(ext) {
            super(ext, `Add ${ext}`);
            this.ext = ext;
        }

        shouldApply(entry) {
            return !entry.isDirectory && !entry.name.toLowerCase().endsWith(this.ext.toLowerCase());
        }

        async execute(itemDiv, entry) {
            if (entry.name.toLowerCase().endsWith(this.ext.toLowerCase())) return;

            const newName = entry.name + this.ext;
            if (!State.entryMetadata[entry.fullPath]) State.entryMetadata[entry.fullPath] = {};
            State.entryMetadata[entry.fullPath].newFilename = newName;

            if (itemDiv) {
                const nameSpan = itemDiv.querySelector('.file-name');
                if (nameSpan) {
                    nameSpan.textContent = State.appSettings.viewMode === 'list'
                        ? nameSpan.textContent + this.ext : newName;
                }
                itemDiv.classList.add('renamed');
                itemDiv.downloadName = newName;
            }
        }
    }

    // --- Detect Action ---

    class DetectAction extends BaseAction {
        constructor() { super('detect', 'Detect Info'); }

        shouldApply(entry) { return !entry.isDirectory; }

        async execute(itemDiv, entry) {
            const file = await new Promise((res, rej) => entry.file(res, rej));
            const { encoding, eol } = await FileFlow.utils.Detect.detectFileInfo(file);

            if (!State.entryMetadata[entry.fullPath]) State.entryMetadata[entry.fullPath] = {};
            State.entryMetadata[entry.fullPath].detectionInfo = { encoding, eol };

            if (itemDiv) {
                itemDiv.querySelectorAll('.info-badge').forEach(b => b.remove());
                const nameSpan = itemDiv.querySelector('.file-name');
                if (nameSpan) {
                    const badge = (text, bg, color, ml) => {
                        const s = document.createElement('span');
                        s.className = 'info-badge';
                        s.textContent = text;
                        s.style.cssText = `background:${bg};color:${color};padding:2px 6px;border-radius:4px;font-size:.75rem;margin-left:${ml}px;font-family:monospace`;
                        return s;
                    };
                    nameSpan.after(badge(eol, 'rgba(168,85,247,.2)', '#c084fc', 4));
                    nameSpan.after(badge(encoding, 'rgba(56,189,248,.2)', '#38bdf8', 8));
                }
            }
        }
    }

    // Register
    ActionManager.register(new RenameAction('.md'));
    ActionManager.register(new RenameAction('.txt'));
    ActionManager.register(new DetectAction());

    FileFlow.actions = { BaseAction, ActionManager, RenameAction, DetectAction };
})();
