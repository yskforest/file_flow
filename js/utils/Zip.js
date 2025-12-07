// Zip Utility
(function () {

    // Dependencies: JSZip (global), FileFlow.state

    async function downloadZip() {
        const zip = new JSZip();
        const fileList = document.getElementById('file-list');
        const currentRootEntries = FileFlow.state.currentRootEntries;

        if (!fileList) return;

        if (FileFlow.state.appSettings.viewMode === 'list') {
            const items = Array.from(fileList.children).filter(li => !li.classList.contains('filtered-out'));
            for (const li of items) {
                const itemDiv = li.querySelector('.item');
                const entry = itemDiv.entry;

                const nameSpan = itemDiv.querySelector('.file-name');
                const docPath = nameSpan.textContent;

                await new Promise(resolve => {
                    entry.file(file => {
                        zip.file(docPath, file);
                        resolve();
                    });
                });
            }
        } else {
            const rootItems = Array.from(fileList.children).filter(li => !li.classList.contains('filtered-out'));
            for (const li of rootItems) {
                await addToZip(li, zip);
            }
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
        if (li.classList.contains('filtered-out')) return;

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

    FileFlow.utils.Zip = {
        downloadZip: downloadZip
    };

})();
