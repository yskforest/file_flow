# 1. プロジェクト概要 (Project Overview)
- **アプリ名**: FileFlow (ファイル・フロー)
- **目的**: サーバー不要でブラウザ上で完結し、フォルダ構造を可視化して、拡張子の一括付与・文字コード検出・ZIP/CSVエクスポートなどの一括処理を行うクライアントサイド完結型ツール。
- **主なターゲット/利用環境**: ローカル環境の最新ブラウザ（`file://` プロトコルによるHTMLの直接起動や、ローカル簡易サーバー経由での実行）。

# 2. 技術スタックと制約 (Tech Stack & Constraints)
エージェントが推測で不要なライブラリやビルドツールを導入しないよう、以下の制約を厳守して実装すること。

- **フロントエンド**: HTML5, CSS (Vanilla, CSS Variablesによるダークテーマ対応), JavaScript (Vanilla, IIFEパターン)
- **外部ライブラリ**: 
  - JSZip (v3.10.1) をローカルに配置（`lib/jszip.min.js` を `setup.sh` にて取得して読み込む）
  - Grid.js をCDN経由で読み込む（`unpkg.com/gridjs`）
- **ファイル構成**:
  - `index.html` (エントリーポイント)
  - `style.css` (UIフレームワークは不使用、生のCSS Variablesで記述)
  - `js/utils.js` (グローバル名前空間 `window.FileFlow.utils` のユーティリティ・検出ロジック・ZIP生成など)
  - `js/actions.js` (グローバル名前空間 `window.FileFlow.actions` のアクションクラス群・ActionManager)
  - `js/ui.js` (グローバル名前空間 `window.FileFlow.ui` のUI描画・モーダル生成・統計描画など)
  - `js/app.js` (エントリーポイント、イベントリスナーの登録とオーケストレーション)
  - `lib/jszip.min.js` (ZIP圧縮ライブラリ)
- **フォーマット規約**: 
  - 本アプリでは設定データやモックデータファイル（YAML/JSON等）を直接読み込む仕様はないが、設定項目は `localStorage` に JSON 文字列として永続化する。設定ファイルやモックデータを使用する拡張を行う場合は、json ではなく yml を使用すること。

# 3. コア機能 (Core Features)
エージェントが実装すべき主要な機能をリストアップする。

1. **フォルダのドラッグ＆ドロップとスキャン**
   - 画面中央のドロップゾーンにフォルダをドロップすると、`webkitGetAsEntry()` を用いて `FileSystemEntry` として取得し、非同期かつ再帰的に全ファイルをスキャンする。
2. **ビューモード切り替え (ツリービュー / リストビュー)**
   - **ツリービュー**: 階層構造をそのまま可視化。フォルダはクリック時に動的に展開（遅延読み込み/Lazy Loading）するため、大量のファイルが含まれるフォルダでも初期表示が高速。
   - **リストビュー**: スキャンされた全ファイルをフラットな表形式（Grid.js）で表示。ファイル名、サイズ、更新日時、拡張子、エンコーディング、改行コードの6カラムで構成され、カラムフィルタやソートが可能。
3. **Glob パターンフィルタリング**
   - ツールバーの入力欄から `.gitignore` ライクなGlobパターン（例: `*.js`, `!node_modules/**`）を入力することで、リアルタイム（300msデバウンス）に対象ファイルをフィルタリングする。
4. **一括 / 個別アクション適用 (Strategy パターン)**
   - ファイルクリック時、またはツールバーの `Apply Action` ボタン押下時に、選択中のアクションを適用する。
     - **Add .md** / **Add .txt**: ファイルに拡張子を追加する仮想リネーム（ZIP生成時および表示名に反映）。
     - **Detect Info**: ファイル先頭 4KB を読み込み、文字コード（BOM / UTF-8 / Shift_JIS / EUC-JP / ASCII / Other / Binary / Empty）と改行コード（CRLF / LF / CR / Mixed / None）を推定し、バッジ表示する。
5. **エクスポート (ZIP / CSV)**
   - **Download ZIP**: フィルタされた現在のフォルダ・ファイル構造をそのままZIP化してダウンロード。リネームアクション適用後のファイル名が適用される。
   - **Download CSV**: リストビュー表示時にのみ有効。フィルタ・ソートされたファイル一覧を BOM付き UTF-8 CSV 形式でダウンロードする。
