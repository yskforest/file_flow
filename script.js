document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');
    const clearBtn = document.getElementById('clear-btn');
    const applyBtn = document.getElementById('apply-btn');
    const downloadZipBtn = document.getElementById('download-zip-btn');
    const modeDisplayBtn = document.getElementById('mode-display-btn'); // Badge

    // Settings Elements
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const excludeDotsCheckbox = document.getElementById('exclude-dots-checkbox');
    const actionModeRadios = document.getElementsByName('action-mode'); // Radio NodeList

    // App State
    let currentRootEntries = [];
    const appSettings = {
        excludeDotFiles: true,
        actionMode: 'md' // Default mode
    };

    // Initialize UI
    updateModeDisplay();

    // --- Event Listeners ---

    // Drag and Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');

        const items = e.dataTransfer.items;
        if (items) {
            handleItems(items);
        }
    });

    // Toolbar Actions
    clearBtn.addEventListener('click', () => {
        currentRootEntries = [];
        renderFileList();
        fileListContainer.classList.add('hidden');
    });

    applyBtn.addEventListener('click', () => {
        applyExtensionAction();
    });

    downloadZipBtn.addEventListener('click', () => {
        downloadZip();
    });

    // Settings Modal
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    // Badge Click -> Open Settings
    modeDisplayBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });

    // Settings Changes
    excludeDotsCheckbox.addEventListener('change', (e) => {
        appSettings.excludeDotFiles = e.target.checked;
        // Re-render the list with new settings
        renderFileList();
    });

    // Radio Button Changes (Mode)
    Array.from(actionModeRadios).forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                appSettings.actionMode = e.target.value;
                updateModeDisplay();
            }
        });
    });


    // --- Core Logic ---

    function updateModeDisplay() {
        const modeText = appSettings.actionMode === 'md' ? 'Add .md' : 'Add .txt';
        modeDisplayBtn.textContent = `Mode: ${modeText}`;
    }

    async function handleItems(items) {
        currentRootEntries = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry();
            if (item) {
                currentRootEntries.push(item);
            }
        }
        renderFileList();
    }

    async function renderFileList() {
        fileList.innerHTML = '';
        if (currentRootEntries.length > 0) {
            fileListContainer.classList.remove('hidden');
            for (const entry of currentRootEntries) {
                // Determine visibility based on settings
                if (shouldInclude(entry)) {
                    const element = await createTreeElement(entry);
                    if (element) {
                        fileList.appendChild(element);
                    }
                }
            }
        } else {
            fileListContainer.classList.add('hidden');
        }
    }

    function shouldInclude(entry) {
        if (appSettings.excludeDotFiles && entry.name.startsWith('.')) {
            return false;
        }
        return true;
    }

    async function createTreeElement(entry) {
        // Double check inclusion just in case
        if (!shouldInclude(entry)) return null;

        const li = document.createElement('li');
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('item');
        itemDiv.entry = entry; // Store entry on DOM element

        const icon = document.createElement('span');
        if (entry.isDirectory) {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="folder-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
            itemDiv.classList.add('folder-toggle');

            // Arrow for folder
            const arrow = document.createElement('span');
            arrow.classList.add('arrow');
            arrow.textContent = '▶';
            itemDiv.prepend(arrow);

            itemDiv.addEventListener('click', async (e) => {
                e.stopPropagation();
                itemDiv.classList.toggle('open');
                const nestedUl = li.querySelector('.nested');
                if (nestedUl) {
                    nestedUl.classList.toggle('expanded');
                }
            });

        } else {
            icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="file-icon"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
            itemDiv.classList.add('file-item');
            itemDiv.downloadName = entry.name; // Default download name

            // Download on click
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadFile(entry, itemDiv.downloadName);
            });
        }

        itemDiv.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.classList.add('file-name');
        nameSpan.textContent = entry.name;
        itemDiv.appendChild(nameSpan);

        li.appendChild(itemDiv);

        if (entry.isDirectory) {
            const ul = document.createElement('ul');
            ul.classList.add('nested');

            // Read entries
            const reader = entry.createReader();
            const readEntries = async () => {
                return new Promise((resolve) => {
                    reader.readEntries(async (entries) => {
                        if (entries.length > 0) {
                            // Sort
                            entries.sort((a, b) => {
                                if (a.isDirectory === b.isDirectory) {
                                    return a.name.localeCompare(b.name);
                                }
                                return a.isDirectory ? -1 : 1;
                            });

                            for (const childEntry of entries) {
                                if (shouldInclude(childEntry)) {
                                    const childElement = await createTreeElement(childEntry);
                                    if (childElement) {
                                        ul.appendChild(childElement);
                                    }
                                }
                            }
                            await readEntries();
                        }
                        resolve();
                    });
                });
            };

            await readEntries();
            li.appendChild(ul);
        }

        return li;
    }

    function applyExtensionAction() {
        const action = appSettings.actionMode; // Get from state, not DOM selector
        const targetExtension = '.' + action;

        const fileItems = fileList.querySelectorAll('.item.file-item');
        // List of common text-based extensions
        const textExtensions = [
            '.txt', '.md', '.py', '.js', '.css', '.html', '.json',
            '.xml', '.yml', '.yaml', '.sh', '.bat', '.log', '.csv',
            '.ts', '.tsx', '.jsx', '.c', '.cpp', '.h', '.java', '.rb',
            '.php', '.sql', '.toml', '.ini', '.cfg', '.conf'
        ];

        fileItems.forEach(async (itemDiv) => {
            const entry = itemDiv.entry;
            if (entry && !entry.isDirectory) {
                entry.file((file) => {
                    const originalName = file.name;
                    const lowercaseName = originalName.toLowerCase();

                    let isText = false;
                    if (file.type && file.type.startsWith('text/')) {
                        isText = true;
                    }
                    else if (textExtensions.some(ext => lowercaseName.endsWith(ext))) {
                        isText = true;
                    }
                    else if (!originalName.includes('.')) {
                        isText = true;
                    }

                    if (isText && !lowercaseName.endsWith(targetExtension)) {
                        const newName = originalName + targetExtension;

                        const nameSpan = itemDiv.querySelector('.file-name');
                        if (nameSpan) {
                            nameSpan.textContent = newName;
                        }
                        itemDiv.classList.add('renamed');
                        itemDiv.downloadName = newName;
                    }
                });
            }
        });
    }

    async function downloadZip() {
        const zip = new JSZip();
        const rootItems = Array.from(fileList.children);

        for (const li of rootItems) {
            await addToZip(li, zip);
        }

        let zipFilename = "files.zip";
        if (currentRootEntries.length === 1) {
            zipFilename = `${currentRootEntries[0].name}.zip`;
        }

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function addToZip(li, zipFolder) {
        const itemDiv = li.querySelector('.item');
        if (!itemDiv) return;

        const entry = itemDiv.entry;
        const name = itemDiv.downloadName || entry.name;

        if (entry.isDirectory) {
            const newFolder = zipFolder.folder(name);
            const nestedUl = li.querySelector('.nested');
            if (nestedUl) {
                const children = Array.from(nestedUl.children);
                for (const childLi of children) {
                    await addToZip(childLi, newFolder);
                }
            }
        } else {
            await new Promise((resolve) => {
                entry.file((file) => {
                    zipFolder.file(name, file);
                    resolve();
                });
            });
        }
    }

    function downloadFile(fileEntry, fileName) {
        fileEntry.file((file) => {
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
});
