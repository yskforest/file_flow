// FileFlow — index and metadata output
(function () {
    'use strict';
    const { $, formatBytes, FS, downloadBlob, csvEscape, bomTextBlob, dirnameOf, readEntryFile, normalizeLookupPath, Glob } = FileFlow.utils;
    const State = FileFlow.state;
    const Status = FileFlow.ui.Status;
    const { yamlFrontmatter, generatedMetadata, markdownText, markdownLink, DEFAULT_CONFIG, BLOCK_OVERHEAD_EST, SUBTREE_MAX_LINES, PARTS_MAP_MAX, CHUNK_RESERVED_BYTES, MAX_OUTPUT_WORDS, OUTPUT_WORD_TARGET, OUTPUT_WORD_RESERVE, SINGLE_BLOCK_WORD_BUDGET, INDEX_SHARD_HEAD_EST_WORDS, _splitContent, countWords, _splitContentByWords, _splitContentDualWords, createExcludeMatcher, assignParts, _buildSubtree, _buildIndexShardHead, VcxprojParser, _getExtension, _fuzzyMatchProject, _detectEntryPoints, _detectLanguage } = FileFlow.exportCommon;
    function _shardCsvRows(headerLine, rowLines, baseName) {
        const target = OUTPUT_WORD_TARGET;
        const headerWords = countWords(headerLine) + 1;
        const shards = [];
        let cur = [];
        let curWords = headerWords;
        for (const row of rowLines) {
            const rw = countWords(row) + 1;
            if (cur.length > 0 && curWords + rw > target) {
                shards.push(cur);
                cur = [];
                curWords = headerWords;
            }
            cur.push(row);
            curWords += rw;
        }
        if (cur.length || shards.length === 0) shards.push(cur);

        // 末尾シャードが極端に小さい場合は直前と均す（結合or均等2分割）
        if (shards.length >= 2) {
            const wordsOf = (rows) => rows.reduce((s, r) => s + countWords(r) + 1, 0);
            const lastWords = wordsOf(shards[shards.length - 1]);
            if (lastWords < target * 0.5) {
                const prev = shards[shards.length - 2];
                const combined = prev.concat(shards[shards.length - 1]);
                const mergedText = headerLine + '\n' + combined.join('\n') + '\n';
                if (countWords(mergedText) < MAX_OUTPUT_WORDS) {
                    shards.splice(shards.length - 2, 2, combined);
                } else if (combined.length > 2) {
                    // 単語数で均等に2分割する
                    const total = wordsOf(combined);
                    let acc = 0, mid = Math.ceil(combined.length / 2);
                    for (let i = 0; i < combined.length; i++) {
                        acc += countWords(combined[i]) + 1;
                        if (acc >= total / 2) { mid = i + 1; break; }
                    }
                    mid = Math.max(1, Math.min(combined.length - 1, mid));
                    shards.splice(shards.length - 2, 2, combined.slice(0, mid), combined.slice(mid));
                }
            }
        }

        // 実測検証。超過シャードは半分に再分割する。
        let guard = 0;
        while (guard++ < 1000) {
            let victim = -1;
            const texts = shards.map(rows => headerLine + '\n' + (rows.length ? rows.join('\n') + '\n' : '\n'));
            for (let i = 0; i < texts.length; i++) {
                if (countWords(texts[i]) >= MAX_OUTPUT_WORDS && shards[i].length > 1) { victim = i; break; }
            }
            if (victim === -1) break;
            const rows = shards[victim];
            const mid = Math.ceil(rows.length / 2);
            shards.splice(victim, 1, rows.slice(0, mid), rows.slice(mid));
        }

        const dot = baseName.lastIndexOf('.');
        const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
        const ext = dot > 0 ? baseName.slice(dot) : '.csv';
        return shards.map((rows, si) => {
            const text = headerLine + '\n' + (rows.length ? rows.join('\n') + '\n' : '\n');
            if (countWords(text) >= MAX_OUTPUT_WORDS) throw new Error('CSV row exceeds the word limit: ' + baseName);
            if (shards.length === 1) {
                return { filename: baseName, blob: bomTextBlob(text, 'text/csv;charset=utf-8;') };
            }
            const num = String(si + 1).padStart(3, '0');
            const total = String(shards.length).padStart(3, '0');
            return { filename: `${stem}_${num}_of_${total}${ext}`, blob: bomTextBlob(text, 'text/csv;charset=utf-8;') };
        });
    }

    function _buildVcxprojCsvRows(projects) {
        const headers = ['Project Name', 'Project Path', 'Configurations', 'Sources', 'Headers', 'Resources', 'Preprocessor Defines', 'Include Directories'];
        const escape = csvEscape;
        const rows = projects.map(p => [
            escape(p.name),
            escape(p.path),
            escape(p.configurations.join('; ')),
            p.sourceFiles.length,
            p.headerFiles.length,
            p.resourceFiles.length,
            escape(p.defines.join('; ')),
            escape(p.includeDirs.join('; '))
        ].join(','));
        return { header: headers.join(','), rows };
    }

    function _buildFolderStructureCsvRows(fileItems) {
        const headers = ['Folder Path', 'Parent Folder', 'Depth', 'File Count', 'Total Size (Bytes)'];
        const escape = csvEscape;
        const folderMap = new Map();
        for (const item of fileItems) {
            const folderPath = dirnameOf(item.relativePath);
            if (!folderMap.has(folderPath)) {
                const parts = folderPath === '.' ? [] : folderPath.split('/');
                const parentFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : (folderPath === '.' ? '' : '.');
                folderMap.set(folderPath, {
                    folderPath,
                    parentFolder,
                    depth: parts.length,
                    fileCount: 0,
                    totalSize: 0
                });
            }
            const info = folderMap.get(folderPath);
            info.fileCount++;
            info.totalSize += (item.size || 0);
        }
        const rows = [...folderMap.values()].map(f => [
            escape(f.folderPath),
            escape(f.parentFolder),
            f.depth,
            f.fileCount,
            f.totalSize
        ].join(','));
        return { header: headers.join(','), rows };
    }

    function _buildTargetFilesCsvRows(fileItems) {
        const headers = ['File Path', 'Project Name', 'Filter Path', 'Size (Bytes)', 'Extension'];
        const escape = csvEscape;
        const rows = fileItems.map(item => [
            escape(item.relativePath),
            escape(item.projectName || ''),
            escape(item.filter || ''),
            item.size || 0,
            escape(_getExtension(item.relativePath))
        ].join(','));
        return { header: headers.join(','), rows };
    }

    function _shardVcxprojCsv(projects, baseName = 'vcxproj_list.csv') {
        const { header, rows } = _buildVcxprojCsvRows(projects);
        return _shardCsvRows(header, rows, baseName);
    }

    function _shardFolderStructureCsv(fileItems, baseName = 'folder_structure.csv') {
        const { header, rows } = _buildFolderStructureCsvRows(fileItems);
        return _shardCsvRows(header, rows, baseName);
    }

    function _shardTargetFilesCsv(fileItems, baseName = 'target_files_list.csv') {
        const { header, rows } = _buildTargetFilesCsvRows(fileItems);
        return _shardCsvRows(header, rows, baseName);
    }

    function _generateVcxprojCsv(projects) {
        const { header, rows } = _buildVcxprojCsvRows(projects);
        const csvText = header + '\n' + (rows.length ? rows.join('\n') + '\n' : '\n');
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    function _generateFolderStructureCsv(fileItems) {
        const { header, rows } = _buildFolderStructureCsvRows(fileItems);
        const csvText = header + '\n' + (rows.length ? rows.join('\n') + '\n' : '\n');
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    function _generateTargetFilesCsv(fileItems) {
        const { header, rows } = _buildTargetFilesCsvRows(fileItems);
        const csvText = header + '\n' + (rows.length ? rows.join('\n') + '\n' : '\n');
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    // =====================================================================
    //  OKF v0.2 Navigation and Codebase Overview
    // =====================================================================

    /**
     * Generate OKF-compliant index file(s) — master table of contents.
     * All-Filesテーブルが上限を超える場合は `codebase.md` + `index_files_*` に分割する。
     * @returns {Array<{filename: string, blob: Blob}>} index.md, codebase.md, optional catalogue shards
     */
    function _generateIndexMd({ rootName, mode, ext, allFilesInfo, fileItems, results, partFileList, projects, maxIndexBytes, generatedAt = new Date().toISOString() }) {
        const encoder = new TextEncoder();
        const byteLimit = (maxIndexBytes && maxIndexBytes > 0) ? maxIndexBytes : Infinity;
        const wordLimit = OUTPUT_WORD_TARGET;
        const totalFiles = allFilesInfo.length;
        const exportedFiles = allFilesInfo.filter(f => f.isExportTarget).length;
        const binaryFiles = totalFiles - exportedFiles;
        const totalSizeBytes = allFilesInfo.reduce((sum, f) => sum + f.size, 0);
        const exportedSizeBytes = fileItems.reduce((sum, f) => sum + f.size, 0);
        const totalParts = results.length;

        // Build directory stats
        const dirStats = new Map();
        for (const f of allFilesInfo) {
            const dir = dirnameOf(f.relativePath);
            if (!dirStats.has(dir)) {
                dirStats.set(dir, { files: 0, exported: 0, binary: 0, size: 0 });
            }
            const s = dirStats.get(dir);
            s.files++;
            s.size += f.size;
            if (f.isExportTarget) s.exported++;
            else s.binary++;
        }

        // Build file-to-part mapping（分割ファイルは複数パートに属する）
        const filePartMap = new Map();
        if (partFileList) {
            for (let i = 0; i < partFileList.length; i++) {
                for (const f of partFileList[i]) {
                    if (!filePartMap.has(f.path)) filePartMap.set(f.path, []);
                    const arr = filePartMap.get(f.path);
                    if (!arr.includes(i + 1)) arr.push(i + 1);
                }
            }
        }

        // Overview is a concept; the reserved root index is generated separately.
        const lines = [yamlFrontmatter({
            type: 'codebase_overview', title: `${rootName} — Codebase Overview`,
            description: 'Export scope, directory counts, source-part mapping and per-file inclusion status.',
            tags: ['codebase', 'overview'], generated: generatedMetadata(generatedAt),
            sources: [{ resource: 'Local directory snapshot: ' + rootName, title: rootName }],
            export_mode: mode, total_files: totalFiles, total_directories: dirStats.size,
            total_size_bytes: totalSizeBytes, exported_text_files: exportedFiles,
            non_exported_files: binaryFiles, export_parts: totalParts
        }), ''];

        // --- Summary ---
        lines.push(`# ${markdownText(rootName)} — Codebase Overview`);
        lines.push('');
        lines.push('> **Load this file first.** It provides the complete structural overview of the exported codebase.');
        lines.push('> ' + markdownLink('Bundle contents', 'index.md') + ' lists every document. Source parts contain embedded code; local input paths name the original snapshot.');
        lines.push('');
        lines.push('## Export Summary');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('|---|---|');
        lines.push(`| Root Workspace | \`${rootName}\` |`);
        lines.push(`| Export Mode | ${mode === 'vcxproj' ? 'Visual Studio (vcxproj)' : 'Folder Structure'} |`);
        lines.push(`| Total Files | ${totalFiles.toLocaleString()} |`);
        lines.push(`| Exported (Text) Files | ${exportedFiles.toLocaleString()} |`);
        lines.push(`| Non-Exported Files | ${binaryFiles.toLocaleString()} |`);
        lines.push(`| Total Size | ${formatBytes(totalSizeBytes)} |`);
        lines.push(`| Exported Size | ${formatBytes(exportedSizeBytes)} |`);
        lines.push(`| Export Parts | ${totalParts} file(s) |`);
        lines.push('');

        // --- Build Units (vcxproj mode) ---
        if (mode === 'vcxproj' && projects && projects.length > 0) {
            lines.push('## Build Units (Visual Studio Projects)');
            lines.push('');
            lines.push('| Project | Sources | Headers | Resources | Configs |');
            lines.push('|---|---|---|---|---|');
            for (const p of projects) {
                const configs = p.configurations.length ? p.configurations.join(', ') : 'Default';
                lines.push(`| \`${p.name}\` | ${p.sourceFiles.length} | ${p.headerFiles.length} | ${p.resourceFiles.length} | ${configs} |`);
            }
            lines.push('');

            // Defines & Includes (compact)
            for (const p of projects) {
                if (p.defines.length || p.includeDirs.length) {
                    lines.push(`### ${p.name}`);
                    if (p.defines.length) {
                        lines.push(`- **Defines**: \`${p.defines.join('; ')}\``);
                    }
                    if (p.includeDirs.length) {
                        lines.push(`- **Include Dirs**: \`${p.includeDirs.join('; ')}\``);
                    }
                    lines.push('');
                }
            }
        }

        // --- Directory Structure Table ---
        lines.push('## Directory Structure');
        lines.push('');
        lines.push('| Directory | Files | Exported | Non-Exported | Size |');
        lines.push('|---|---|---|---|---|');

        const sortedDirs = [...dirStats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        for (const [dir, s] of sortedDirs) {
            lines.push(`| \`${dir}/\` | ${s.files} | ${s.exported} | ${s.binary} | ${formatBytes(s.size)} |`);
        }
        lines.push('');

        // --- Export Parts Map ---
        if (totalParts > 0) {
            lines.push('## Export Parts Map');
            lines.push('');
            lines.push(`| Part | Filename | Files | Primary Directories |`);
            lines.push('|---|---|---|---|');

            for (let i = 0; i < partFileList.length; i++) {
                const pFiles = partFileList[i];
                const filename = results[i].filename;

                // Aggregate directories
                const dirCounts = new Map();
                for (const f of pFiles) {
                    const dir = dirnameOf(f.path);
                    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
                }
                const topDirs = [...dirCounts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([d, c]) => `\`${d}/\` (${c})`)
                    .join(', ');

                lines.push(`| ${i + 1} | ${markdownLink(filename, filename)} | ${pFiles.length} | ${topDirs} |`);
            }
            lines.push('');
        }

        // --- Full File List（上限超過時はシャード分割） ---
        const allRows = [];
        for (let i = 0; i < allFilesInfo.length; i++) {
            const f = allFilesInfo[i];
            const type = f.status || (f.excluded ? 'excluded' : (f.isExportTarget ? 'text' : 'non-target'));
            const partsHit = filePartMap.get(f.relativePath);
            const partStr = partsHit ? partsHit.map(part => markdownLink(String(part), results[part - 1].filename)).join(', ') : '—';
            allRows.push(`| ${i + 1} | \`${f.relativePath}\` | ${formatBytes(f.size)} | ${type} | ${partStr} |`);
        }

        let headText = lines.join('\n') + '\n';
        const tableHead = ['## All Files', '', '| # | Path | Size | Type | Part |', '|---|---|---|---|---|'];
        const tableHeadText = tableHead.join('\n') + '\n';

        // ヘッダ単体で単語数ターゲット超えの場合は Directory Structure 行を間引いて保証する
        const headFits = (h) => countWords(h) + countWords(tableHeadText) < wordLimit &&
            (byteLimit === Infinity || encoder.encode(h).length + encoder.encode(tableHeadText).length < byteLimit);
        if (!headFits(headText)) {
            const dirHeaderIdx = lines.findIndex(l => l === '| Directory | Files | Exported | Non-Exported | Size |');
            if (dirHeaderIdx !== -1) {
                // ディレクトリ行範囲を特定（ヘッダ2行後〜空行まで）
                let start = dirHeaderIdx + 2;
                let end = start;
                while (end < lines.length && lines[end] !== '') end++;
                const total = end - start;
                // 先頭から収まる分だけ残す
                let keep = total;
                while (keep > 0 && !headFits(lines.slice(0, start).join('\n') + '\n' +
                    lines.slice(start, start + keep).join('\n') +
                    `\n... (${total - keep} directories omitted to stay under 500k words)\n` +
                    lines.slice(end).join('\n') + '\n')) {
                    keep = Math.floor(keep / 2);
                }
                const omitted = total - keep;
                const kept = lines.slice(start, start + keep);
                if (omitted > 0) kept.push(`... (${omitted} directories omitted to stay under 500k words)`);
                lines.splice(start, total, ...kept);
                headText = lines.join('\n') + '\n';
            }
        }
        const headBytes = encoder.encode(headText).length;
        const tableHeadBytes = encoder.encode(tableHeadText).length;

        // 行単位でシャード割付（バイト制限と単語数制限の厳しい方）
        const headWords = countWords(headText);
        const tableHeadWords = countWords(tableHeadText);
        const shards = [];
        let cur = [];
        let curBytes = headBytes + tableHeadBytes;
        let curWords = headWords + tableHeadWords;
        const nextShardHeadBytes = tableHeadBytes + 1200;
        const nextShardHeadWords = tableHeadWords + INDEX_SHARD_HEAD_EST_WORDS;
        for (const row of allRows) {
            const rb = encoder.encode(row + '\n').length;
            const rw = countWords(row) + 1;
            if (cur.length > 0 && (curBytes + rb > byteLimit || curWords + rw > wordLimit)) {
                shards.push(cur);
                cur = [];
                curBytes = nextShardHeadBytes;
                curWords = nextShardHeadWords;
            }
            cur.push(row);
            curBytes += rb;
            curWords += rw;
        }
        if (cur.length || shards.length === 0) shards.push(cur);

        // 末尾シャードが極端に小さい場合は直前と均す（結合or均等2分割）
        if (shards.length >= 2) {
            const rowsWordsOf = (rows) => rows.reduce((s, r) => s + countWords(r) + 1, 0);
            if (rowsWordsOf(shards[shards.length - 1]) < wordLimit * 0.5) {
                const combined = shards[shards.length - 2].concat(shards[shards.length - 1]);
                const trialLen = shards.length - 1;
                let masterTrial = headText;
                if (trialLen > 1) {
                    masterTrial = headText.replace('| Export Parts |',
                        `| Index Shard Files | ${trialLen} file(s) (\`codebase.md\` + \`index_files_*\`) |\n| Export Parts |`);
                }
                const mergedText = trialLen === 1
                    ? masterTrial + tableHeadText + combined.join('\n') + '\n'
                    : _buildIndexShardHead(rootName, trialLen, trialLen, generatedAt) + tableHeadText + combined.join('\n') + '\n';
                if (countWords(mergedText) < MAX_OUTPUT_WORDS &&
                    (byteLimit === Infinity || encoder.encode(mergedText).length <= byteLimit)) {
                    shards.splice(shards.length - 2, 2, combined);
                } else if (combined.length > 2) {
                    const total = rowsWordsOf(combined);
                    let acc = 0, mid = Math.ceil(combined.length / 2);
                    for (let i = 0; i < combined.length; i++) {
                        acc += countWords(combined[i]) + 1;
                        if (acc >= total / 2) { mid = i + 1; break; }
                    }
                    mid = Math.max(1, Math.min(combined.length - 1, mid));
                    shards.splice(shards.length - 2, 2, combined.slice(0, mid), combined.slice(mid));
                }
            }
        }

        // 実測検証：各シャードの最終テキストが50万語未満になるまで半分に再分割する
        const buildShardTextForCheck = (rows, si, totalShards, masterHead) => {
            if (totalShards === 1) return masterHead + tableHeadText + rows.join('\n') + '\n';
            if (si === 0) return masterHead + tableHeadText + rows.join('\n') + '\n';
            const shardNum = si + 1;
            const shardHead = _buildIndexShardHead(rootName, shardNum, totalShards, generatedAt);
            return shardHead + tableHeadText + rows.join('\n') + '\n';
        };
        let guard = 0;
        while (guard++ < 1000) {
            let masterHeadTmp = headText;
            if (shards.length > 1) {
                masterHeadTmp = headText.replace('| Export Parts |',
                    `| Index Shard Files | ${shards.length} file(s) (\`codebase.md\` + \`index_files_*\`) |\n| Export Parts |`);
            }
            let victim = -1;
            for (let i = 0; i < shards.length; i++) {
                const t = buildShardTextForCheck(shards[i], i, shards.length, masterHeadTmp);
                if (countWords(t) >= MAX_OUTPUT_WORDS ||
                    (byteLimit !== Infinity && encoder.encode(t).length + 3 > byteLimit && shards[i].length > 1)) {
                    if (shards[i].length > 1) { victim = i; break; }
                }
            }
            if (victim === -1) break;
            const rows = shards[victim];
            const mid = Math.ceil(rows.length / 2);
            shards.splice(victim, 1, rows.slice(0, mid), rows.slice(mid));
        }

        let masterHeadText = headText;
        if (shards.length > 1) {
            masterHeadText = headText.replace('| Export Parts |',
                `| Index Shard Files | ${shards.length} file(s) (\`codebase.md\` + \`index_files_*\`) |\n| Export Parts |`);
        }

        const indexFiles = shards.map((rows, si) => {
            const shardNum = si + 1;
            if (shards.length === 1) {
                return { filename: 'codebase.md', blob: bomTextBlob(masterHeadText + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
            }
            if (si === 0) {
                return { filename: 'codebase.md', blob: bomTextBlob(masterHeadText + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
            }
            const shardHead = _buildIndexShardHead(rootName, shardNum, shards.length, generatedAt);
            const num = String(shardNum).padStart(3, '0');
            const totalNum = String(shards.length).padStart(3, '0');
            return { filename: `index_files_${num}_of_${totalNum}.md`, blob: bomTextBlob(shardHead + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
        });
        for (const output of indexFiles) {
            if (output.blob.size > byteLimit) throw new Error('Index size limit is too small for headers or a file row: ' + output.filename);
        }
        const navigation = [
            yamlFrontmatter({ okf_version: '0.2' }),
            '# ' + markdownText(rootName) + ' — Bundle Contents', '',
            '## Overview and file catalogues', '',
            ...indexFiles.map((file, i) => '* ' + markdownLink(file.filename, file.filename) +
                (i === 0 ? ' - Export scope, directory counts, source-part mapping and per-file inclusion status.' : ' - Continuation of the per-file catalogue.')),
            '', '## Source code', '',
            ...results.map(file => '* ' + markdownLink(file.filename, file.filename) + ' - Source excerpts with paths and provenance.'),
            ''
        ].join('\n');
        if (encoder.encode(navigation).length + 3 > byteLimit || countWords(navigation) >= MAX_OUTPUT_WORDS) {
            throw new Error('Index size limit is too small for bundle navigation');
        }
        indexFiles.unshift({ filename: 'index.md', blob: bomTextBlob(navigation, 'text/markdown;charset=utf-8') });
        return indexFiles;
    }

    // =====================================================================
    //  Helper Functions
    // =====================================================================

    FileFlow.exportFormat = { _shardCsvRows, _shardTargetFilesCsv, _shardFolderStructureCsv, _shardVcxprojCsv, _generateTargetFilesCsv, _generateFolderStructureCsv, _generateVcxprojCsv, _generateIndexMd };
})();
