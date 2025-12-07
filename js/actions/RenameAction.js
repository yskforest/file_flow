// Rename Action
(function () {
    const BaseAction = FileFlow.actions.BaseAction;

    class RenameAction extends BaseAction {
        constructor(extension) {
            super(extension.replace('.', ''), `Add ${extension}`);
            this.extension = extension;

            // Text extensions we shouldn't append to
            this.textExtensions = [
                '.txt', '.md', '.json', '.js', '.html', '.css', '.xml', '.log', '.csv',
                '.ts', '.yml', '.yaml', '.sh', '.bat', '.py', '.java', '.c', '.cpp',
                '.h', '.hpp', '.cc', '.cxx', '.cs', '.php', '.rb', '.go', '.rs',
                '.swift', '.kt', '.sql', '.ini', '.cfg', '.conf'
            ].map(e => e.toLowerCase());
        }

        shouldApply(entry, filename) {
            if (entry.isDirectory) return false;

            const lowercaseName = filename.toLowerCase();

            // Don't append if already has extension
            if (lowercaseName.endsWith(this.extension.toLowerCase())) return false;

            // Check if it looks like a text file or binary
            // For now, we rely on the rudimentary check or assume everything is a candidate
            // In the original script, we checked known extensions.

            const hasTextExt = this.textExtensions.some(ext => lowercaseName.endsWith(ext));

            // If it has a known text extension that isn't the target one, we might still want to append?
            // The original logic was: if isText (based on content check which is expensive here) or extension

            // For bulk rename without reading content, we can only rely on extension or user intent.
            // Let's assume we apply to files that are NOT already the target extension.
            return true;
        }

        async execute(itemDiv, entry) {
            const originalName = entry.name;
            const lowercaseName = originalName.toLowerCase();
            const targetExtension = this.extension;

            // Simple check again
            if (lowercaseName.endsWith(targetExtension.toLowerCase())) return;

            const newName = originalName + targetExtension;

            const nameSpan = itemDiv.querySelector('.file-name');
            if (nameSpan) {
                // Determine view mode from global state to decide how to update text
                // But generally replace text content or append
                if (FileFlow.state.appSettings.viewMode === 'list') {
                    // In flat list, we might want to just append to the full path?
                    // original script logic: nameSpan.textContent = nameSpan.textContent + targetExtension;
                    // Use regex to replace end of string?
                    nameSpan.textContent = nameSpan.textContent + targetExtension;
                } else {
                    nameSpan.textContent = newName;
                }
            }
            itemDiv.classList.add('renamed');
            itemDiv.downloadName = newName;
        }
    }

    FileFlow.actions.RenameAction = RenameAction;

    // Register instances
    FileFlow.actions.ActionManager.register(new RenameAction('.md'));
    FileFlow.actions.ActionManager.register(new RenameAction('.txt'));

})();
