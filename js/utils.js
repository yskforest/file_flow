// FileFlow — Core Namespace & Utilities
(function () {
    const listeners = {};
    const subscribe = (event, callback) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
        return () => {
            listeners[event] = listeners[event].filter(cb => cb !== callback);
        };
    };
    const notify = (event, val) => {
        if (listeners[event]) listeners[event].forEach(cb => cb(val));
    };

    function createProxy(obj, onChange) {
        return new Proxy(obj, {
            set(target, key, value) {
                if (target[key] !== value) {
                    target[key] = value;
                    onChange(key, value);
                }
                return true;
            }
        });
    }

    let _currentRootEntries = [];
    let _appSettings = { viewMode: 'tree', actionMode: 'md', excludeDots: true, showFullPath: true };
    let _entryMetadata = {};
    let _searchQuery = '';

    let appSettingsProxy = createProxy(_appSettings, (key, value) => {
        notify('appSettings', _appSettings);
        notify(`setting:${key}`, value);
    });

    const state = {
        get currentRootEntries() { return _currentRootEntries; },
        set currentRootEntries(val) {
            _currentRootEntries = val;
            notify('currentRootEntries', val);
        },
        get appSettings() { return appSettingsProxy; },
        set appSettings(val) {
            _appSettings = val;
            appSettingsProxy = createProxy(_appSettings, (key, value) => {
                notify('appSettings', _appSettings);
                notify(`setting:${key}`, value);
            });
            notify('appSettings', _appSettings);
        },
        get entryMetadata() { return _entryMetadata; },
        set entryMetadata(val) {
            _entryMetadata = val;
            notify('entryMetadata', val);
        },
        get searchQuery() { return _searchQuery; },
        set searchQuery(val) {
            _searchQuery = val;
            notify('searchQuery', val);
        },
        subscribe
    };

    window.FileFlow = {
        state,
        actions: {},
        ui: {},
        utils: {}
    };
})();

