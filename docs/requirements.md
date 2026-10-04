# FileFlow 要求仕様書 (Requirements)

- **アプリ名**: FileFlow（ファイル・フロー）
- **目的**: サーバー不要でブラウザ上で完結し、フォルダ構造を可視化して、拡張子の一括付与・文字コード検出・ZIP/CSVエクスポート・LLM向けソース統合などの一括処理を行うクライアントサイド完結型ツール。
- **利用環境**: ローカル環境の最新ブラウザ（`file://` による直接起動、またはローカル簡易サーバー経由）。

個別の詳細仕様は `detailed/` を参照（[出力フォーマット](detailed/export-format.md)・[出力の解釈方法](detailed/ai-format-guide.md)・[検出ヒューリスティクス](detailed/detection.md)・[エクスポートパイプライン](detailed/export-pipeline.md)）。

---

## 1. 技術スタックと制約

エージェントが推測で不要なライブラリやビルドツールを導入しないよう、以下を厳守する。

- **フロントエンド**: HTML5, CSS (Vanilla, CSS Variablesダークテーマ), JavaScript (Vanilla, IIFEパターン)
- **外部ライブラリ**:
  - JSZip (v3.10.1) をローカル配置（`lib/jszip.min.js` を `setup.sh` で取得）
  - Grid.js をCDN経由で読み込み（`unpkg.com/gridjs`）
- **ファイル構成**: `index.html` / `style.css` / `js/state.js` / `js/utils.js` / `js/core.js` / `js/actions.js` / `js/views.js` / `js/ui.js` / `js/export-llm.js` / `js/app.js` / `lib/jszip.min.js`（設計は [design.md](design.md)）
- **フォーマット規約**:
  - 設定は `localStorage` に JSON 文字列として永続化する。設定ファイルやモックデータを使う拡張では json ではなく yml を使うこと。

## 2. 機能要件

### 2.1 フォルダのドラッグ＆ドロップとスキャン

画面中央のドロップゾーンにフォルダをドロップすると、`webkitGetAsEntry()` で `FileSystemEntry` として取得し、非同期・再帰的に全ファイルをスキャンする。`readEntries()` は一度に全件返さないため空配列まで反復取得し、失敗時は警告のうえ部分結果を返す。

### 2.2 ビューモード切り替え

- **ツリービュー**: 階層構造をそのまま可視化。フォルダはクリック時に初めて子を読み込む遅延読み込みのため、巨大フォルダでも初期表示が高速。
- **リストビュー**: 全ファイルをフラットテーブル（Grid.js）で表示。Name / Size / Date / Type / Encode / EOL の6カラム。各カラムにフィルタ・ソート用のポップオーバーを搭載する。

### 2.3 Glob パターンフィルタリング

ツールバーの入力欄に `.gitignore` ライクなGlobパターンを記述できる。スペースまたはカンマ区切りで複数指定可能。`/` を含むパターンは相対パスに、含まないパターンはベース名にマッチする。

| 記号 | 意味 | パターン例 | 意味 |
|---|---|---|---|
| `*` | 同一階層のみ（`/` を除く） | `*.js` | `.js` のみ表示 |
| `**` | 階層横断 | `src/**/*.py` | `src/` 配下の `.py` を表示 |
| `?` | 1文字（`/` を除く） | `!*.log` | `.log` を除外 |

Include（`!` なし）と Exclude（`!` 付き）を組み合わせ可能で、Exclude が優先される。フィルタ結果は ZIP / CSV / アクション適用 / LLMエクスポートの対象範囲に反映される。

### 2.4 一括 / 個別アクション適用

ファイルクリック時、または `Apply Action` ボタン押下時に選択中のアクションを適用する。

| モード | 動作 |
|---|---|
| Add `.md` / `.txt` | 仮想リネーム（表示名＋ZIP内ファイル名に反映。実ファイルは不変）。既存の拡張子には適用しない |
| Detect Info | ファイル先頭 4KB を読み込み、文字コード（BOM / UTF-8 / Shift_JIS / EUC-JP / ASCII / Other / Binary / Empty）と改行コード（CRLF / LF / CR / Mixed / None）を推定してバッジ表示 |

判定ヒューリスティクスの詳細は [detailed/detection.md](detailed/detection.md) を参照。アクション本体はDOM非依存の純粋ロジックとし、描画反映は `ui.applyActionResult` に一元化する。

### 2.5 エクスポート (ZIP / CSV)

- **Download ZIP**: フィルタ後のフォルダ構造を維持したままZIP化する。リネーム適用後のファイル名が反映される。単一フォルダドロップ時はフォルダ名がZIPファイル名になる。未展開のツリーノードも出力対象に含める。
- **Download CSV**: リストビュー専用。現在のフィルタ・ソート状態のデータを BOM 付き UTF-8 CSV として出力する。

### 2.6 統計情報

スキャン結果の合計サイズ、ファイル/フォルダ数、除外されたドットフォルダ数、拡張子別件数をモーダル表示する。単一走査で集計し、Globフィルタとメタデータキャッシュを再利用する。

