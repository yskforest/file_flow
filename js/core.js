// FileFlow — Core Domain (Glob / FS / Detect / Entries / Zip)
// utils.js の後に読み込むこと。DOMに依存しない（Zip.downloadZip を除く）。
(function () {
    'use strict';

    var FF = window.FileFlow;
    var State = FF.state;

    // =====================
    // Glob (README通りパス対応)
    // =====================

    // `*` -> 同一階層のみ, `**` -> 階層横断, `?` -> 1文字(スラッシュ除く)
    function globSegmentToRegexSource(glob) {
        var out = '';
        for (var i = 0; i < glob.length; i++) {
            var c = glob[i];
            if (c === '*') {
                if (glob[i + 1] === '*') {
                    if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
                    else { out += '.*'; i += 1; }
                } else {
                    out += '[^/]*';
                }
            } else if (c === '?') {
                out += '[^/]';
            } else if ('.+^${}()|[]\\'.indexOf(c) >= 0) {
                out += '\\' + c;
            } else {
                out += c;
            }
        }
        return out;
    }

    function compileGlob(glob, isPathPattern) {
        var src = isPathPattern
            ? globSegmentToRegexSource(glob)
            : glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp('^' + src + '$', 'i');
    }

    function normalizeRelPath(p) {
        if (!p) return '';
        return String(p).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
    }

    function basenameOf(p) {
        var n = normalizeRelPath(p);
        var idx = n.lastIndexOf('/');
        return idx >= 0 ? n.slice(idx + 1) : n;
    }

    var Glob = {
        createMatcher: function (query) {
            if (!query || !query.trim()) return null;
            var parts = query.split(/[\s,]+/).filter(Boolean);
            var incl = [];
            var excl = [];
            parts.forEach(function (p) {
                var isExcl = p.charAt(0) === '!';
                var body = isExcl ? p.slice(1) : p;
                if (!body) return;
                var isPath = body.indexOf('/') >= 0;
                var re = compileGlob(body, isPath);
                (isExcl ? excl : incl).push({ re: re, isPath: isPath });
            });
            if (!incl.length && !excl.length) return null;
            var matcher = function (name, relPath) {
                var base = basenameOf(name);
                var rel = normalizeRelPath(relPath === undefined || relPath === null ? name : relPath);
                var testOne = function (entry) {
                    if (entry.isPath) return entry.re.test(rel);
                    return entry.re.test(base);
                };
                for (var i = 0; i < excl.length; i++) {
                    if (testOne(excl[i])) return false;
                }
                if (!incl.length) return true;
                for (var j = 0; j < incl.length; j++) {
                    if (testOne(incl[j])) return true;
                }
                return false;
            };
            matcher._parts = parts;
            return matcher;
        }
    };

    // =====================
    // FileSystem（反復スタック走査・中断可）
    // =====================

    function isCancelled(signal) {
        return !!(signal && (signal.aborted || signal.cancelled));
    }

    var FS = {
        readDir: function (entry, opts) {
            opts = opts || {};
            var reportError = function (error) { if (opts.onError) opts.onError(entry, error); };
            if (!entry || !entry.isDirectory) return Promise.resolve([]);
            var reader;
            try {
                reader = entry.createReader();
            } catch (e) {
                console.warn('readDir: createReader failed', e);
                reportError(e);
                return Promise.resolve([]);
            }
            return new Promise(function (resolve) {
                var all = [];
                var pump = function () {
                    try {
                        reader.readEntries(function (batch) {
                            if (!batch || !batch.length) { resolve(all); return; }
                            all = all.concat(batch);
                            pump();
                        }, function (err) {
                            console.warn('readDir failed, returning partial results', err);
                            reportError(err);
                            resolve(all);
                        });
                    } catch (e) {
                        console.warn('readDir exception', e);
                        reportError(e);
                        resolve(all);
                    }
                };
                pump();
            });
        },

        traverse: function (roots, visitFn, opts) {
            opts = opts || {};
            var stack = [].concat(roots || []).reverse();
            var visit = function () {
                if (!stack.length || isCancelled(opts.signal)) return Promise.resolve();
                var entry = stack.pop();
                if (!entry) return visit();
                if (opts.excludeDots && entry.name && entry.name.charAt(0) === '.') return visit();
                return Promise.resolve()
                    .then(function () { return visitFn(entry); })
                    .then(function (ret) {
                        if (ret === false || isCancelled(opts.signal)) return visit();
                        if (entry.isDirectory) {
                            return FS.readDir(entry, opts).then(function (children) {
                                for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
                                return visit();
                            });
                        }
                        return visit();
                    })
                    .catch(function (e) {
                        console.warn('traverse visit failed:', entry && entry.fullPath, e);
                        return visit();
                    });
            };
            return visit();
        }
    };

    // =====================
    // Entries (Single Source of Truth)
    // =====================

    function buildRelPath(entry, rootNames) {
        var full = entry.fullPath || entry.name || '';
        var norm = normalizeRelPath(full);
        if (rootNames && rootNames.length === 1 && rootNames[0]) {
            var prefix = normalizeRelPath(rootNames[0]);
            if (norm === prefix) return '';
            if (prefix && norm.indexOf(prefix + '/') === 0) return norm.slice(prefix.length + 1);
        }
        return norm;
    }

    var Entries = {
        normalizeRelPath: normalizeRelPath,
        basenameOf: basenameOf,
        buildRelPath: buildRelPath,
        collectFiles: function (roots, options) {
            options = options || {};
            var list = (roots || []).slice();
            var rootNames = list.map(function (r) { return r.name || ''; });
            var out = [];
            return FS.traverse(list, function (entry) {
                if (options.excludeDots && entry.name && entry.name.charAt(0) === '.') return false;
                if (!entry.isDirectory) {
                    var rel = buildRelPath(entry, rootNames);
                    if (!options.matcher || options.matcher(entry.name, rel || entry.name)) {
                        out.push({ entry: entry, relPath: rel || entry.name });
                    }
                }
                return true;
            }, options).then(function () { return out; });
        }
    };

    // =====================
    // Encoding / EOL Detection（最新版の判定仕様を維持）
    // =====================

    function detectFileInfo(file) {
        return Promise.resolve(file.slice(0, 4096).arrayBuffer()).then(function (buf) {
            var v = new Uint8Array(buf || []);
            if (!v.length) return { encoding: 'Empty', eol: 'None', isBinary: false };

            var enc = null, isU16 = false;
            if (v.length >= 3 && v[0] === 0xEF && v[1] === 0xBB && v[2] === 0xBF) {
                enc = 'UTF-8 (BOM)';
            } else if (v.length >= 2 && v[0] === 0xFE && v[1] === 0xFF) {
                enc = 'UTF-16 BE'; isU16 = true;
            } else if (v.length >= 2 && v[0] === 0xFF && v[1] === 0xFE) {
                enc = 'UTF-16 LE'; isU16 = true;
            }

            if (!isU16) {
                for (var i = 0; i < Math.min(v.length, 512); i++) {
                    if (v[i] === 0) return { encoding: 'Binary', eol: '-', isBinary: true };
                }
            }

            var cr = 0, lf = 0, crlf = 0, j;
            if (isU16) {
                var isLE = enc === 'UTF-16 LE';
                for (j = 0; j < v.length - 1; j += 2) {
                    var c = isLE ? (v[j] | (v[j + 1] << 8)) : ((v[j] << 8) | v[j + 1]);
                    if (c === 0x0D) {
                        var next = -1;
                        if (j + 3 < v.length) {
                            next = isLE ? (v[j + 2] | (v[j + 3] << 8)) : ((v[j + 2] << 8) | v[j + 3]);
                        }
                        if (next === 0x0A) { crlf++; j += 2; } else { cr++; }
                    } else if (c === 0x0A) { lf++; }
                }
            } else {
                for (j = 0; j < v.length; j++) {
                    if (v[j] === 0x0D) {
                        if (j + 1 < v.length && v[j + 1] === 0x0A) { crlf++; j++; } else { cr++; }
                    } else if (v[j] === 0x0A) { lf++; }
                }
            }
            var eol = crlf > lf && crlf > cr ? 'CRLF' : lf > crlf && lf > cr ? 'LF' :
                cr > crlf && cr > lf ? 'CR' : !crlf && !lf && !cr ? 'None' : 'Mixed';

            if (!enc) {
                var allAscii = true;
                for (var k = 0; k < v.length; k++) { if (v[k] > 0x7F) { allAscii = false; break; } }
                if (allAscii) { enc = 'ASCII'; }
                else {
                    var utf8 = true;
                    try { new TextDecoder('utf-8', { fatal: true }).decode(v); }
                    catch (e) { utf8 = false; }
                    enc = utf8 ? 'UTF-8' : detectJapanese(v);
                }
            }
            return { encoding: enc, eol: eol, isBinary: false };
        });
    }

    function detectJapanese(v) {
        var sjis = false, valid = true;
        for (var j = 0; j < v.length; j++) {
            var b = v[j];
            if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
                sjis = true;
                if (j + 1 >= v.length) break;
                var b2 = v[j + 1];
                if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) { j++; }
                else { valid = false; break; }
            } else if (b >= 0xFD) { valid = false; break; }
        }
        if (sjis && valid) return 'Shift_JIS';
        for (var k = 0; k < v.length; k++) {
            if (v[k] >= 0xA1 && v[k] <= 0xFE) return 'EUC-JP?';
        }
        return 'Other';
    }

    // =====================
    // ZIP（モデル駆動・DOM非依存: 未展開ツリーも含めフィルタ一致分を出力）
    // =====================

    function readEntryFile(entry) {
        return new Promise(function (res, rej) {
            try { entry.file(res, rej); }
            catch (e) { rej(e); }
        });
    }

    // --- Shared export helpers (CSV / Blob / paths) ---

    function csvEscape(s) {
        var str = (s === null || s === undefined) ? '' : String(s);
        return (/[,"\r\n]/.test(str)) ? '"' + str.replace(/"/g, '""') + '"' : str;
    }

    function bomTextBlob(text, mime) {
        return new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), text], { type: mime || 'text/plain;charset=utf-8;' });
    }

    function dirnameOf(relPath) {
        var p = normalizeRelPath(relPath);
        return p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/')) : '.';
    }

    // 照合用正規化（大文字小文字・区切り・ドットセグメントを吸収）
    function normalizeLookupPath(p) {
        var parts = String(p || '').replace(/\\/g, '/').split('/');
        var stack = [];
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i];
            if (seg === '..') { stack.pop(); }
            else if (seg !== '.' && seg !== '') { stack.push(seg); }
        }
        return stack.join('/').toLowerCase();
    }

    function outputPath(item) {
        var meta = State.getMeta(item.entry.fullPath || item.relPath) || {};
        var rel = normalizeRelPath(item.relPath || item.entry.name);
        var dir = rel.indexOf('/') >= 0 ? rel.slice(0, rel.lastIndexOf('/')) : '';
        var name = meta.newFilename || item.entry.name;
        return dir ? dir + '/' + name : name;
    }

    async function mapLimit(items, limit, fn) {
        var next = 0;
        var results = new Array(items.length);
        async function worker() {
            while (next < items.length) {
                var index = next++;
                results[index] = await fn(items[index], index);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return results;
    }

    async function createZip(items, scanErrors) {
        var paths = new Set();
        items.forEach(function (item) {
            var path = outputPath(item);
            if (paths.has(path)) throw new Error('Duplicate ZIP path: ' + path);
            paths.add(path);
        });
        paths.forEach(function (path) {
            var segments = path.split('/');
            for (var i = 1; i < segments.length; i++) {
                var parent = segments.slice(0, i).join('/');
                if (paths.has(parent)) throw new Error('ZIP file/directory conflict: ' + parent);
            }
        });
        var zip = new JSZip();
        var report = await mapLimit(items, 8, async function (item) {
            var path = outputPath(item);
            try {
                zip.file(path, await readEntryFile(item.entry));
                return { path: path, status: 'exported', reason: '' };
            } catch (e) {
                return { path: path, status: 'failed', reason: String(e.message || e) };
            }
        });
        report.push.apply(report, scanErrors || []);
        // Keep reports outside the input namespace, including when a source has this name.
        var reportPath = '_fileflow_export_report.csv';
        while (paths.has(reportPath) || Array.from(paths).some(function (path) { return path.indexOf(reportPath + '/') === 0; })) reportPath = '_' + reportPath;
        zip.file(reportPath, bomTextBlob('Path,Status,Reason\n' + report.map(function (r) {
            return [r.path, r.status, r.reason].map(csvEscape).join(',');
        }).join('\n') + '\n', 'text/csv;charset=utf-8;'));
        return { blob: await zip.generateAsync({ type: 'blob' }), report: report };
    }

    async function downloadZip() {
        var roots = State.currentRootEntries.slice();
        if (!roots.length) return;
        var scanErrors = [];
        var items = await Entries.collectFiles(roots, {
            matcher: Glob.createMatcher(State.searchQuery), excludeDots: State.appSettings.excludeDots,
            onError: function (entry, error) { scanErrors.push({ path: entry.fullPath, status: 'failed', reason: 'directory-read: ' + String(error.message || error) }); }
        });
        var result = await createZip(items, scanErrors);
        FF.utils.downloadBlob(result.blob, roots.length === 1 ? roots[0].name + '.zip' : 'files.zip');
        var failed = result.report.filter(function (r) { return r.status === 'failed'; }).length;
        if (FF.ui.Status) FF.ui.Status.show('ZIP exported: ' + (result.report.length - failed) + ' files, ' + failed + ' failed (see export report)');
        return result;
    }

    FF.utils = Object.assign(FF.utils || {}, {
        Glob: Glob,
        FS: FS,
        Entries: Entries,
        Detect: { detectFileInfo: detectFileInfo },
        Zip: { downloadZip: downloadZip, createZip: createZip },
        outputPath: outputPath,
        mapLimit: mapLimit,
        readEntryFile: readEntryFile,
        csvEscape: csvEscape,
        bomTextBlob: bomTextBlob,
        dirnameOf: dirnameOf,
        normalizeLookupPath: normalizeLookupPath
    });
})();
