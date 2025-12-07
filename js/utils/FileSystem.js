// FileSystem Utilities
(function () {

    // Read a file as Text
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsText(file);
        });
    }

    // Read a file slice as ArrayBuffer
    function readFileSliceAsArrayBuffer(file, start, end) {
        const slice = file.slice(start, end);
        return slice.arrayBuffer();
    }

    FileFlow.utils.FileSystem = {
        readFileAsText: readFileAsText,
        readFileSliceAsArrayBuffer: readFileSliceAsArrayBuffer
    };
})();
