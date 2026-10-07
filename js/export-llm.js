// FileFlow — scan, configuration, preview and export orchestration
(function () {
    'use strict';
    const { $, formatBytes, FS, downloadBlob, csvEscape, bomTextBlob, dirnameOf, readEntryFile, normalizeLookupPath, Glob } = FileFlow.utils;
    const State = FileFlow.state;
    const Status = FileFlow.ui.Status;
    const { yamlFrontmatter, generatedMetadata, markdownText, markdownLink, DEFAULT_CONFIG, BLOCK_OVERHEAD_EST, SUBTREE_MAX_LINES, PARTS_MAP_MAX, CHUNK_RESERVED_BYTES, MAX_OUTPUT_WORDS, OUTPUT_WORD_TARGET, OUTPUT_WORD_RESERVE, SINGLE_BLOCK_WORD_BUDGET, INDEX_SHARD_HEAD_EST_WORDS, _splitContent, countWords, _splitContentByWords, _splitContentDualWords, createExcludeMatcher, assignParts, _buildSubtree, _buildIndexShardHead, VcxprojParser, _getExtension, _fuzzyMatchProject, _detectEntryPoints, _detectLanguage } = FileFlow.exportCommon;
    const SourceConsolidator = FileFlow.SourceConsolidator;
    const { _shardCsvRows, _shardTargetFilesCsv, _shardFolderStructureCsv, _shardVcxprojCsv, _generateTargetFilesCsv, _generateFolderStructureCsv, _generateVcxprojCsv, _generateIndexMd } = FileFlow.exportFormat;
    // =====================================================================
    //  Export Orchestrator — Scans, parses vcxproj, previews & exports
    // =====================================================================

    async function scanProjects() {
        const roots = State.currentRootEntries;
        if (!roots.length) {
            return { projects: [], fileItems: [], allFilesInfo: [], totalSizeBytes: 0 };
        }

        const config = getExportConfig();

        const vcxprojEntries = [];
        const filterEntries = [];
        const allFileEntries = [];
        const scanErrors = [];

        await FS.traverse(roots, async entry => {
            if (entry.isFile) {
                const lname = entry.name.toLowerCase();
                if (lname.endsWith('.vcxproj') && !lname.endsWith('.vcxproj.filters') && !lname.endsWith('.vcxproj.user')) {
                    vcxprojEntries.push(entry);
                } else if (lname.endsWith('.vcxproj.filters')) {
                    filterEntries.push(entry);
                }
                allFileEntries.push(entry);
            }
            return true;
        }, { excludeDots: State.appSettings.excludeDots, onError(entry,error) { scanErrors.push({ path: entry.fullPath, status: 'failed', reason: 'directory-read: ' + String(error.message || error) }); } });

        const projects = [];
        const projectFileMap = new Map();

        for (const entry of vcxprojEntries) {
            try {
                const file = await readEntryFile(entry);
                const text = await file.text();
                const projInfo = VcxprojParser.parseProject(text, entry.fullPath);

                const filterName = entry.name + '.filters';
                const filterEntry = filterEntries.find(f => f.name === filterName &&
                    f.fullPath.replace(f.name, '') === entry.fullPath.replace(entry.name, ''));
                if (filterEntry) {
                    try {
                        const filterFile = await readEntryFile(filterEntry);
                        const filterText = await filterFile.text();
                        projInfo.filterMap = VcxprojParser.parseFilters(filterText);
                    } catch { /* no filters */ }
                }

                projects.push(projInfo);

                const projDir = entry.fullPath.replace(/\/[^/]+$/, '');
                const allRefs = [
                    ...projInfo.sourceFiles,
                    ...projInfo.headerFiles,
                    ...projInfo.resourceFiles,
                    ...projInfo.otherFiles
                ];
                for (const ref of allRefs) {
                    const normalized = normalizeLookupPath(projDir + '/' + ref);
                    projectFileMap.set(normalized, {
                        projectName: projInfo.name,
                        filter: projInfo.filterMap[ref.replace(/\\/g, '/')] || ''
                    });
                }
            } catch (e) {
                console.warn('Failed to parse vcxproj:', entry.fullPath, e);
                scanErrors.push({ path: entry.fullPath, status: 'failed', reason: 'project-parse: ' + String(e.message || e) });
            }
        }

        const fileItems = [];
        const allFilesInfo = [];  // All files including binaries (for index.md)
        let totalSizeBytes = 0;
        const rootNames = roots.map(root => root.name || '');
        // ツールバーのGlobフィルタを尊重する（空なら全件）
        const globMatcher = Glob.createMatcher(State.searchQuery);
        const activeFilterLabel = State.searchQuery && State.searchQuery.trim()
            ? `Glob: ${State.searchQuery.trim()}`
            : null;
        // 生成物ノイズ（node_modules等）は本文から除外し、indexには excluded として記録する
        const excludeMatcher = createExcludeMatcher(config.excludePatterns);

        for (const entry of allFileEntries) {
            const ext = _getExtension(entry.name);

            const relativePath = FileFlow.utils.Entries.buildRelPath(entry, rootNames) || entry.name;

            if (globMatcher && !globMatcher(entry.name, relativePath)) continue;

            const isSourceTarget = config.sourceExtensions.has(ext);
            const isExcluded = !!(excludeMatcher && excludeMatcher(entry.name, relativePath));

            let fileSize = 0;
            const meta = State.entryMetadata[entry.fullPath];
            if (meta?.size !== undefined) {
                fileSize = meta.size;
            } else {
                try {
                    const file = await readEntryFile(entry);
                    fileSize = file.size;
                } catch { /* ignore */ }
            }

            // Collect all files for index.md
            allFilesInfo.push({
                relativePath,
                size: fileSize,
                extension: ext,
                isExportTarget: isSourceTarget && !isExcluded,
                excluded: isExcluded
            });

            if (!isSourceTarget || isExcluded) continue;

            const normalizedPath = normalizeLookupPath(entry.fullPath);
            const projRef = projectFileMap.get(normalizedPath) || _fuzzyMatchProject(entry, projectFileMap);

            totalSizeBytes += fileSize;

            fileItems.push({
                entry,
                relativePath,
                projectName: projRef?.projectName || '',
                filter: projRef?.filter || '',
                size: fileSize
            });
        }

        // Default sort: path-based for folder structure consistency
        fileItems.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        allFilesInfo.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        return { projects, fileItems, allFilesInfo, totalSizeBytes, activeFilterLabel, scanErrors };
    }

    async function showVcxprojPreviewModal() {
        const roots = State.currentRootEntries;
        if (!roots.length) {
            Status.error('No files loaded. Drop a folder first.');
            return;
        }

        Status.show('Scanning projects and directory structure...', true);
        await new Promise(r => setTimeout(r, 20));

        try {
            const data = await scanProjects();
            Status.hide();
            FileFlow.ui.VcxprojPreview.show(data);
        } catch (err) {
            console.error('Project scanning error:', err);
            Status.error('Failed to scan projects: ' + err.message);
        }
    }

    /**
     * Main export function for LLM agents.
     * @param {object} options
     * @param {Array<string>|null} options.selectedProjectNames
     * @param {string} options.mode - 'vcxproj' | 'folder_structure'
     * @param {string} options.ext - '.md' (OKF v0.2)
     * @param {number} options.maxPartSizeBytes - bytes (0 or Infinity for unsplit)
     * @param {number} options.maxFilesPerPart - files (0 or Infinity for unlimited)
     */
    /**
     * RAG対策: README系ドキュメントを先頭に固定したうえでモード別に整列する。
     * エントリーポイント候補がパート1の先頭に来ることで、LLMが概要から読み進められる。
     */
    function sortFileItems(fileItems, mode) {
        const isReadme = (item) => /^readme(\.|$)/i.test(item.relativePath.split('/').pop());
        const byMode = (a, b) => {
            if (mode === 'vcxproj') {
                if (a.projectName !== b.projectName) return (a.projectName || 'Z').localeCompare(b.projectName || 'Z');
            }
            return a.relativePath.localeCompare(b.relativePath);
        };
        fileItems.sort((a, b) => {
            const ra = isReadme(a) ? 0 : 1;
            const rb = isReadme(b) ? 0 : 1;
            return (ra - rb) || byMode(a, b);
        });
        return fileItems;
    }

    /**
     * Main export function for LLM agents.
     * @param {object} options
     * @param {Array<string>|null} options.selectedProjectNames
     * @param {string} options.mode - 'vcxproj' | 'folder_structure'
     * @param {string} options.ext - '.md' (OKF v0.2)
     * @param {number} options.maxPartSizeBytes - bytes (0 or Infinity for unsplit)
     * @param {number} options.maxFilesPerPart - files (0 or Infinity for unlimited)
     */
    async function exportForLLM(options = {}) {
        const {
            selectedProjectNames = null,
            mode = 'folder_structure',
            ext = '.md',
            maxPartSizeBytes = 4 * 1024 * 1024,
            maxFilesPerPart = null
        } = typeof options === 'object' && !Array.isArray(options) ? options : { selectedProjectNames: options };

        if (ext !== '.md' && ext !== 'md') throw new Error('OKF v0.2 concept documents must use .md');
        const generatedAt = new Date().toISOString();
        const roots = State.currentRootEntries;
        if (!roots.length) {
            Status.error('No files loaded. Drop a folder first.');
            return;
        }

        const config = getExportConfig();
        const effectiveMaxFiles = (maxFilesPerPart === null || maxFilesPerPart === undefined)
            ? config.maxFilesPerPart : maxFilesPerPart;
        Status.show('Preparing export data...', true);
        await new Promise(r => setTimeout(r, 20));

        const { projects, fileItems: allItems, allFilesInfo, scanErrors } = await scanProjects();

        let targetProjects = projects;
        let fileItems = allItems;

        if (mode === 'vcxproj' && selectedProjectNames && Array.isArray(selectedProjectNames)) {
            const selectedSet = new Set(selectedProjectNames);
            targetProjects = projects.filter(p => selectedSet.has(p.name));
            fileItems = allItems.filter(item => !item.projectName || selectedSet.has(item.projectName));
        }

        if (!fileItems.length) {
            Status.error('No source files found matching the selected parameters.');
            return;
        }

        // Sort file items depending on mode (README first for RAG entry)
        sortFileItems(fileItems, mode);

        Status.show(`Consolidating ${fileItems.length.toLocaleString()} files (OKF Markdown)...`, true);

        const { results, partFileList, report } = await SourceConsolidator.consolidate({
            fileItems,
            projects: targetProjects,
            generatedAt,
            mode,
            ext,
            maxPartSize: maxPartSizeBytes,
            maxFilesPerPart: effectiveMaxFiles,
            maxSingleFileSize: config.maxSingleFileSizeBytes,
            onProgress(done, total) {
                Status.show(`Processing files... (${done.toLocaleString()} / ${total.toLocaleString()})`, true);
            }
        });

        const outcomes = new Map(report.map(r => [r.path, r]));
        allFilesInfo.forEach(f => {
            const outcome = outcomes.get(f.relativePath);
            f.status = outcome ? outcome.status : (f.isExportTarget ? 'excluded' : (f.excluded ? 'excluded' : 'non-target'));
            f.reason = outcome ? outcome.reason : (f.isExportTarget ? 'project-selection' : '');
            f.isExportTarget = f.status === 'exported';
        });
        fileItems = fileItems.filter(f => outcomes.get(f.relativePath)?.status === 'exported');
        const reportCsvs = _shardCsvRows('Path,Status,Reason', allFilesInfo.map(f => [f.relativePath, f.status, f.reason].map(csvEscape).join(',')).concat((scanErrors || []).map(r => [r.path,r.status,r.reason].map(csvEscape).join(','))), 'export_report.csv');

        // Generate index file(s) — sharded when exceeding the part-size limit
        Status.show('Generating index...', true);
        const rootName = roots.length === 1 ? roots[0].name : 'project';
        const indexFiles = _generateIndexMd({
            rootName, mode, ext, allFilesInfo, fileItems,
            results, partFileList, projects: targetProjects,
            maxIndexBytes: maxPartSizeBytes, generatedAt
        });

        // Generate CSV files based on mode (all sharded to < 500k words)
        const targetFilesCsvs = _shardTargetFilesCsv(fileItems, 'target_files_list.csv');
        let secondaryCsvs = null;

        if (mode === 'vcxproj') {
            secondaryCsvs = _shardVcxprojCsv(targetProjects, 'vcxproj_list.csv');
        } else {
            secondaryCsvs = _shardFolderStructureCsv(fileItems, 'folder_structure.csv');
        }

        Status.show(`Creating ZIP package with ${results.length} part(s), ${indexFiles.length} index file(s), and metadata CSVs...`, true);

        try {
            const zip = new JSZip();
            for (const idx of indexFiles) {
                zip.file(idx.filename, idx.blob);
            }
            for (const r of results) {
                zip.file(r.filename, r.blob);
            }
            for (const c of reportCsvs.concat(secondaryCsvs)) {
                zip.file(c.filename, c.blob);
            }
            for (const c of targetFilesCsvs) {
                zip.file(c.filename, c.blob);
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, `${rootName}_llm_export.zip`);
            const failed = report.filter(r => r.status === 'failed').length + (scanErrors || []).length;
            Status.show(`Exported ZIP (${fileItems.length} files, ${failed} failed; see export_report.csv): ${indexFiles.length} index file(s) + ${results.length} part(s) + ${secondaryCsvs.length + targetFilesCsvs.length} CSVs (${formatBytes(zipBlob.size)})`);
        } catch (e) {
            console.warn('ZIP creation failed, downloading files individually:', e);
            for (const idx of indexFiles) {
                downloadBlob(idx.blob, idx.filename);
                await new Promise(res => setTimeout(res, 300));
            }
            for (const r of results) {
                downloadBlob(r.blob, r.filename);
                await new Promise(res => setTimeout(res, 300));
            }
            for (const c of reportCsvs.concat(secondaryCsvs)) {
                downloadBlob(c.blob, c.filename);
                await new Promise(res => setTimeout(res, 300));
            }
            for (const c of targetFilesCsvs) {
                downloadBlob(c.blob, c.filename);
                await new Promise(res => setTimeout(res, 300));
            }
            Status.show(`Exported ${results.length + indexFiles.length + secondaryCsvs.length + targetFilesCsvs.length} files individually`);
        }
    }

    // =====================================================================
    //  CSV Generators (all outputs guaranteed < 500k words via sharding)
    function normalizeSettings(saved) {
        const out = { ...saved };
        const positive = (value, fallback, min, max) => value !== '' && value !== null && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
        out.maxPartSizeMB = positive(saved.maxPartSizeMB, 4, 0.01, 50);
        out.maxSingleFileSizeMB = positive(saved.maxSingleFileSizeMB, 1, 0.01, 10);
        out.maxFilesPerPart = Math.floor(positive(saved.maxFilesPerPart, 1000, 0, 100000));
        return out;
    }

    function getExportConfig() {
        // 旧キー notebookLMConfig からの移行に対応
        const saved = normalizeSettings(State.appSettings.llmExportConfig || State.appSettings.notebookLMConfig || {});
        const maxFilesRaw = saved.maxFilesPerPart;
        return {
            mode: saved.mode || DEFAULT_CONFIG.mode,
            ext: '.md',
            maxPartSizeBytes: saved.maxPartSizeMB
                ? saved.maxPartSizeMB * 1024 * 1024
                : DEFAULT_CONFIG.maxPartSizeBytes,
            maxFilesPerPart: (maxFilesRaw === 0) ? 0
                : (Number.isFinite(+maxFilesRaw) && +maxFilesRaw > 0 ? Math.floor(+maxFilesRaw) : DEFAULT_CONFIG.maxFilesPerPart),
            maxSingleFileSizeBytes: saved.maxSingleFileSizeMB
                ? saved.maxSingleFileSizeMB * 1024 * 1024
                : DEFAULT_CONFIG.maxSingleFileSizeBytes,
            sourceExtensions: saved.sourceExtensions
                ? new Set(saved.sourceExtensions.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
                : DEFAULT_CONFIG.sourceExtensions,
            excludePatterns: (typeof saved.excludePatterns === 'string')
                ? saved.excludePatterns
                : DEFAULT_CONFIG.excludePatterns,
            chunkSize: DEFAULT_CONFIG.chunkSize
        };
    }

    function getDefaultExcludesString() {
        return DEFAULT_CONFIG.excludePatterns;
    }

    function getDefaultExtensionsString() {
        return [...DEFAULT_CONFIG.sourceExtensions].join(', ');
    }

    // 照合用正規化は core の共有ヘルパーを使用する。

    // Export Public API
    FileFlow.llmExport = {
        scanProjects,
        showVcxprojPreviewModal,
        exportForLLM,
        getExportConfig,
        normalizeSettings,
        getDefaultExtensionsString,
        getDefaultExcludesString,
        VcxprojParser,
        SourceConsolidator,
        DEFAULT_CONFIG,
        MAX_OUTPUT_WORDS,
        OUTPUT_WORD_TARGET,
        // テスト用の内部公開（仕様外）
        _internals: { getExtension: _getExtension, detectLanguage: _detectLanguage, fuzzyMatchProject: _fuzzyMatchProject, detectEntryPoints: _detectEntryPoints,
            generateTargetFilesCsv: _generateTargetFilesCsv, generateFolderStructureCsv: _generateFolderStructureCsv, generateVcxprojCsv: _generateVcxprojCsv,
            generateIndexMd: _generateIndexMd, assignParts, buildSubtree: _buildSubtree,
            splitContent: _splitContent, countWords, splitContentByWords: _splitContentByWords, splitContentDualWords: _splitContentDualWords,
            shardCsvRows: _shardCsvRows, shardTargetFilesCsv: _shardTargetFilesCsv,
            shardFolderStructureCsv: _shardFolderStructureCsv, shardVcxprojCsv: _shardVcxprojCsv,
            createExcludeMatcher, sortFileItems, getDefaultExcludesString }
    };
    // 旧名前空間の後方互換エイリアス（移行期間のみ）
    FileFlow.notebookLM = FileFlow.llmExport;
})();