### 2.7 設定管理

| 項目 | デフォルト | 説明 |
|---|---|---|
| Exclude dotfiles | ✅ ON | `.git` 等のドットファイル/フォルダを除外 |
| Show full path in List View | ✅ ON | リストビューでフルパス表示 |
| Max part size (MB) | 4 | LLMエクスポートのパート容量上限 |
| Max files per part | 1000 | LLMエクスポートのパート件数上限（0=無制限） |
| Max single file size (MB) | 1 | LLMエクスポートの単一ファイル上限 |
| Target extensions | 既定セット | LLMエクスポートの対象拡張子 |
| Exclude patterns | 既定セット | LLMエクスポートの除外Glob（生成物ノイズ除去、空＝無効） |

設定は `localStorage` に自動永続化される。

### 2.8 LLM向けソースコード統合エクスポート

大規模プロジェクトのソースコードを、LLMが解析可能なOKF準拠の統合テキストとして出力する。

- **vcxproj/vcxproj.filters 自動検出・解析**: Configuration、Platform、PreprocessorDefinitions、AdditionalIncludeDirectories、ClCompile / ClInclude / ResourceCompile の分類、フィルタ（仮想フォルダ）パスを抽出する。
- **プレビュー**: 検出プロジェクトの一覧・ビルド定義・件数・概算容量・推定パート数（律速要因付き）を事前確認し、対象プロジェクトを選択できる。
- **範囲**: ツールバーのGlobフィルタ・対象拡張子・除外パターン（生成物ノイズ除去）が反映される。`README.*` は先頭に配置される。
- **分割**: パート容量上限とパート件数上限の厳しい方で分割する。パート上限超の単一ファイルは行単位チャンクに分割し、継続見出し（`(split k/n)`）付きで出力する。
- **構造保持**: 各パートにファイル目次＋ディレクトリサブツリーを同梱する。各ブロックはパス付き見出し・末尾フッターを持ち、本文内のフェンス記号では構造が壊れない。全体索引は `index.md`（肥大時は `index_files_*` に自動分割）に集約する。
- **メタデータCSV**: `vcxproj_list.csv`（または `folder_structure.csv`）と `target_files_list.csv` を同梱する。
- **文字コード変換**: Shift_JIS、EUC-JP等の非UTF-8ファイルを可能な限りUTF-8に変換する。

出力フォーマットの詳細は [detailed/export-format.md](detailed/export-format.md)、出力の解釈方法は [detailed/ai-format-guide.md](detailed/ai-format-guide.md)、処理フローの詳細は [detailed/export-pipeline.md](detailed/export-pipeline.md) を参照。

## 3. データ構造と状態

`window.FileFlow.state` が保持する主な状態：

- `currentRootEntries`: ドロップされたルート要素（`FileSystemEntry`）の配列
- `appSettings`: `viewMode` / `actionMode` / `excludeDots` / `showFullPath` / `llmExportConfig`（`maxPartSizeMB` 既定4、`maxFilesPerPart` 既定1000（0=無制限）、`maxSingleFileSizeMB` 既定1、`sourceExtensions`、`excludePatterns`）
- `entryMetadata`: `fullPath` をキーとするメタデータキャッシュ（サイズ・日時・文字コード・改行コード・リネーム後名など。更新は `updateMeta` 経由）
- `searchQuery`: 現在のフィルタクエリ

```yaml
appSettings:
  viewMode: "tree"
  actionMode: "md"
  excludeDots: true
  showFullPath: true
  llmExportConfig:
    maxPartSizeMB: 4
    maxFilesPerPart: 1000
    maxSingleFileSizeMB: 1
    sourceExtensions: ".cpp, .h, .c, .hpp, .cs, ..."
    excludePatterns: "**/node_modules/** ..."
```

## 4. 受け入れ条件

- **ローカル完結動作**: `file://` での直接起動ですべての機能が動作すること。
- **フォルダスキャン**: 全ファイルを非同期・再帰的に走査し完了後に正しく表示すること。大規模構造でも遅延読み込み＋分割処理でフリーズしないこと。
- **Globフィルタリング**: 複数パターンがデバウンス経由でリアルタイム評価され表示が絞り込まれること。
- **アクション**: `.md`/`.txt` 適用で表示名とZIP内ファイル名が変わること（実ファイル不変）。Detect Infoで文字コード・改行コードが推定表示されること。
- **エクスポート**: フィルタ後の構造・適用後ファイル名を維持したZIP、フィルタ・ソート反映のBOM付きUTF-8 CSVが出力されること。
- **LLMエクスポート**: 対象ソースが統合テキストとして出力され、vcxproj検出時はビルド単位情報を含むこと。各出力が上限（容量・件数）内に収まり、ファイル境界で分割されること（上限超の単一ファイルは継続見出し付きチャンク分割）。複数パートはZIP化され、各パートに目次が含まれること。非UTF-8はUTF-8に変換されること。
- **永続化と統計**: 設定が再読み込み後も復元されること。統計モーダルの集計が正確であること。
