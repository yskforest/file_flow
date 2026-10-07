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
        ext: '.md',                              // OKF concept documents are Markdown
        maxPartSizeBytes: 4 * 1024 * 1024,       // 4MB per output file
        maxFilesPerPart: 1000,                   // max files per output part (0 = unlimited)
        maxSingleFileSizeBytes: 1 * 1024 * 1024,  // Skip files > 1MB by default
        excludePatterns: '**/node_modules/** **/dist/** **/build/** **/out/** **/target/** **/__pycache__/** **/.venv/** **/*.min.js **/*.min.css **/*.bundle.js',
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
    // チャンク分割時に確保するヘッダー予備バイト数
    const CHUNK_RESERVED_BYTES = 8192;
    // 出力1ファイルあたりの推定語数上限（入力先のカウントとの一致は保証しない）
    const MAX_OUTPUT_WORDS = 500000;
    // 割付時の単語数ターゲット（ヘッダ誤差分のマージンを確保）
    const OUTPUT_WORD_TARGET = 450000;
    // フロントマター+ヘッダ分の概算リザーブ（単語数）
    const OUTPUT_WORD_RESERVE = 20000;
    // 単一OKFブロックの単語数上限（ヘッダと同居させるための予算）
    const SINGLE_BLOCK_WORD_BUDGET = 350000;
    // index後続シャードのヘッダ概算（単語数）
    const INDEX_SHARD_HEAD_EST_WORDS = 200;

    /**
     * 本文を行単位でチャンク分割する（巨大単一ファイル対策）。
     * 各チャンクは指定バイト予算に収まる。予算内に収まらない1行は文字単位で切断する。
     * @returns {Array<string>}
     */
    function _splitContent(content, budgetBytes, encoder) {
        const enc = encoder || new TextEncoder();
        if (!Number.isFinite(budgetBytes)) return [content];
        const budget = Math.max(budgetBytes, 1024);
        if (enc.encode(content).length <= budget) return [content];
        // 改行込みセグメントで分割し、結合で完全復元できるようにする
        const segs = content.match(/[^\n]*\n|[^\n]+$/g) || [content];
        const chunks = [];
        let cur = '';
        let curBytes = 0;
        const flush = () => { if (cur) { chunks.push(cur); cur = ''; curBytes = 0; } };
        for (const seg of segs) {
            const sb = enc.encode(seg).length;
            if (sb > budget) {
                flush();
                // 長大1行は文字単位で切断（サロゲートペアを壊さないよう Array.from）
                let piece = '';
                let pieceBytes = 0;
                for (const ch of Array.from(seg)) {
                    const cb = enc.encode(ch).length;
                    if (pieceBytes + cb > budget && piece) {
                        chunks.push(piece);
                        piece = '';
                        pieceBytes = 0;
                    }
                    piece += ch;
                    pieceBytes += cb;
                }
                if (piece) chunks.push(piece);
                continue;
            }
            if (curBytes + sb > budget) flush();
            cur += seg;
            curBytes += sb;
        }
        flush();
        return chunks.length ? chunks : [content];
    }

    // CJK 文字の範囲（ひらがな・カタカナ・漢字・ハングル・全角英数など）
    const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯！-～]/g;

    /**
     * 単語数を数える。NotebookLM の 500,000 words 制限に対応するための推定値。
     * 空白区切りトークン数 + CJK文字数（日本語は分かち書きしないため1字=1語として保守的に加算）。
     * 英語コードでは空白トークン数が支配的、日本語ではCJK加算が支配的になる。
     * @returns {number}
     */
    function countWords(text) {
        if (!text) return 0;
        const value = String(text);
        let words = 0;
        CJK_RE.lastIndex = 0;
        while (CJK_RE.test(value)) words++;
        const tokens = /\S+/g;
        while (tokens.test(value)) words++;
        return words;
    }

    /**
     * 本文を単語数予算でチャンク分割する（巨大単一ファイル対策）。
     * 改行込みセグメント単位で分割し、結合で完全復元できる。
     * 予算内に収まらない1行は単語ラン単位で切断し、空白なし長大ラン（CJK等）は文字単位で切断する。
     * @returns {Array<string>}
     */
    function _splitContentByWords(content, budgetWords) {
        if (!Number.isFinite(budgetWords)) return [content];
        const budget = Math.max(Math.floor(budgetWords), 64);
        if (countWords(content) <= budget) return [content];
        const segs = content.match(/[^\n]*\n|[^\n]+$/g) || [content];
        const chunks = [];
        let cur = '';
        let curW = 0;
        const flush = () => { if (cur) { chunks.push(cur); cur = ''; curW = 0; } };
        const pushRunSliced = (run) => {
            // 空白なし長大ラン（CJK等）は文字単位で切断（1字≒1語とみなす）
            const cps = Array.from(run);
            for (let i = 0; i < cps.length; i += budget) chunks.push(cps.slice(i, i + budget).join(''));
        };
        const splitRuns = (seg) => {
            // 先頭空白を落とさないよう位置追跡しながら単語ランに分解する
            const runs = [];
            const re = /\S+\s*/g;
            let pos = 0;
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(seg)) !== null) {
                if (m.index > pos) runs.push(seg.slice(pos, m.index));
                runs.push(m[0]);
                pos = m.index + m[0].length;
                if (m[0].length === 0) break;
            }
            if (pos < seg.length) runs.push(seg.slice(pos));
            if (!runs.length) runs.push(seg);
            return runs;
        };
        for (const seg of segs) {
            const w = countWords(seg);
            if (w > budget) {
                flush();
                const runs = splitRuns(seg);
                let piece = '';
                let pw = 0;
                const flushPiece = () => { if (piece) { chunks.push(piece); piece = ''; pw = 0; } };
                for (const run of runs) {
                    const rw = countWords(run);
                    if (rw > budget) { flushPiece(); pushRunSliced(run); continue; }
                    if (pw + rw > budget && piece) flushPiece();
                    piece += run;
                    pw += rw;
                }
                flushPiece();
                continue;
            }
            if (curW + w > budget) flush();
            cur += seg;
            curW += w;
        }
        flush();
        return chunks.length ? chunks : [content];
    }

    /**
     * バイト予算と単語数予算の両方を満たすようチャンク分割する。
     * @returns {Array<string>}
     */
    function _splitContentDualWords(content, budgetBytes, budgetWords, encoder) {
        const first = _splitContent(content, budgetBytes, encoder);
        if (!Number.isFinite(budgetWords)) return first;
        const out = [];
        for (const piece of first) {
            if (countWords(piece) <= budgetWords) { out.push(piece); continue; }
            for (const sub of _splitContentByWords(piece, budgetWords)) out.push(sub);
        }
        return out.length ? out : [content];
    }

    /**
     * 除外パターン（生成物ノイズ除去用）のマッチャーを生成する。空なら null。
     * 既存のパス対応Globを再利用する。
     */
    function createExcludeMatcher(patterns) {
        const { Glob } = FileFlow.utils;
        if (!patterns || !patterns.trim()) return null;
        return Glob.createMatcher(patterns);
    }

    /**
     * 事前割付（I/Oなし）: バイト数・単語数・件数の三重制限でファイル群をパートに振り分ける。
     * 単語数見積りはバイト数で代用する（1語は最低1バイトのため安全側の上限になる）。
     * effectiveWordLimit が非有限・未指定の場合は単語数制限を適用しない（後方互換）。
     * @returns {Array<Array<number>>} fileItems へのインデックス配列の配列
     */
    function assignParts(fileItems, effectivePartSize, effectiveMaxFiles, effectiveWordLimit) {
        const groups = [];
        let cur = [];
        let curSize = 0;
        let curEst = 0;
        const hasWordLimit = Number.isFinite(effectiveWordLimit);
        const fits = (est) =>
            (effectivePartSize === Infinity || curSize + est <= effectivePartSize) &&
            (!hasWordLimit || curEst + est <= effectiveWordLimit) &&
            (effectiveMaxFiles === Infinity || cur.length < effectiveMaxFiles);
        fileItems.forEach((item, idx) => {
            const est = (item.size || 0) + BLOCK_OVERHEAD_EST;
            if (cur.length > 0 && !fits(est)) {
                groups.push(cur);
                cur = [];
                curSize = 0;
                curEst = 0;
            }
            cur.push(idx);
            curSize += est;
            curEst += est;
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

    // JSON scalars/flow collections are a strict subset of YAML 1.2. This also
    // escapes quotes, control characters and backslashes in local file names.
    function yamlFrontmatter(fields) {
        return '---\n' + Object.entries(fields).filter(([,value]) => value !== undefined)
            .map(([key,value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---\n';
    }

    function generatedMetadata(at) {
        return { by: 'process:fileflow-export', at: at || new Date().toISOString() };
    }

    function markdownText(value) {
        return String(value).replace(/[\r\n]/g, ' ').replace(/[\\`*_[\]<>|]/g, '\\$&');
    }

    function markdownLink(title, path) {
        const url = String(path).split('/').map(segment => encodeURIComponent(segment)
            .replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())).join('/');
        return '[' + markdownText(title) + '](' + url + ')';
    }

    /**
     * index後続シャードのヘッダを生成する。
     */
    function _buildIndexShardHead(rootName, shardNum, totalShards, generatedAt) {
        return yamlFrontmatter({
            type: 'codebase_index_shard',
            title: `${rootName} — File Catalogue (${shardNum}/${totalShards})`,
            description: 'Continuation of the codebase file catalogue with export status and part mappings.',
            generated: generatedMetadata(generatedAt),
            sources: [{ resource: '/codebase.md', title: 'Codebase overview' }],
            index_of: 'codebase.md', shard_number: shardNum, total_shards: totalShards
        }) + '\n# File Catalogue\n\n> Load ' + markdownLink('index.md', 'index.md') +
            ' first. See ' + markdownLink('Codebase overview', 'codebase.md') + ' for scope and totals.\n\n';
    }

    // =====================================================================
    //  VcxprojParser — Parse .vcxproj and .vcxproj.filters XML
    // =====================================================================

    const VcxprojParser = {
        parseProject(xmlText, projPath) {
            const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            if (doc.querySelector('parsererror')) throw new Error('Invalid project XML');
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
            if (doc.querySelector('parsererror')) throw new Error('Invalid project XML');
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

    FileFlow.exportCommon = { yamlFrontmatter, generatedMetadata, markdownText, markdownLink, DEFAULT_CONFIG, BLOCK_OVERHEAD_EST, SUBTREE_MAX_LINES, PARTS_MAP_MAX, CHUNK_RESERVED_BYTES, MAX_OUTPUT_WORDS, OUTPUT_WORD_TARGET, OUTPUT_WORD_RESERVE, SINGLE_BLOCK_WORD_BUDGET, INDEX_SHARD_HEAD_EST_WORDS, _splitContent, countWords, _splitContentByWords, _splitContentDualWords, createExcludeMatcher, assignParts, _buildSubtree, _buildIndexShardHead, VcxprojParser, _getExtension, _fuzzyMatchProject, _detectEntryPoints, _detectLanguage };
})();