6. **統計情報 (Stats Modal)**
   - スキャンした全ファイルの合計サイズ、ファイル/フォルダ数、無視されたドットファイル数、拡張子ごとの件数統計テーブルをモーダルで表示する。
7. **設定管理 (Settings Modal)**
   - 「ドットファイル/フォルダの除外 (excludeDots)」「リストビューでのフルパス表示 (showFullPath)」などの設定情報を `localStorage` を介して自動永続化する。
8. **NotebookLM向けソースコード統合エクスポート (LLM Export)**
   - 大規模Visual Studioプロジェクト（1000万行規模）のソースコードを、LLM（NotebookLM等）が解析可能な統合テキストファイルとして出力する。
   - **vcxproj/vcxproj.filters 自動検出・解析**: フォルダドロップ時に `.vcxproj` および `.vcxproj.filters` を自動検出し、XML解析により以下のビルド単位情報を抽出する:
     - Configuration（Debug/Release等）、Platform
     - PreprocessorDefinitions（プリプロセッサ定義）
     - AdditionalIncludeDirectories（インクルードパス）
     - ソースファイル（ClCompile）、ヘッダファイル（ClInclude）、リソースファイル（ResourceCompile）の分類
     - フィルタ（仮想フォルダ）パス情報
   - **vcxproj一覧確認・選択機能 (Preview Modal)**:
     - エクスポート前に、検出された全 `vcxproj` のプロジェクト名、パス、Configuration、ファイル内訳、プリプロセッサ定義、インクルードパスを一覧モーダルで事前確認可能。
     - 各 `vcxproj` のチェックボックス選択により、特定のプロジェクトのみを対象にしてエクスポートを実行できる。
     - 概算ファイル件数、推定合計容量、分割パート数のプレビュー表示。
   - **ソースコード統合**: 対象拡張子のファイルをファイルパス・プロジェクト帰属・フィルタ情報のメタデータヘッダー付きで統合する。
   - **サイズ分割**: 出力ファイルを設定可能な上限（デフォルト4MB）以下の単位で分割する。ファイル境界で切断し、同一プロジェクトのファイルをできるだけ同じパートにまとめる。
   - **メタデータ CSV 出力**:
     - `vcxproj_list.csv`: 検出・選択された全 `vcxproj` のビルド定義一覧（プロジェクト名、パス、構成、ソース/ヘッダー数、Defines、Includes）を出力。
     - `target_files_list.csv`: 統合テキストに含まれる対象全ソースファイルの一覧（相対パス、帰属プロジェクト、フィルタパス、サイズ、拡張子）を出力。
   - **出力仕様書**: `docs/export_format.md` に統合テキストの構文、ヘッダー仕様、分割ルール、およびCSV仕様を明記。
   - **トークン効率**: LLMが解析精度を維持しつつ、トークン消費を最小化するコンパクトなフォーマットで出力する。
   - **文字コード変換**: Shift_JIS、EUC-JP等の非UTF-8ファイルを可能な限りUTF-8に変換して出力する。
   - **設定項目**: 対象拡張子、最大パートサイズ(MB)、最大単一ファイルサイズ(MB) を設定モーダルから変更可能。

# 4. データ構造と状態 (Data Schema & State)
アプリケーションがメモリ上で保持すべき状態（State）と、扱うデータのスキーマを定義する。

## 4.1 アプリケーションの状態 (State)
`window.FileFlow.state` で保持される主なメモリ状態は以下の通り：

- `currentRootEntries` (array): ドロップされたルート要素（`FileSystemEntry` オブジェクト）の配列
- `appSettings` (object): アプリケーション設定情報
  - `viewMode` (string): `'tree'` (ツリービュー) または `'list'` (リストビュー)
  - `actionMode` (string): `'md'` (Add .md) | `'txt'` (Add .txt) | `'detect'` (Detect Info)
  - `excludeDots` (boolean): ドットファイル/フォルダを除外するかどうかのフラグ
  - `showFullPath` (boolean): リストビューでファイルのフルパスを表示するかどうかのフラグ
  - `notebookLMConfig` (object): LLMエクスポート設定
    - `maxPartSizeMB` (number): 出力ファイルの最大サイズ（MB、デフォルト: 4）
    - `maxSingleFileSizeMB` (number): 単一ファイルの最大サイズ（MB、デフォルト: 1）
    - `sourceExtensions` (string): 対象拡張子のカンマ区切り文字列
