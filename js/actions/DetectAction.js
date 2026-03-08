// Detect Action
(function () {
    const BaseAction = FileFlow.actions.BaseAction;
    const FileSystem = FileFlow.utils.FileSystem;

    class DetectAction extends BaseAction {
        constructor() {
            super('detect', 'Detect Info');
        }

        shouldApply(entry, filename) {
            return !entry.isDirectory;
        }

        async execute(itemDiv, entry) {
            const file = await new Promise((resolve, reject) => {
                entry.file(resolve, reject);
            });

            const detectInfo = await FileFlow.utils.Detect.detectFileInfo(file);
            const encoding = detectInfo.encoding;
            const eol = detectInfo.eol;

            // Store on global state for lazy rendering
            if (!FileFlow.state.entryMetadata[entry.fullPath]) {
                FileFlow.state.entryMetadata[entry.fullPath] = {};
            }
            FileFlow.state.entryMetadata[entry.fullPath].detectionInfo = { encoding, eol };

            // Update UI if visible
            if (itemDiv) {
                const nameSpan = itemDiv.querySelector('.file-name');

                // Remove existing badges if any
                const existingBadges = itemDiv.querySelectorAll('.info-badge');
                existingBadges.forEach(b => b.remove());

                if (nameSpan) {
                    const badgeEnc = document.createElement('span');
                    badgeEnc.className = 'info-badge enc';
                    badgeEnc.textContent = encoding;
                    badgeEnc.style.cssText = "background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 8px; font-family: monospace;";

                    const badgeEol = document.createElement('span');
                    badgeEol.className = 'info-badge eol';
                    badgeEol.textContent = eol;
                    badgeEol.style.cssText = "background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-left: 4px; font-family: monospace;";

                    nameSpan.after(badgeEol);
                    nameSpan.after(badgeEnc); // Insert Enc before EOL
                }
            }
        }
    }

    FileFlow.actions.DetectAction = DetectAction;
    FileFlow.actions.ActionManager.register(new DetectAction());

})();
