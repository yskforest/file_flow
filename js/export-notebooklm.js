// FileFlow — NotebookLM Export Module
(function () {
    const { $, formatBytes, FS, Detect, downloadBlob } = FileFlow.utils;
    const State = FileFlow.state;
    const Status = FileFlow.ui.Status;

    // =====================================================================
    //  Default Configuration
    // =====================================================================

    const DEFAULT_CONFIG = {
        maxPartSizeBytes: 4 * 1024 * 1024,       // 4MB per output file
        maxSingleFileSizeBytes: 1 * 1024 * 1024,  // Skip files > 1MB
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

    // =====================================================================
    //  VcxprojParser — Parse .vcxproj and .vcxproj.filters XML
    // =====================================================================

    const VcxprojParser = {
        /**
         * Parse a vcxproj file content and return build unit info.
         * @param {string} xmlText - Raw XML content
         * @param {string} projPath - Relative path of the vcxproj file
         * @returns {object} Parsed project info
         */
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
                // Try with namespace
                const pgNodes = doc.getElementsByTagNameNS(ns, 'ProjectConfiguration');
                for (const n of pgNodes) {
                    info.configurations.push(n.getAttribute('Include') || n.textContent.trim());
                }
            } else {
                configNodes.forEach(n => {
                    info.configurations.push(n.getAttribute('Include') || n.textContent.trim());
                });
            }

            // Helper: get text of first matching element
            const getText = (parent, tag) => {
                let el = parent.querySelector(tag);
                if (!el) el = parent.getElementsByTagNameNS(ns, tag)[0];
                return el ? el.textContent.trim() : '';
            };

            // Extract defines and include dirs from PropertyGroup/ItemDefinitionGroup
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

            // Collect file items
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

        /**
         * Parse a .vcxproj.filters file and return filter mappings.
         * @param {string} xmlText
         * @returns {object} { relativePath: filterString }
         */
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
    //  SourceConsolidator — Merge source files into parts (≤4MB each)
    // =====================================================================

    const SourceConsolidator = {

        /**
         * Main entry: consolidate all files into part strings.
         * @param {object} opts
         * @param {Array} opts.fileItems - [{entry, relativePath, projectName, filter, encoding}]
         * @param {Array} opts.projects - parsed vcxproj info objects
         * @param {number} opts.maxPartSize - max bytes per part
         * @param {number} opts.maxSingleFileSize - skip files larger than this
         * @param {Function} opts.onProgress - progress callback (processed, total)
         * @returns {Promise<Array<{filename: string, blob: Blob}>>}
         */
        async consolidate({ fileItems, projects, maxPartSize, maxSingleFileSize, onProgress }) {
            const encoder = new TextEncoder();
            const parts = [];
            let currentLines = [];
            let currentSize = 0;
            let partIndex = 1;
            const partFileList = [];     // tracks files per part for index
            let currentPartFiles = [];

            // Generate project summary header (compact, token-efficient)
            const projectSummary = this._buildProjectSummary(projects, fileItems.length);

            // Process files
            for (let i = 0; i < fileItems.length; i++) {
                const item = fileItems[i];

                if (onProgress && i % 100 === 0) {
                    onProgress(i, fileItems.length);
                    await new Promise(r => setTimeout(r, 0));
                }

                let content;
                try {
                    const file = await new Promise((res, rej) => item.entry.file(res, rej));
                    if (file.size > (maxSingleFileSize || maxPartSize)) continue; // Skip oversized files
                    const buf = await file.arrayBuffer();
                    content = this._decodeToUtf8(new Uint8Array(buf));
                } catch {
                    continue;
                }

                // Build compact file block
                const fileBlock = this._buildFileBlock(item, content);
                const blockBytes = encoder.encode(fileBlock).length;

                // Check if adding this block would exceed limit
                // Reserve space for index header (~2KB)
                const reserved = currentLines.length === 0 ? 2048 : 0;
                if (currentSize + blockBytes + reserved > maxPartSize && currentLines.length > 0) {
                    // Finalize current part
                    partFileList.push([...currentPartFiles]);
                    parts.push({ lines: currentLines, size: currentSize });
                    currentLines = [];
                    currentSize = 0;
                    currentPartFiles = [];
                    partIndex++;
                }

                currentLines.push(fileBlock);
                currentSize += blockBytes;
                currentPartFiles.push({
                    path: item.relativePath,
                    project: item.projectName || '',
                    filter: item.filter || '',
                    size: content.length
                });
            }

            // Push final part
            if (currentLines.length > 0) {
                partFileList.push([...currentPartFiles]);
                parts.push({ lines: currentLines, size: currentSize });
            }

            if (onProgress) onProgress(fileItems.length, fileItems.length);

            // Build final blobs with index headers
            const totalParts = parts.length;
            const results = [];
            const rootName = State.currentRootEntries.length === 1
                ? State.currentRootEntries[0].name : 'project';

            for (let p = 0; p < parts.length; p++) {
                const index = this._buildPartIndex(p + 1, totalParts, partFileList[p], projectSummary, p === 0);
                const body = parts[p].lines.join('');
                const fullText = index + body;
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), fullText], { type: 'text/plain;charset=utf-8' });
                const num = String(p + 1).padStart(3, '0');
                results.push({
                    filename: `${rootName}_src_${num}_of_${String(totalParts).padStart(3, '0')}.txt`,
                    blob
                });
            }

            return results;
        },

        // --- Private helpers ---

        _buildProjectSummary(projects, totalFiles) {
            if (!projects.length) return '';
            const lines = ['# Build Units (vcxproj)\n'];
            for (const p of projects) {
                lines.push(`## ${p.name} (${p.path})`);
                if (p.configurations.length)
                    lines.push(`  Config: ${p.configurations.join(', ')}`);
                if (p.defines.length)
                    lines.push(`  Defines: ${p.defines.slice(0, 20).join(';')}${p.defines.length > 20 ? '...' : ''}`);
                if (p.includeDirs.length)
                    lines.push(`  IncludeDirs: ${p.includeDirs.slice(0, 10).join(';')}${p.includeDirs.length > 10 ? '...' : ''}`);
                lines.push(`  Sources: ${p.sourceFiles.length} | Headers: ${p.headerFiles.length} | Resources: ${p.resourceFiles.length}`);
                lines.push('');
            }
            return lines.join('\n');
        },

        _buildPartIndex(partNum, totalParts, fileList, projectSummary, isFirstPart) {
            const lines = [];
            lines.push(`# Source Code Export — Part ${partNum}/${totalParts}`);
            lines.push(`# Files in this part: ${fileList.length}\n`);

            // Include project summary only in part 1
            if (isFirstPart && projectSummary) {
                lines.push(projectSummary);
            }

            // Compact file listing
            lines.push('# File Index');
            for (let i = 0; i < fileList.length; i++) {
                const f = fileList[i];
                const proj = f.project ? ` [${f.project}]` : '';
                const flt = f.filter ? ` (${f.filter})` : '';
                lines.push(`#  ${i + 1}. ${f.path}${proj}${flt}`);
            }
            lines.push('\n');

            return lines.join('\n');
        },

        _buildFileBlock(item, content) {
            // Compact, token-efficient format:
            // --- path/to/file.cpp [ProjectName | Filter/Path] ---
            // <content>
            //
            const meta = [];
            if (item.projectName) meta.push(item.projectName);
            if (item.filter) meta.push(item.filter);
            const metaStr = meta.length ? ` [${meta.join(' | ')}]` : '';

            return `--- ${item.relativePath}${metaStr} ---\n${content}\n\n`;
        },

        _decodeToUtf8(uint8) {
            // Try UTF-8 first
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
                // Strip BOM if present
                return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
            } catch { /* not UTF-8 */ }

            // Try Shift_JIS
            try {
                return new TextDecoder('shift_jis', { fatal: true }).decode(uint8);
            } catch { /* not Shift_JIS */ }

            // Try EUC-JP
            try {
                return new TextDecoder('euc-jp', { fatal: true }).decode(uint8);
            } catch { /* not EUC-JP */ }

            // Try UTF-16 LE / BE
            if (uint8.length >= 2) {
                if (uint8[0] === 0xFF && uint8[1] === 0xFE) {
                    try { return new TextDecoder('utf-16le').decode(uint8); } catch { }
                }
                if (uint8[0] === 0xFE && uint8[1] === 0xFF) {
                    try { return new TextDecoder('utf-16be').decode(uint8); } catch { }
                }
            }

            // Fallback: lossy UTF-8
            return new TextDecoder('utf-8', { fatal: false }).decode(uint8);
        }
    };

    // =====================================================================
    //  Export Orchestrator — Scans, parses vcxproj, consolidates, downloads
    // =====================================================================

    async function exportForNotebookLM() {
        const roots = State.currentRootEntries;
        if (!roots.length) {
            Status.error('No files loaded. Drop a folder first.');
            return;
        }

        const config = getExportConfig();
        Status.show('Scanning for vcxproj files...', true);
        await new Promise(r => setTimeout(r, 50));

        // 1. Scan for .vcxproj and .vcxproj.filters
        const vcxprojEntries = [];
        const filterEntries = [];
        const allFileEntries = [];    // {entry, relativePath}

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

        // 2. Parse vcxproj files
        Status.show(`Parsing ${vcxprojEntries.length} vcxproj file(s)...`, true);
        await new Promise(r => setTimeout(r, 0));

        const projects = [];
        const projectFileMap = new Map();  // normalized path -> project info

        for (const entry of vcxprojEntries) {
            try {
                const file = await new Promise((res, rej) => entry.file(res, rej));
                const text = await file.text();
                const projInfo = VcxprojParser.parseProject(text, entry.fullPath);

                // Parse corresponding .filters file
                const filterName = entry.name + '.filters';
                const filterEntry = filterEntries.find(f => f.name === filterName &&
                    f.fullPath.replace(f.name, '') === entry.fullPath.replace(entry.name, ''));
                if (filterEntry) {
                    try {
                        const filterFile = await new Promise((res, rej) => filterEntry.file(res, rej));
                        const filterText = await filterFile.text();
                        projInfo.filterMap = VcxprojParser.parseFilters(filterText);
                    } catch { /* no filters */ }
                }

                projects.push(projInfo);

                // Map each referenced file to its project
                const projDir = entry.fullPath.replace(/\/[^/]+$/, '');
                const allRefs = [
                    ...projInfo.sourceFiles,
                    ...projInfo.headerFiles,
                    ...projInfo.resourceFiles,
                    ...projInfo.otherFiles
                ];
                for (const ref of allRefs) {
                    const normalized = _normalizePath(projDir + '/' + ref);
                    projectFileMap.set(normalized, {
                        projectName: projInfo.name,
                        filter: projInfo.filterMap[ref.replace(/\\/g, '/')] || ''
                    });
                }
            } catch (e) {
                console.warn('Failed to parse vcxproj:', entry.fullPath, e);
            }
        }

        // 3. Collect target source files
        Status.show('Collecting source files...', true);
        await new Promise(r => setTimeout(r, 0));

        const fileItems = [];
        const isSingleRoot = roots.length === 1 && roots[0].isDirectory;
        const rootPrefix = isSingleRoot ? roots[0].fullPath : '';

        for (const entry of allFileEntries) {
            const ext = _getExtension(entry.name);
            if (!config.sourceExtensions.has(ext)) continue;

            const relativePath = rootPrefix
                ? entry.fullPath.replace(rootPrefix + '/', '').replace(rootPrefix, '')
                : entry.fullPath.replace(/^\//, '');

            // Lookup project membership
            const normalizedPath = _normalizePath(entry.fullPath);
            const projRef = projectFileMap.get(normalizedPath) || _fuzzyMatchProject(entry, projectFileMap);

            fileItems.push({
                entry,
                relativePath,
                projectName: projRef?.projectName || '',
                filter: projRef?.filter || ''
            });
        }

        if (!fileItems.length) {
            Status.error('No source files found matching the configured extensions.');
            return;
        }

        // Sort: group by project, then by path
        fileItems.sort((a, b) => {
            if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName);
            return a.relativePath.localeCompare(b.relativePath);
        });

        // 4. Consolidate into parts
        Status.show(`Consolidating ${fileItems.length} files...`, true);

        const results = await SourceConsolidator.consolidate({
            fileItems,
            projects,
            maxPartSize: config.maxPartSizeBytes,
            maxSingleFileSize: config.maxSingleFileSizeBytes,
            onProgress(done, total) {
                Status.show(`Processing files... (${done.toLocaleString()} / ${total.toLocaleString()})`, true);
            }
        });

        // 5. Download
        if (results.length === 1) {
            // Single file — download directly
            downloadBlob(results[0].blob, results[0].filename);
            Status.show(`Exported: ${results[0].filename} (${formatBytes(results[0].blob.size)})`);
        } else {
            // Multiple files — pack into ZIP
            Status.show(`Creating ZIP with ${results.length} parts...`, true);
            try {
                const zip = new JSZip();
                for (const r of results) {
                    zip.file(r.filename, r.blob);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const rootName = roots.length === 1 ? roots[0].name : 'project';
                downloadBlob(zipBlob, `${rootName}_notebooklm_export.zip`);
                Status.show(`Exported ${results.length} parts as ZIP (${formatBytes(zipBlob.size)})`);
            } catch (e) {
                // Fallback: download individually
                console.warn('ZIP creation failed, downloading individually:', e);
                for (const r of results) {
                    downloadBlob(r.blob, r.filename);
                    await new Promise(res => setTimeout(res, 300));
                }
                Status.show(`Exported ${results.length} files individually`);
            }
        }
    }

    // =====================================================================
    //  Export Config Helpers
    // =====================================================================

    function getExportConfig() {
        const saved = State.appSettings.notebookLMConfig || {};
        return {
            maxPartSizeBytes: saved.maxPartSizeMB
                ? saved.maxPartSizeMB * 1024 * 1024
                : DEFAULT_CONFIG.maxPartSizeBytes,
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

    // =====================================================================
    //  Path Utilities
    // =====================================================================

    function _normalizePath(p) {
        // Collapse ../ and ./ , normalize slashes
        const parts = p.replace(/\\/g, '/').split('/');
        const stack = [];
        for (const seg of parts) {
            if (seg === '..') { stack.pop(); }
            else if (seg !== '.' && seg !== '') { stack.push(seg); }
        }
        return stack.join('/').toLowerCase();
    }

    function _getExtension(name) {
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(idx).toLowerCase() : '';
    }

    function _fuzzyMatchProject(entry, projectFileMap) {
        // Try matching by filename only (for files referenced with relative paths)
        const name = entry.name.toLowerCase();
        for (const [path, ref] of projectFileMap) {
            if (path.endsWith('/' + name) || path === name) {
                return ref;
            }
        }
        return null;
    }

    // =====================================================================
    //  Export Public API
    // =====================================================================

    FileFlow.notebookLM = {
        exportForNotebookLM,
        getExportConfig,
        getDefaultExtensionsString,
        VcxprojParser,
        SourceConsolidator,
        DEFAULT_CONFIG
    };
})();
