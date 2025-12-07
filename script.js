document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileListContainer = document.getElementById('file-list-container');
    const fileList = document.getElementById('file-list');
    const clearBtn = document.getElementById('clear-btn');

    // Drag and Drop Events
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

    clearBtn.addEventListener('click', () => {
        fileList.innerHTML = '';
        fileListContainer.classList.add('hidden');
    });

    async function handleItems(items) {
        fileList.innerHTML = ''; // Clear previous
        fileListContainer.classList.remove('hidden');

        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry();
            if (item) {
                const element = await createTreeElement(item);
                fileList.appendChild(element);
            }
        }
    }

    async function createTreeElement(entry) {
        const li = document.createElement('li');
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('item');

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
        }
        
        itemDiv.appendChild(icon);

        const nameSpan = document.createElement('span');
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
                            // Sort: folders first, then files
                            entries.sort((a, b) => {
                                if (a.isDirectory === b.isDirectory) {
                                    return a.name.localeCompare(b.name);
                                }
                                return a.isDirectory ? -1 : 1;
                            });

                            for (const childEntry of entries) {
                                const childElement = await createTreeElement(childEntry);
                                ul.appendChild(childElement);
                            }
                            // Recursively read more if browser limits batch size
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
});