- `entryMetadata` (object): 各ファイルの `fullPath` をキーとするメタデータキャッシュ。スキャンサイズ、日付、検出された文字コード・改行コード、適用されたリネームファイル名などを保持する
- `searchQuery` (string): ツールバーで入力された現在の検索フィルタキーワード

## 4.2 データスキーマ (YAML例)
以下は、メモリ上で管理される `appSettings` および `entryMetadata` のデータ構造をYAML形式で記述した例である。

```yaml
# アプリケーションの永続化設定 (localStorage['FileFlowSettings']) の YAML 表現例
appSettings:
  viewMode: "tree"       # 画面描画モード ('tree' | 'list')
  actionMode: "md"       # アクション適用モード ('md' | 'txt' | 'detect')
  excludeDots: true      # ドットファイル/フォルダ除外フラグ (true/false)
  showFullPath: true     # リストビューでのフルパス表示フラグ (true/false)
  notebookLMConfig:
    maxPartSizeMB: 4           # 出力ファイルの最大サイズ（MB）
    maxSingleFileSizeMB: 1     # 単一ファイルの最大サイズ（MB）
    sourceExtensions: ".cpp, .h, .c, .hpp, .cs, ..."  # 対象拡張子

# メモリ上で保持・蓄積されるファイルメタデータ (entryMetadata) の YAML 表現例
entryMetadata:
  "/root/docs/readme.txt":
    size: 2048
    date: "2026-07-15T14:50:00.000Z"
    encoding: "UTF-8"
    eol: "LF"
    newFilename: "readme.txt.md"
    detectionInfo:
      encoding: "UTF-8"
      eol: "LF"
```

# 5. 受け入れ条件 (Acceptance Criteria)
アプリケーションの動作検証時、以下の項目がすべて満たされていることを確認すること。

- **ローカル完結動作**:
  - `file://` プロトコルによる `index.html` の直接起動（ダブルクリック）で、すべての機能（スキャン、表示、フィルタ、アクション適用、エクスポート）が正常に動作すること。
- **フォルダスキャン機能**:
  - ドロップされたフォルダの全ファイルを非同期・再帰的に走査し、進捗ダイアログが完了後にファイルツリー/リストとして正しく表示されること。
  - 大規模なフォルダ構造であっても、ツリービューの遅延読み込み（Lazy Loading）とリストビューの分割スキャン（Chunk Processing）によりブラウザがフリーズしないこと。
- **Glob フィルタリング**:
  - `*.js` や `!node_modules/**` などの複数パターンに対応した Glob フィルタがリアルタイム（デバウンス経由）で評価され、表示される要素が動的に絞り込まれること。
- **アクション機能**:
  - `Add .md` / `Add .txt` が適用された際、表示されているファイル名と ZIP エクスポート用のファイル名が変更されること（ローカルファイル自体は変更しない）。
  - `Detect Info` が適用された際、ファイル先頭 4KB を解析して「文字コード」および「改行コード（EOL）」が自動推定され、画面上にバッジとして正しく表示されること。
- **エクスポート機能**:
  - **ZIPダウンロード**: フィルタにより表示中のファイル群が、アクション適用後のファイル名および元のフォルダ構造を維持した状態で正しくZIPファイルとして生成・ダウンロードされること。
  - **CSVダウンロード**: リストビュー選択時に、現在のフィルタおよびソート状態に合わせた表データが、BOM付き UTF-8 CSV として正しくエクスポートされること。
- **NotebookLM エクスポート機能**:
  - 「Export for LLM」ボタン押下時に、対象拡張子のソースファイルが統合テキストファイルとして出力されること。
  - vcxproj ファイルが検出された場合、ビルド単位情報（Configuration、Defines、IncludeDirs、ソース/ヘッダ分類、フィルタパス）が出力に含まれること。
  - 各出力ファイルが設定された最大サイズ（デフォルト4MB）以下であること。
  - ファイルの途中で切断されないこと（ファイル境界での分割）。
  - 複数パートの場合はZIPにまとめてダウンロードされること。
  - 各パートにファイルインデックス（目次）が含まれること。
  - 非UTF-8ファイル（Shift_JIS等）が正しくUTF-8に変換されて出力されること。
- **永続化と統計情報**:
  - 除外設定等の変更内容が `localStorage` に保存され、ページ再読み込み時にも状態が復元されること。
  - 統計情報モーダルに、全ファイルサイズ、総ファイル数/フォルダ数、無視された件数、および拡張子ごとの件数テーブルが正確に集計されて表示されること。

