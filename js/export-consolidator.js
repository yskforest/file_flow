// FileFlow — source packing and final limit validation
(function () {
    'use strict';
    const { $, formatBytes, FS, downloadBlob, csvEscape, bomTextBlob, dirnameOf, readEntryFile, normalizeLookupPath, Glob } = FileFlow.utils;
    const State = FileFlow.state;
    const Status = FileFlow.ui.Status;
    const { yamlFrontmatter, generatedMetadata, markdownText, markdownLink, DEFAULT_CONFIG, BLOCK_OVERHEAD_EST, SUBTREE_MAX_LINES, PARTS_MAP_MAX, CHUNK_RESERVED_BYTES, MAX_OUTPUT_WORDS, OUTPUT_WORD_TARGET, OUTPUT_WORD_RESERVE, SINGLE_BLOCK_WORD_BUDGET, INDEX_SHARD_HEAD_EST_WORDS, _splitContent, countWords, _splitContentByWords, _splitContentDualWords, createExcludeMatcher, assignParts, _buildSubtree, _buildIndexShardHead, VcxprojParser, _getExtension, _fuzzyMatchProject, _detectEntryPoints, _detectLanguage } = FileFlow.exportCommon;
    const SourceConsolidator = {

        // Only one source file and one rendered part are held as strings at a time.
        // Raw fragments live in immutable Blobs until final part numbering is known.
        async consolidate({ fileItems, projects, mode = 'folder_structure', ext = '.md', maxPartSize, maxFilesPerPart, maxSingleFileSize, onProgress, generatedAt = new Date().toISOString() }) {
            const encoder = new TextEncoder();
            const byteLimit = maxPartSize > 0 ? maxPartSize : Infinity;
            const fileLimit = maxFilesPerPart > 0 ? maxFilesPerPart : Infinity;
            const bodyBytes = byteLimit === Infinity ? Infinity : Math.max(1024, byteLimit - CHUNK_RESERVED_BYTES);
            const bodyWords = OUTPUT_WORD_TARGET - OUTPUT_WORD_RESERVE;
            const rootName = State.currentRootEntries.length === 1 ? State.currentRootEntries[0].name : 'project';
            const entryPoints = _detectEntryPoints(fileItems);
            if (ext !== '.md' && ext !== 'md') throw new Error('OKF v0.2 concept documents must use .md');
            const cleanExt = '.md';
            const report = [];
            const parts = [];
            let current = [], currentBytes = 0, currentWords = 0;
            const countFiles = records => new Set(records.map(r => r.meta.globalIndex)).size;
            const flush = () => {
                if (current.length) parts.push(current);
                current = []; currentBytes = 0; currentWords = 0;
            };
            for (let index = 0; index < fileItems.length; index++) {
                const item = fileItems[index];
                const outcome = { path: item.relativePath, status: 'pending', reason: '' };
                report.push(outcome);
                if (onProgress) onProgress(index, fileItems.length);
                if (index % 32 === 0) await new Promise(r => setTimeout(r, 0));
                let content, sourceModifiedAt;
                try {
                    if (maxSingleFileSize > 0 && item.size > maxSingleFileSize) {
                        Object.assign(outcome, { status: 'excluded', reason: 'single-file-size-limit' }); continue;
                    }
                    const file = await readEntryFile(item.entry);
                    if (maxSingleFileSize > 0 && file.size > maxSingleFileSize) {
                        Object.assign(outcome, { status: 'excluded', reason: 'single-file-size-limit' }); continue;
                    }
                    if (Number.isFinite(file.lastModified) && !isNaN(new Date(file.lastModified).getTime())) sourceModifiedAt = new Date(file.lastModified).toISOString();
                    content = this._decodeToUtf8(new Uint8Array(await file.arrayBuffer()));
                } catch (e) {
                    Object.assign(outcome, { status: 'failed', reason: String(e.message || e) }); continue;
                }
                outcome.status = 'exported';
                const contentBytes = encoder.encode(content).length;
                const pieces = _splitContentDualWords(content, bodyBytes, SINGLE_BLOCK_WORD_BUDGET, encoder);
                for (const piece of pieces) {
                    const block = this._buildOKFFileBlock(item, piece);
                    const bytes = encoder.encode(block).length, words = countWords(block);
                    const meta = { path: item.relativePath, project: item.projectName || '', filter: item.filter || '', size: contentBytes, globalIndex: index + 1, chunk: null, sourceModifiedAt };
                    const addsFile = !current.some(r => r.meta.globalIndex === meta.globalIndex);
                    if (current.length && (currentBytes + bytes > bodyBytes || currentWords + words > bodyWords || countFiles(current) + (addsFile ? 1 : 0) > fileLimit)) flush();
                    current.push({ meta, content: new Blob([piece]), bytes, words });
                    currentBytes += bytes; currentWords += words;
                }
            }
            flush();
            if (onProgress) onProgress(fileItems.length, fileItems.length);
            if (!parts.length) return { results: [], partFileList: [], report };

            // Balance a small tail by metadata, without materializing source strings.
            if (parts.length >= 2) {
                const prev = parts[parts.length - 2], last = parts[parts.length - 1];
                const combined = prev.concat(last);
                const totalWords = combined.reduce((n,r) => n + r.words, 0);
                const totalBytes = combined.reduce((n,r) => n + r.bytes, 0);
                if (countFiles(combined) <= fileLimit && totalWords <= bodyWords && totalBytes <= bodyBytes) {
                    parts.splice(parts.length - 2, 2, combined);
                } else if (last.reduce((n,r) => n + r.words, 0) < bodyWords * 0.5 && combined.length > 2) {
                    let sum = 0, mid = 1;
                    for (let i = 0; i < combined.length - 1; i++) {
                        sum += combined[i].words;
                        mid = i + 1;
                        if (sum >= totalWords / 2) break;
                    }
                    const left = combined.slice(0,mid), right = combined.slice(mid);
                    if (countFiles(left) <= fileLimit && countFiles(right) <= fileLimit) parts.splice(parts.length - 2, 2, left, right);
                }
            }
            const over = text => countWords(text) >= MAX_OUTPUT_WORDS || encoder.encode(text).length + 3 > byteLimit;
            const relabel = () => {
                const totals = new Map(), seen = new Map();
                parts.forEach(part => part.forEach(r => totals.set(r.meta.path, (totals.get(r.meta.path) || 0) + 1)));
                parts.forEach(part => part.forEach(r => {
                    const path = r.meta.path, n = (seen.get(path) || 0) + 1; seen.set(path,n);
                    r.meta.chunk = totals.get(path) > 1 ? `split ${n}/${totals.get(path)}` : null;
                }));
            };
            const renderPart = async (part, index) => {
                const files = part.map(r => r.meta);
                const blocks = [];
                for (const r of part) {
                    blocks.push(this._buildOKFFileBlock({ relativePath: r.meta.path, projectName: r.meta.project, filter: r.meta.filter, size: r.meta.size }, await r.content.text(), { chunkLabel: r.meta.chunk }));
                }
                const body = blocks.join('');
                const groups = parts.length <= PARTS_MAP_MAX ? parts.map(p => [...new Set(p.map(r => r.meta.path))]) : [];
                return this._buildOKFFrontmatter({ rootName, partNum: index + 1, totalParts: parts.length, fileCount: countFiles(part), totalSizeBytes: encoder.encode(body).length, mode, entryPoints, sourceFiles: files, generatedAt }) +
                    this._buildOKFHeader({ rootName, partNum: index + 1, totalParts: parts.length, mode, projects, totalFiles: report.filter(r => r.status === 'exported').length, currentPartFiles: files, partGroups: groups }) + body;
            };
            // Restart when numbering changes. Splitting always decreases fragment size.
            let stable = false;
            for (let attempt = 0; attempt < 10000; attempt++) {
                relabel();
                let victim = -1;
                for (let i = 0; i < parts.length; i++) {
                    if (over(await renderPart(parts[i],i)) || countFiles(parts[i]) > fileLimit) { victim = i; break; }
                }
                if (victim < 0) { stable = true; break; }
                const part = parts[victim];
                if (part.length > 1) {
                    const mid = Math.ceil(part.length / 2);
                    parts.splice(victim,1,part.slice(0,mid),part.slice(mid));
                } else {
                    const record = part[0];
                    const points = Array.from(await record.content.text());
                    if (points.length <= 1) throw new Error('Part size limit is too small for export headers: ' + record.meta.path);
                    const mid = Math.ceil(points.length / 2);
                    const fragments = [points.slice(0,mid).join(''),points.slice(mid).join('')];
                    parts.splice(victim,1,...fragments.map(piece => [{ ...record, meta: { ...record.meta }, content: new Blob([piece]) }]));
                }
            }
            if (!stable) throw new Error('Unable to satisfy output limits');
            const results = [], partFileList = [];
            for (let i = 0; i < parts.length; i++) {
                const text = await renderPart(parts[i],i);
                if (over(text)) throw new Error('Unable to satisfy output limits');
                partFileList.push(parts[i].map(r => r.meta));
                results.push({ filename: `${rootName}_src_${String(i + 1).padStart(3,'0')}_of_${String(parts.length).padStart(3,'0')}${cleanExt}`, blob: bomTextBlob(text,'text/markdown;charset=utf-8') });
                parts[i].forEach(r => { r.content = null; });
            }
            return { results, partFileList, report };
        },

        // --- OKF Format Building Helpers ---

        _buildOKFFrontmatter({ rootName, partNum, totalParts, fileCount, totalSizeBytes, mode, entryPoints, sourceFiles = [], generatedAt }) {
            const unique = [...new Map(sourceFiles.map(file => [file.path, file])).values()];
            return yamlFrontmatter({
                type: 'codebase_export',
                title: `${rootName} Source Code Export (Part ${partNum}/${totalParts})`,
                description: 'Source code excerpts with original paths, provenance and part-local file catalogue.',
                tags: ['codebase', 'source-code'],
                generated: generatedMetadata(generatedAt),
                sources: unique.map(file => ({
                    // A scope descriptor, not a broken bundle path: originals are
                    // embedded in this concept, not shipped as separate assets.
                    resource: 'Local input file: ' + file.path,
                    title: file.path,
                    ...(file.sourceModifiedAt ? { last_modified: file.sourceModifiedAt } : {})
                })),
                export_mode: mode, part_number: partNum, total_parts: totalParts,
                file_count: fileCount, total_size_bytes: totalSizeBytes,
                entry_points: entryPoints && entryPoints.length ? entryPoints : undefined
            });
        },

        _buildOKFHeader({ rootName, partNum, totalParts, mode, projects, totalFiles, currentPartFiles, partGroups }) {
            const lines = [];
            lines.push(`# Project Overview & Structure`);
            lines.push(`- **Root Workspace**: \`${rootName}\``);
            lines.push(`- **Export Mode**: \`${mode === 'vcxproj' ? 'Visual Studio (vcxproj)' : 'Folder Structure'}\``);
            lines.push(`- **Total Project Files**: ${totalFiles} | **Files in Part ${partNum}/${totalParts}**: ${new Set(currentPartFiles.map(f => f.path)).size}`);
            lines.push('- **Navigation**: ' + markdownLink('Bundle contents', 'index.md') + ' · ' + markdownLink('Codebase overview and file catalogue', 'codebase.md') + '\n');

            if (mode === 'vcxproj' && projects && projects.length > 0) {
                lines.push(`## Build Units (Visual Studio Projects)`);
                for (const p of projects) {
                    lines.push(`### Project: ${p.name}`);
                    lines.push(`- **Path**: \`${p.path}\``);
                    if (p.configurations.length) lines.push(`- **Configs**: \`${p.configurations.join(', ')}\``);
                    if (p.defines.length) lines.push(`- **Defines**: \`${p.defines.slice(0, 15).join('; ')}${p.defines.length > 15 ? '...' : ''}\``);
                    if (p.includeDirs.length) lines.push(`- **Include Dirs**: \`${p.includeDirs.slice(0, 10).join('; ')}${p.includeDirs.length > 10 ? '...' : ''}\``);
                    lines.push(`- **File Counts**: Sources (${p.sourceFiles.length}) | Headers (${p.headerFiles.length}) | Resources (${p.resourceFiles.length})`);
                    lines.push('');
                }
            }

            // Compact File Index: only current part files in detail
            lines.push(`## File Index — Part ${partNum} of ${totalParts}`);
            lines.push('');
            lines.push('| # | Path | Size |');
            lines.push('|---|---|---|');
            for (const f of currentPartFiles) {
                const projTag = f.project ? ` [${f.project}]` : '';
                const chunkTag = f.chunk ? ` (${f.chunk})` : '';
                lines.push(`| ${f.globalIndex} | \`${f.path}\`${chunkTag}${projTag} | ${formatBytes(f.size)} |`);
            }
            lines.push('');

            // Directory Subtree of this part（パート単体でも構造が失われない）
            const partPaths = currentPartFiles.map(f => f.path);
            lines.push(`## Directory Subtree — Part ${partNum} of ${totalParts}`);
            lines.push('');
            lines.push('```');
            lines.push(_buildSubtree(partPaths));
            lines.push('```');
            lines.push('');

            // Compact cross-part map（パート数が少ない場合のみ）
            if (partGroups && partGroups.length > 1 && partGroups.length <= PARTS_MAP_MAX) {
                lines.push(`## Parts Map — All ${totalParts} Parts`);
                lines.push('');
                partGroups.forEach((g, gi) => {
                    const dirs = {};
                    for (const rel of g) {
                        const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
                        dirs[d] = (dirs[d] || 0) + 1;
                    }
                    const top = Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 3)
                        .map(([d, c]) => `\`${d}/\` (${c})`).join(', ');
                    const mark = (gi + 1 === partNum) ? ' **← this part**' : '';
                    lines.push(`- Part ${gi + 1}/${totalParts}: ${g.length} files — ${top}${mark}`);
                });
                lines.push('');
            }

            lines.push('---', '', '# Source Code Section', '');

            return lines.join('\n');
        },

        _buildOKFFileBlock(item, content, opts) {
            const chunkLabel = (opts && opts.chunkLabel) || '';
            const lang = _detectLanguage(item.relativePath);
            const folderPath = dirnameOf(item.relativePath);
            const metaLines = [
                `path: ${JSON.stringify(item.relativePath)}`,
                `folder: ${JSON.stringify(folderPath)}`
            ];
            if (item.projectName) metaLines.push(`project: ${JSON.stringify(item.projectName)}`);
            if (item.filter) metaLines.push(`filter: ${JSON.stringify(item.filter)}`);
            metaLines.push(`extension: "${_getExtension(item.relativePath)}"`);
            metaLines.push(`size_bytes: ${item.size}`);
            if (chunkLabel) metaLines.push(`chunk: "${chunkLabel}"`);

            // RAG対策: 本文がフェンス記号を含む場合は長いフェンスに自動切替し、
            // ブロック構造の破損を防ぐ。末尾にパス付きフッターを付け、
            // チャンク切断面のどちら側でも帰属が復元できるようにする。
            const probe = metaLines.join('\n') + '\n' + content;
            let fence = '```';
            while (probe.includes(fence)) fence += '`';

            return [
                `## File: \`${item.relativePath}\`${chunkLabel ? ` (${chunkLabel})` : ''}`,
                '',
                `${fence}yaml`,
                metaLines.join('\n'),
                fence,
                '',
                `${fence}${lang}`,
                content,
                fence,
                '',
                `*End of file \`${item.relativePath}\`${chunkLabel ? ` (${chunkLabel})` : ''}*`,
                '',
                ''
            ].join('\n');
        },

        _decodeToUtf8(uint8) {
            if (uint8.length >= 2 && uint8[0] === 0xFF && uint8[1] === 0xFE) return new TextDecoder('utf-16le', { fatal: true }).decode(uint8);
            if (uint8.length >= 2 && uint8[0] === 0xFE && uint8[1] === 0xFF) return new TextDecoder('utf-16be', { fatal: true }).decode(uint8);
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
                return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
            } catch { /* not UTF-8 */ }

            try {
                return new TextDecoder('shift_jis', { fatal: true }).decode(uint8);
            } catch { /* not Shift_JIS */ }

            try {
                return new TextDecoder('euc-jp', { fatal: true }).decode(uint8);
            } catch { /* not EUC-JP */ }

            if (uint8.length >= 2) {
                if (uint8[0] === 0xFF && uint8[1] === 0xFE) {
                    try { return new TextDecoder('utf-16le').decode(uint8); } catch { }
                }
                if (uint8[0] === 0xFE && uint8[1] === 0xFF) {
                    try { return new TextDecoder('utf-16be').decode(uint8); } catch { }
                }
            }

            return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
        }
    };

    FileFlow.SourceConsolidator = SourceConsolidator;
})();