(function () {
    const FF = FileFlow;

    // --- Helpers ---

    const $ = id => document.getElementById(id);

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024, sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
    }

    function formatDate(d) { return d ? new Date(d).toLocaleString() : '-'; }

    // --- SVG Icons ---

    const svg = (inner, s = 18) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

    const Icons = {
        list:   svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
        chart:  svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
        gear:   svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
        close:  svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
        upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', 48),
        trash:  svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
        filter: svg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', 14),
    };

    // --- Glob Matching ---

    function globToRegex(glob) {
        return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    }

    const Glob = {
        createMatcher(query) {
            if (!query || !query.trim()) return null;
            const parts = query.split(/[\s,]+/).filter(Boolean);
            const incl = parts.filter(p => !p.startsWith('!')).map(globToRegex);
            const excl = parts.filter(p => p.startsWith('!')).map(p => globToRegex(p.slice(1)));
            return name => !excl.some(r => r.test(name)) && (!incl.length || incl.some(r => r.test(name)));
        }
    };

    // --- FileSystem ---

    const FS = {
        async readDir(entry) {
            if (!entry.isDirectory) return [];
            const reader = entry.createReader();
            let all = [];
            while (true) {
                const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
                if (!batch.length) return all;
                all = all.concat(batch);
            }
        },
        async traverse(roots, visitFn, opts = {}) {
            for (const entry of [].concat(roots)) {
                if (opts.excludeDots && entry.name.startsWith('.')) continue;
                if (await visitFn(entry) !== false && entry.isDirectory)
                    await FS.traverse(await FS.readDir(entry), visitFn, opts);
            }
        }
    };

    // --- Encoding / EOL Detection ---

    async function detectFileInfo(file) {
        const v = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
        if (!v.length) return { encoding: 'Empty', eol: 'None', isBinary: false };

        // 1. BOM チェック
        let enc = null;
        let isU16 = false;
        if (v.length >= 3 && v[0] === 0xEF && v[1] === 0xBB && v[2] === 0xBF) {
            enc = 'UTF-8 (BOM)';
        } else if (v.length >= 2 && v[0] === 0xFE && v[1] === 0xFF) {
            enc = 'UTF-16 BE';
            isU16 = true;
        } else if (v.length >= 2 && v[0] === 0xFF && v[1] === 0xFE) {
            enc = 'UTF-16 LE';
            isU16 = true;
        }

        // 2. バイナリ判定 (UTF-16以外)
        if (!isU16) {
            for (let i = 0; i < Math.min(v.length, 512); i++) {
                if (v[i] === 0) return { encoding: 'Binary', eol: '-', isBinary: true };
            }
        }

        // 3. EOL
        let cr = 0, lf = 0, crlf = 0;
        if (isU16) {
            const isLE = enc === 'UTF-16 LE';
            for (let j = 0; j < v.length - 1; j += 2) {
                const charCode = isLE ? (v[j] | (v[j + 1] << 8)) : ((v[j] << 8) | v[j + 1]);
                if (charCode === 0x0D) {
                    let nextCharCode = -1;
                    if (j + 3 < v.length) {
                        nextCharCode = isLE ? (v[j + 2] | (v[j + 3] << 8)) : ((v[j + 2] << 8) | v[j + 3]);
                    }
                    if (nextCharCode === 0x0A) {
                        crlf++;
                        j += 2;
                    } else {
                        cr++;
                    }
                } else if (charCode === 0x0A) {
                    lf++;
                }
            }
        } else {
            for (let j = 0; j < v.length; j++) {
                if (v[j] === 0x0D) { j + 1 < v.length && v[j + 1] === 0x0A ? (crlf++, j++) : cr++; }
                else if (v[j] === 0x0A) lf++;
            }
        }
        const eol = crlf > lf && crlf > cr ? 'CRLF' : lf > crlf && lf > cr ? 'LF' :
            cr > crlf && cr > lf ? 'CR' : !crlf && !lf && !cr ? 'None' : 'Mixed';

        // 4. Encoding (BOMがない場合)
        if (!enc) {
            if (v.every(b => b <= 0x7F)) enc = 'ASCII';
            else {
                let utf8 = true;
                try { new TextDecoder('utf-8', { fatal: true }).decode(v); } catch { utf8 = false; }
                enc = utf8 ? 'UTF-8' : detectJapanese(v);
            }
        }
        return { encoding: enc, eol, isBinary: false };
    }

    function detectJapanese(v) {
        let sjis = false, valid = true;
        for (let j = 0; j < v.length; j++) {
            const b = v[j];
            if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
                sjis = true;
                if (j + 1 >= v.length) break;
                const b2 = v[j + 1];
                if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) j++;
                else { valid = false; break; }
            } else if (b >= 0xFD) { valid = false; break; }
        }
        if (sjis && valid) return 'Shift_JIS';
        return v.some(b => b >= 0xA1 && b <= 0xFE) ? 'EUC-JP?' : 'Other';
    }

    // --- ZIP ---

    async function downloadZip() {
        const zip = new JSZip(), list = $('file-list'), roots = FF.state.currentRootEntries;
        if (!list) return;

        const visible = li => !li.classList.contains('filtered-out');

        if (FF.state.appSettings.viewMode === 'list') {
            for (const li of [...list.children].filter(visible)) {
                const item = li.querySelector('.item');
                await new Promise(r => item.entry.file(f => {
                    zip.file(item.querySelector('.file-name').textContent, f); r();
                }));
            }
        } else {
            for (const li of [...list.children].filter(visible)) await addToZip(li, zip);
        }

        const name = roots.length === 1 ? `${roots[0].name}.zip` : 'files.zip';
        downloadBlob(await zip.generateAsync({ type: 'blob' }), name);
    }

    async function addToZip(li, folder) {
        if (li.classList.contains('filtered-out')) return;
        const item = li.querySelector('.item');
        if (!item) return;
        const entry = item.entry, name = item.downloadName || entry.name;
        if (entry.isDirectory) {
            const sub = folder.folder(name), nested = li.querySelector('.nested');
            if (nested) for (const c of [...nested.children]) await addToZip(c, sub);
        } else {
            await new Promise(r => entry.file(f => { folder.file(name, f); r(); }));
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Export ---

    FF.utils = { $, formatBytes, formatDate, Icons, Glob, FS, Detect: { detectFileInfo }, Zip: { downloadZip }, downloadBlob };
})();
