// FileFlow — LLM OKF Export Module (vcsproj / folder-structure)
(function () {
    const { $, formatBytes, FS, downloadBlob, csvEscape, bomTextBlob, dirnameOf, readEntryFile, normalizeLookupPath, Glob } = FileFlow.utils;
    const State = FileFlow.state;
    const Status = FileFlow.ui.Status;

    // =====================================================================
    //  Default Configuration
    // =====================================================================

    const DEFAULT_CONFIG = {
        mode: 'auto',                            // 'auto' | 'vcxproj' | 'folder_structure'
        ext: '.md',                              // '.md' | '.txt'
        maxPartSizeBytes: 4 * 1024 * 1024,       // 4MB per output file
        maxFilesPerPart: 1000,                   // max files per output part (0 = unlimited)
        maxSingleFileSizeBytes: 1 * 1024 * 1024,  // Skip files > 1MB by default
        sourceExtensions: new Set([
            '.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.inl',
            '.cs', '.rc', '.idl', '.def', '.asm', '.s',
            '.java', '.py', '.js', '.ts', '.jsx', '.tsx',
            '.xml', '.xaml', '.json', '.yml', '.yaml',
            '.sql', '.proto', '.thrift',
            '.hlsl', '.glsl', '.fx',
            '.cmake', '.mk', '.mak',
            '.bat', '.cmd', '.sh', '.ps1',
            '.txt', '.md', '.rst', '.cfg', '.ini', '.conf', '.toml',
            '.sln', '.vcxproj', '.csproj', '.props', '.targets'
        ]),
        chunkSize: 500  // Files per UI-yield chunk
    };

    // OKFブロック1件あたりのメタデータ・オーバーヘッド概算（割付推定用）
    const BLOCK_OVERHEAD_EST = 512;
    // パートヘッダーに埋め込むディレクトリサブツリーの行上限
    const SUBTREE_MAX_LINES = 300;
    // パートヘッダーに全パートマップを載せる上限パート数
    const PARTS_MAP_MAX = 32;

    /**
     * 事前割付（I/Oなし）: バイト数と件数の二重制限でファイル群をパートに振り分ける。
     * @returns {Array<Array<number>>} fileItems へのインデックス配列の配列
     */
    function assignParts(fileItems, effectivePartSize, effectiveMaxFiles) {
        const groups = [];
        let cur = [];
        let curSize = 0;
        const fits = (est) =>
            (effectivePartSize === Infinity || curSize + est <= effectivePartSize) &&
            (effectiveMaxFiles === Infinity || cur.length < effectiveMaxFiles);
        fileItems.forEach((item, idx) => {
            const est = (item.size || 0) + BLOCK_OVERHEAD_EST;
            if (cur.length > 0 && !fits(est)) {
                groups.push(cur);
                cur = [];
                curSize = 0;
            }
            cur.push(idx);
            curSize += est;
        });
        if (cur.length) groups.push(cur);
        return groups;
    }

    /**
     * パス配列からASCIIサブツリーを生成する（パート内構造の自己記述用）。
     * @returns {string}
     */
    function _buildSubtree(paths, maxDepth = 6, maxLines = SUBTREE_MAX_LINES) {
        const root = {};
        const sorted = paths.slice().sort();
        for (const rel of sorted) {
            const parts = rel.split('/');
            let curr = root;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isFile = (i === parts.length - 1);
                if (!curr[part]) curr[part] = isFile ? null : {};
                if (!isFile) curr = curr[part];
            }
        }
        const lines = [];
        let truncated = false;
        (function formatTree(node, prefix, depth) {
            if (truncated) return;
            if (depth > maxDepth) {
                lines.push(prefix + '└── ... (deeper levels omitted)');
                return;
            }
            const keys = Object.keys(node).sort((a, b) => {
                const aIsDir = node[a] !== null;
                const bIsDir = node[b] !== null;
                if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                return a.localeCompare(b);
            });
            for (let i = 0; i < keys.length; i++) {
                if (lines.length >= maxLines) { truncated = true; return; }
                const key = keys[i];
                const isLast = (i === keys.length - 1);
                const isDir = node[key] !== null;
                lines.push(prefix + (isLast ? '└── ' : '├── ') + key + (isDir ? '/' : ''));
                if (isDir) formatTree(node[key], prefix + (isLast ? '    ' : '│   '), depth + 1);
            }
        })(root, '', 1);
        if (truncated) lines.push(`... (${sorted.length} paths total, truncated to ${maxLines} lines)`);
        return lines.join('\n');
    }

    // =====================================================================
    //  VcxprojParser — Parse .vcxproj and .vcxproj.filters XML
    // =====================================================================

    const VcxprojParser = {
        parseProject(xmlText, projPath) {
            const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            const ns = 'http://schemas.microsoft.com/developer/msbuild/2003';

            const info = {
                path: projPath,
                name: projPath.split('/').pop().replace(/\.vcxproj$/i, ''),
                configurations: [],
                defines: [],
                includeDirs: [],
                sourceFiles: [],      // ClCompile
                headerFiles: [],      // ClInclude
                resourceFiles: [],    // ResourceCompile
                otherFiles: [],       // None, etc.
                filterMap: {}         // fullPath -> filter path
            };

            // Extract configurations
            const configNodes = doc.querySelectorAll('ProjectConfiguration');
            if (configNodes.length === 0) {
                const pgNodes = doc.getElementsByTagNameNS(ns, 'ProjectConfiguration');
                for (const n of pgNodes) {
                    info.configurations.push(n.getAttribute('Include') || n.textContent.trim());
                }
            } else {
                configNodes.forEach(n => {
                    info.configurations.push(n.getAttribute('Include') || n.textContent.trim());
                });
            }

            const getText = (parent, tag) => {
                let el = parent.querySelector(tag);
                if (!el) el = parent.getElementsByTagNameNS(ns, tag)[0];
                return el ? el.textContent.trim() : '';
            };

            const defGroups = [...doc.querySelectorAll('ItemDefinitionGroup'),
                ...doc.getElementsByTagNameNS(ns, 'ItemDefinitionGroup')];
            for (const g of defGroups) {
                const defs = getText(g, 'PreprocessorDefinitions');
                if (defs) {
                    defs.split(';').forEach(d => {
                        const t = d.trim();
                        if (t && t !== '%(PreprocessorDefinitions)' && !info.defines.includes(t))
                            info.defines.push(t);
                    });
                }
                const incDirs = getText(g, 'AdditionalIncludeDirectories');
                if (incDirs) {
                    incDirs.split(';').forEach(d => {
                        const t = d.trim();
                        if (t && t !== '%(AdditionalIncludeDirectories)' && !info.includeDirs.includes(t))
                            info.includeDirs.push(t);
                    });
                }
            }

            const collectItems = (tag, arr) => {
                const nodes = [...doc.querySelectorAll(tag),
                    ...doc.getElementsByTagNameNS(ns, tag)];
                const seen = new Set();
                for (const n of nodes) {
                    const inc = n.getAttribute('Include');
                    if (inc && !seen.has(inc)) {
                        seen.add(inc);
                        arr.push(inc.replace(/\\/g, '/'));
                    }
                }
            };
            collectItems('ClCompile', info.sourceFiles);
            collectItems('ClInclude', info.headerFiles);
            collectItems('ResourceCompile', info.resourceFiles);
            collectItems('None', info.otherFiles);

            return info;
        },

        parseFilters(xmlText) {
            const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            const ns = 'http://schemas.microsoft.com/developer/msbuild/2003';
            const map = {};
            const tags = ['ClCompile', 'ClInclude', 'ResourceCompile', 'None'];
            for (const tag of tags) {
                const nodes = [...doc.querySelectorAll(tag),
                    ...doc.getElementsByTagNameNS(ns, tag)];
                for (const n of nodes) {
                    const inc = n.getAttribute('Include');
                    if (!inc) continue;
                    const path = inc.replace(/\\/g, '/');
                    let filterEl = n.querySelector('Filter');
                    if (!filterEl) {
                        const children = n.getElementsByTagNameNS(ns, 'Filter');
                        if (children.length) filterEl = children[0];
                    }
                    if (filterEl) {
                        map[path] = filterEl.textContent.trim().replace(/\\/g, '/');
                    }
                }
            }
            return map;
        }
    };

    // =====================================================================
    //  SourceConsolidator — Merge source files into OKF Markdown parts
    // =====================================================================

    const SourceConsolidator = {

        /**
         * Consolidate files into OKF-compliant Markdown / Text files.
         * 2フェーズ構成: (1) I/Oなし事前割付で totalParts を確定
         * (2) パート単位ストリーミング生成（完了パートは即Blob化し文字列を破棄）。
         * 1000万行級でも同時保持は「1パート分+結果Blob群」に抑えられる。
         * @param {object} opts
         * @param {Array} opts.fileItems
         * @param {Array} opts.projects
         * @param {string} opts.mode - 'vcxproj' | 'folder_structure'
         * @param {string} opts.ext - '.md' | '.txt'
         * @param {number} opts.maxPartSize - bytes (0 or Infinity for unsplit)
         * @param {number} opts.maxFilesPerPart - files (0 or Infinity for unlimited)
         * @param {number} opts.maxSingleFileSize
         * @param {Function} opts.onProgress
         * @returns {Promise<{results: Array<{filename: string, blob: Blob}>, partFileList: Array}>}
         */
        async consolidate({ fileItems, projects, mode = 'folder_structure', ext = '.md', maxPartSize, maxFilesPerPart, maxSingleFileSize, onProgress }) {
            const encoder = new TextEncoder();
            const effectivePartSize = (maxPartSize && maxPartSize > 0) ? maxPartSize : Infinity;
            const effectiveMaxFiles = (maxFilesPerPart && maxFilesPerPart > 0) ? maxFilesPerPart : Infinity;

            // Oversized pre-filter（scan時の size 判明分を先に除外。実測フォールバックあり）
            const targets = (maxSingleFileSize && maxSingleFileSize > 0)
                ? fileItems.filter(item => !(item.size > maxSingleFileSize))
                : fileItems.slice();

            // Phase 1: 事前割付（totalParts 確定）
            const groups = assignParts(targets, effectivePartSize, effectiveMaxFiles);
            const totalParts = Math.max(groups.length, 1);
            const rootName = State.currentRootEntries.length === 1
                ? State.currentRootEntries[0].name : 'project';
            const cleanExt = ext.startsWith('.') ? ext : '.' + ext;
            const entryPoints = _detectEntryPoints(targets);

            const results = [];
            const partFileList = [];
            let done = 0;

            // Phase 2: パート単位ストリーミング
            for (let p = 0; p < groups.length; p++) {
                const partNum = p + 1;
                const lines = [];
                const partFiles = [];

                for (const idx of groups[p]) {
                    const item = targets[idx];
                    if (onProgress && done % 50 === 0) {
                        onProgress(done, targets.length);
                        await new Promise(r => setTimeout(r, 0));
                    }
                    done++;

                    let content;
                    try {
                        const file = await readEntryFile(item.entry);
                        if (maxSingleFileSize && file.size > maxSingleFileSize) continue; // 実測フォールバック
                        const buf = await file.arrayBuffer();
                        content = this._decodeToUtf8(new Uint8Array(buf));
                    } catch {
                        continue;
                    }

                    const fileBlock = this._buildOKFFileBlock(item, content);
                    lines.push(fileBlock);
                    partFiles.push({
                        path: item.relativePath,
                        project: item.projectName || '',
                        filter: item.filter || '',
                        size: content.length,
                        globalIndex: idx + 1
                    });
                }

                // 空パート（全件スキップ時）は出力しない
                if (!lines.length) continue;
                partFileList.push(partFiles);

                const body = lines.join('');
                const frontmatter = this._buildOKFFrontmatter({
                    rootName,
                    partNum,
                    totalParts,
                    fileCount: partFiles.length,
                    totalSizeBytes: encoder.encode(body).length,
                    mode,
                    entryPoints
                });
                const header = this._buildOKFHeader({
                    rootName,
                    partNum,
                    totalParts,
                    mode,
                    projects,
                    totalFiles: targets.length,
                    currentPartFiles: partFiles,
                    partGroups: groups.map(g => g.map(i => targets[i].relativePath))
                });
                const fullText = frontmatter + header + body;
                // 即Blob化して文字列を破棄（ピークメモリ抑制）
                results.push({
                    filename: `${rootName}_src_${String(partNum).padStart(3, '0')}_of_${String(totalParts).padStart(3, '0')}${cleanExt}`,
                    blob: bomTextBlob(fullText, 'text/markdown;charset=utf-8')
                });
            }

            if (onProgress) onProgress(targets.length, targets.length);
            return { results, partFileList };
        },

        // --- OKF Format Building Helpers ---

        _buildOKFFrontmatter({ rootName, partNum, totalParts, fileCount, totalSizeBytes, mode, entryPoints }) {
            const lines = [
                '---',
                'type: codebase_export',
                'format_version: "1.0-okf"',
                `title: "${rootName} Source Code Export (Part ${partNum}/${totalParts})"`,
                'description: "Consolidated codebase export formatted for LLM agents"',
                `export_mode: "${mode}"`,
                `part_number: ${partNum}`,
                `total_parts: ${totalParts}`,
                `file_count: ${fileCount}`,
                `total_size_bytes: ${totalSizeBytes}`,
                `generated_at: "${new Date().toISOString()}"`
            ];
            if (entryPoints && entryPoints.length > 0) {
                lines.push('entry_points:');
                for (const ep of entryPoints) {
                    lines.push(`  - "${ep}"`);
                }
            }
            lines.push('---', '');
            return lines.join('\n');
        },

        _buildOKFHeader({ rootName, partNum, totalParts, mode, projects, totalFiles, currentPartFiles, partGroups }) {
            const lines = [];
            lines.push(`# Project Overview & Structure`);
            lines.push(`- **Root Workspace**: \`${rootName}\``);
            lines.push(`- **Export Mode**: \`${mode === 'vcxproj' ? 'Visual Studio (vcxproj)' : 'Folder Structure'}\``);
            lines.push(`- **Total Project Files**: ${totalFiles} | **Files in Part ${partNum}/${totalParts}**: ${currentPartFiles.length}`);
            lines.push(`- **Note**: See \`index.md\` (or \`index_001_of_N.md\`) for complete directory structure, all files index, and part mapping.\n`);

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
                lines.push(`| ${f.globalIndex} | \`${f.path}\`${projTag} | ${formatBytes(f.size)} |`);
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

        _buildOKFFileBlock(item, content) {
            const lang = _detectLanguage(item.relativePath);
            const folderPath = dirnameOf(item.relativePath);
            const metaLines = [
                `path: "${item.relativePath}"`,
                `folder: "${folderPath}"`
            ];
            if (item.projectName) metaLines.push(`project: "${item.projectName}"`);
            if (item.filter) metaLines.push(`filter: "${item.filter}"`);
            metaLines.push(`extension: "${_getExtension(item.relativePath)}"`);
            metaLines.push(`size_bytes: ${item.size}`);

            return [
                `## File: \`${item.relativePath}\``,
                '',
                '```yaml',
                metaLines.join('\n'),
                '```',
                '',
                `\`\`\`${lang}`,
                content,
                '```',
                '',
                ''
            ].join('\n');
        },

        _decodeToUtf8(uint8) {
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
        }, { excludeDots: State.appSettings.excludeDots });

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
            }
        }

        const fileItems = [];
        const allFilesInfo = [];  // All files including binaries (for index.md)
        let totalSizeBytes = 0;
        const isSingleRoot = roots.length === 1 && roots[0].isDirectory;
        const rootPrefix = isSingleRoot ? roots[0].fullPath : '';
        // ツールバーのGlobフィルタを尊重する（空なら全件）
        const globMatcher = Glob.createMatcher(State.searchQuery);
        const activeFilterLabel = State.searchQuery && State.searchQuery.trim()
            ? `Glob: ${State.searchQuery.trim()}`
            : null;

        for (const entry of allFileEntries) {
            const ext = _getExtension(entry.name);

            const relativePath = rootPrefix
                ? entry.fullPath.replace(rootPrefix + '/', '').replace(rootPrefix, '')
                : entry.fullPath.replace(/^\//, '');

            if (globMatcher && !globMatcher(entry.name, relativePath)) continue;

            const isSourceTarget = config.sourceExtensions.has(ext);

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
                isExportTarget: isSourceTarget
            });

            if (!isSourceTarget) continue;

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

        return { projects, fileItems, allFilesInfo, totalSizeBytes, activeFilterLabel };
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
     * @param {string} options.ext - '.md' | '.txt'
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

        const { projects, fileItems: allItems, allFilesInfo } = await scanProjects();

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

        // Sort file items depending on mode
        if (mode === 'vcxproj') {
            fileItems.sort((a, b) => {
                if (a.projectName !== b.projectName) return (a.projectName || 'Z').localeCompare(b.projectName || 'Z');
                return a.relativePath.localeCompare(b.relativePath);
            });
        } else {
            fileItems.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        }

        Status.show(`Consolidating ${fileItems.length.toLocaleString()} files (OKF Markdown)...`, true);

        const { results, partFileList } = await SourceConsolidator.consolidate({
            fileItems,
            projects: targetProjects,
            mode,
            ext,
            maxPartSize: maxPartSizeBytes,
            maxFilesPerPart: effectiveMaxFiles,
            maxSingleFileSize: config.maxSingleFileSizeBytes,
            onProgress(done, total) {
                Status.show(`Processing files... (${done.toLocaleString()} / ${total.toLocaleString()})`, true);
            }
        });

        if (!results.length) {
            Status.error('No source files to export (all skipped or empty).');
            return;
        }

        // Generate index file(s) — sharded when exceeding the part-size limit
        Status.show('Generating index...', true);
        const rootName = roots.length === 1 ? roots[0].name : 'project';
        const indexFiles = _generateIndexMd({
            rootName, mode, ext, allFilesInfo, fileItems,
            results, partFileList, projects: targetProjects,
            maxIndexBytes: maxPartSizeBytes
        });

        // Generate CSV files based on mode
        const targetFilesCsvBlob = _generateTargetFilesCsv(fileItems);
        let secondaryCsvBlob = null;
        let secondaryCsvName = '';

        if (mode === 'vcxproj') {
            secondaryCsvBlob = _generateVcxprojCsv(targetProjects);
            secondaryCsvName = 'vcxproj_list.csv';
        } else {
            secondaryCsvBlob = _generateFolderStructureCsv(fileItems);
            secondaryCsvName = 'folder_structure.csv';
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
            zip.file(secondaryCsvName, secondaryCsvBlob);
            zip.file('target_files_list.csv', targetFilesCsvBlob);

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(zipBlob, `${rootName}_llm_export.zip`);
            Status.show(`Exported ZIP: ${indexFiles.length} index file(s) + ${results.length} part(s) + 2 CSVs (${formatBytes(zipBlob.size)})`);
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
            downloadBlob(secondaryCsvBlob, secondaryCsvName);
            await new Promise(res => setTimeout(res, 300));
            downloadBlob(targetFilesCsvBlob, 'target_files_list.csv');
            Status.show(`Exported ${results.length + indexFiles.length + 2} files individually`);
        }
    }

    // =====================================================================
    //  CSV Generators
    // =====================================================================

    function _generateVcxprojCsv(projects) {
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
        ]);

        const csvText = [headers.join(','), ...rows.map(r => r.join(','))].join('\n') + '\n';
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    function _generateFolderStructureCsv(fileItems) {
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
        ]);

        const csvText = [headers.join(','), ...rows.map(r => r.join(','))].join('\n') + '\n';
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    function _generateTargetFilesCsv(fileItems) {
        const headers = ['File Path', 'Project Name', 'Filter Path', 'Size (Bytes)', 'Extension'];
        const escape = csvEscape;

        const rows = fileItems.map(item => [
            escape(item.relativePath),
            escape(item.projectName || ''),
            escape(item.filter || ''),
            item.size || 0,
            escape(_getExtension(item.relativePath))
        ]);

        const csvText = [headers.join(','), ...rows.map(r => r.join(','))].join('\n') + '\n';
        return bomTextBlob(csvText, 'text/csv;charset=utf-8;');
    }

    // =====================================================================
    //  index.md Generator — OKF Codebase Index for LLM
    // =====================================================================

    /**
     * Generate OKF-compliant index file(s) — master table of contents.
     * All-Filesテーブルが上限を超える場合は `index.md` + `index_files_*` に分割する。
     * @returns {Array<{filename: string, blob: Blob}>}（単一時は [{filename:'index.md', blob}]）
     */
    function _generateIndexMd({ rootName, mode, ext, allFilesInfo, fileItems, results, partFileList, projects, maxIndexBytes }) {
        const encoder = new TextEncoder();
        const limit = (maxIndexBytes && maxIndexBytes > 0) ? maxIndexBytes : Infinity;
        const totalFiles = allFilesInfo.length;
        const exportedFiles = allFilesInfo.filter(f => f.isExportTarget).length;
        const binaryFiles = totalFiles - exportedFiles;
        const totalSizeBytes = allFilesInfo.reduce((sum, f) => sum + f.size, 0);
        const exportedSizeBytes = fileItems.reduce((sum, f) => sum + f.size, 0);
        const totalParts = results.length;
        const cleanExt = ext.startsWith('.') ? ext : '.' + ext;

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

        // Build file-to-part mapping
        const filePartMap = new Map();
        if (partFileList) {
            for (let i = 0; i < partFileList.length; i++) {
                for (const f of partFileList[i]) {
                    filePartMap.set(f.path, i + 1);
                }
            }
        }

        // --- OKF YAML Frontmatter ---
        const lines = [
            '---',
            'type: codebase_index',
            'format_version: "1.0-okf"',
            `title: "${rootName} — Codebase Index"`,
            'description: "Complete directory and file index for LLM codebase analysis. Load this file first for structural context."',
            `export_mode: "${mode}"`,
            `total_files: ${totalFiles}`,
            `total_directories: ${dirStats.size}`,
            `total_size_bytes: ${totalSizeBytes}`,
            `exported_text_files: ${exportedFiles}`,
            `non_exported_files: ${binaryFiles}`,
            `export_parts: ${totalParts}`,
            `generated_at: "${new Date().toISOString()}"`,
            '---',
            ''
        ];

        // --- Summary ---
        lines.push(`# ${rootName} — Codebase Index`);
        lines.push('');
        lines.push('> **Load this file first.** It provides the complete structural overview of the exported codebase.');
        lines.push('> Other exported part files (`*_src_*${cleanExt}`) contain the actual source code.');
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
                const num = String(i + 1).padStart(3, '0');
                const totalNum = String(totalParts).padStart(3, '0');
                const filename = `${rootName}_src_${num}_of_${totalNum}${cleanExt}`;

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

                lines.push(`| ${i + 1} | \`${filename}\` | ${pFiles.length} | ${topDirs} |`);
            }
            lines.push('');
        }

        // --- Full File List（上限超過時はシャード分割） ---
        const allRows = [];
        for (let i = 0; i < allFilesInfo.length; i++) {
            const f = allFilesInfo[i];
            const type = f.isExportTarget ? 'text' : 'binary';
            const part = filePartMap.get(f.relativePath);
            const partStr = part ? String(part) : '—';
            allRows.push(`| ${i + 1} | \`${f.relativePath}\` | ${formatBytes(f.size)} | ${type} | ${partStr} |`);
        }

        const headText = lines.join('\n') + '\n';
        const headBytes = encoder.encode(headText).length;
        const tableHead = ['## All Files', '', '| # | Path | Size | Type | Part |', '|---|---|---|---|---|'];
        const tableHeadText = tableHead.join('\n') + '\n';
        const tableHeadBytes = encoder.encode(tableHeadText).length;

        // 行単位でシャード割付
        const shards = [];
        let cur = [];
        let curBytes = headBytes + tableHeadBytes;
        for (const row of allRows) {
            const rb = encoder.encode(row + '\n').length;
            if (cur.length > 0 && curBytes + rb > limit) {
                shards.push(cur);
                cur = [];
                curBytes = tableHeadBytes;
            }
            cur.push(row);
            curBytes += rb;
        }
        if (cur.length || shards.length === 0) shards.push(cur);

        let masterHeadText = headText;
        if (shards.length > 1) {
            masterHeadText = headText.replace('| Export Parts |',
                `| Index Shard Files | ${shards.length} file(s) (\`index.md\` + \`index_files_*\`) |\n| Export Parts |`);
        }

        const indexFiles = shards.map((rows, si) => {
            const shardNum = si + 1;
            if (shards.length === 1) {
                return { filename: 'index.md', blob: bomTextBlob(masterHeadText + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
            }
            if (si === 0) {
                return { filename: 'index.md', blob: bomTextBlob(masterHeadText + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
            }
            const shardHead = [
                '---',
                'type: codebase_index_shard',
                'format_version: "1.0-okf"',
                `title: "${rootName} — Codebase Index (Files ${shardNum}/${shards.length})"`,
                `index_of: "index.md"`,
                `shard_number: ${shardNum}`,
                `total_shards: ${shards.length}`,
                `generated_at: "${new Date().toISOString()}"`,
                '---',
                '',
                `# ${rootName} — Codebase Index (Files Shard ${shardNum}/${shards.length})`,
                '',
                '> Continuation of the All Files table. Load `index.md` first for structural context.',
                '',
            ].join('\n') + '\n';
            const num = String(shardNum).padStart(3, '0');
            const totalNum = String(shards.length).padStart(3, '0');
            return { filename: `index_files_${num}_of_${totalNum}.md`, blob: bomTextBlob(shardHead + tableHeadText + rows.join('\n') + '\n', 'text/markdown;charset=utf-8') };
        });
        // index.md の Export Summary にシャード数を反映させる（単一時は従来通り）
        return indexFiles;
    }

    // =====================================================================
    //  Helper Functions
    // =====================================================================

    function _detectEntryPoints(fileItems) {
        const targets = new Set([
            'main.cpp', 'main.c', 'main.py', 'main.go', 'main.rs', 'main.js', 'main.ts',
            'index.js', 'index.ts', 'index.html', 'app.js', 'app.py', 'app.ts', 'server.js', 'server.ts',
            'cmakelists.txt', 'package.json', 'cargo.toml', 'go.mod', 'makefile', 'pyproject.toml',
            'requirements.txt', 'build.gradle', 'pom.xml'
        ]);
        const entryPoints = [];
        for (const item of fileItems) {
            const name = item.relativePath.split('/').pop().toLowerCase();
            if (targets.has(name) || name.endsWith('.vcxproj') || name.endsWith('.sln')) {
                entryPoints.push(item.relativePath);
            }
        }
        return entryPoints.slice(0, 15);
    }

    function _detectLanguage(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const map = {
            'cpp': 'cpp', 'c': 'c', 'cc': 'cpp', 'cxx': 'cpp', 'h': 'cpp', 'hpp': 'cpp', 'hxx': 'cpp', 'inl': 'cpp',
            'cs': 'csharp', 'java': 'java', 'py': 'python', 'js': 'javascript', 'ts': 'typescript',
            'jsx': 'javascript', 'tsx': 'typescript', 'xml': 'xml', 'xaml': 'xml', 'json': 'json',
            'yml': 'yaml', 'yaml': 'yaml', 'sql': 'sql', 'proto': 'protobuf', 'thrift': 'thrift',
            'hlsl': 'hlsl', 'glsl': 'glsl', 'fx': 'hlsl', 'cmake': 'cmake', 'mk': 'makefile', 'mak': 'makefile',
            'bat': 'bat', 'cmd': 'bat', 'sh': 'bash', 'ps1': 'powershell', 'txt': 'plaintext', 'md': 'markdown',
            'rst': 'rst', 'cfg': 'ini', 'ini': 'ini', 'conf': 'ini', 'toml': 'toml',
            'sln': 'plaintext', 'vcxproj': 'xml', 'csproj': 'xml', 'props': 'xml', 'targets': 'xml'
        };
        return map[ext] || 'text';
    }

    function getExportConfig() {
        // 旧キー notebookLMConfig からの移行に対応
        const saved = State.appSettings.llmExportConfig || State.appSettings.notebookLMConfig || {};
        const maxFilesRaw = saved.maxFilesPerPart;
        return {
            mode: saved.mode || DEFAULT_CONFIG.mode,
            ext: saved.ext || DEFAULT_CONFIG.ext,
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
            chunkSize: DEFAULT_CONFIG.chunkSize
        };
    }

    function getDefaultExtensionsString() {
        return [...DEFAULT_CONFIG.sourceExtensions].join(', ');
    }

    // 照合用正規化は core の共有ヘルパーを使用する。

    function _getExtension(name) {
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(idx).toLowerCase() : '';
    }

    function _fuzzyMatchProject(entry, projectFileMap) {
        const name = entry.name.toLowerCase();
        for (const [path, ref] of projectFileMap) {
            if (path.endsWith('/' + name) || path === name) {
                return ref;
            }
        }
        return null;
    }

    // Export Public API
    FileFlow.llmExport = {
        scanProjects,
        showVcxprojPreviewModal,
        exportForLLM,
        getExportConfig,
        getDefaultExtensionsString,
        VcxprojParser,
        SourceConsolidator,
        DEFAULT_CONFIG,
        // テスト用の内部公開（仕様外）
        _internals: { getExtension: _getExtension, detectLanguage: _detectLanguage, fuzzyMatchProject: _fuzzyMatchProject, detectEntryPoints: _detectEntryPoints,
            generateTargetFilesCsv: _generateTargetFilesCsv, generateFolderStructureCsv: _generateFolderStructureCsv, generateVcxprojCsv: _generateVcxprojCsv,
            generateIndexMd: _generateIndexMd, assignParts, buildSubtree: _buildSubtree }
    };
    // 旧名前空間の後方互換エイリアス（移行期間のみ）
    FileFlow.notebookLM = FileFlow.llmExport;
})();
