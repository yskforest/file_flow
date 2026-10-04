# FileFlow

ブラウザ上でフォルダ構造を可視化し、拡張子の一括付与・文字コード検出・ZIP/CSVエクスポートなどの一括処理を行うクライアントサイド完結型ツール。

サーバー不要で、`file://` プロトコル（HTMLファイルのダブルクリック）でもそのまま動作します。

---

## クイックスタート

### 1. セットアップ

外部ライブラリ (`jszip`) をローカルに配置するため、初回のみ以下を実行します。

```bash
sh setup.sh
```

> `lib/jszip.min.js` が既に存在する場合はスキップされます。  
> 内部的には cdnjs から `jszip 3.10.1` を `curl` または `wget` でダウンロードします。

### 2. 起動

`index.html` をブラウザで直接開きます（ダブルクリック可）。  
ローカルサーバー経由でも動作します。

```bash
# 例: Python で簡易サーバーを起動する場合
python -m http.server 8080
```

### 3. 基本的な使い方

1. **フォルダをドロップ** — 画面中央のドロップゾーンにフォルダをドラッグ＆ドロップします。
2. **閲覧** — ツリービュー / リストビューを切り替えて構造を確認します。
3. **フィルタリング** — ツールバーの入力欄に Glob パターンを入力してリアルタイム絞り込み。
4. **アクション適用** — ヘッダーのモードバッジで処理モードを選択し、`Apply Action` を押下。
5. **エクスポート** — `Download ZIP` / `Download CSV` で結果を出力。

---

## 機能一覧

### ビューモード

| モード | 説明 |
|---|---|
| **ツリービュー** | 階層構造をそのまま表示。フォルダはクリックで**遅延読み込み (Lazy Loading)** して展開。巨大フォルダでも初期表示が高速。 |
| **リストビュー** | 全ファイルをフラットテーブル (Grid.js) で表示。Name / Size / Date / Type / Encode / EOL の 6 カラム。各カラムにフィルタ・ソート用のポップオーバーを搭載。 |

### アクションモード

設定モーダル、またはヘッダーのモードバッジから切り替えます。

| モード | ID | 動作 |
|---|---|---|
| **Add .md** | `md` | 全対象ファイルに `.md` 拡張子を追加リネーム（表示名 + ZIPエクスポート時のファイル名を変更） |
| **Add .txt** | `txt` | 同上、`.txt` 拡張子を追加 |
| **Detect Info** | `detect` | ファイル先頭 4KB を読み込み、文字コード (Encoding) と改行コード (EOL) を推測してバッジ表示 |

**アクションの適用方法:**

- **個別適用** — ツリービューでファイルをクリックすると、現在のアクションモードが単体適用されます。
- **一括適用** — ツールバーの `Apply Action` ボタンでフィルタ条件に一致する全ファイルに再帰的に適用します。

### Glob フィルタリング

ツールバーの入力欄に `.gitignore` スタイルの Glob パターンを記述できます。  
スペースまたはカンマ区切りで複数パターンを指定可能です。

| パターン例 | 意味 |
|---|---|
| `*.js` | `.js` ファイルのみ表示 |
| `!*.log` | `.log` ファイルを除外 |
| `*.ts *.tsx` | `.ts` と `.tsx` を表示 |
| `src/**/*.py` | `src/` 配下の `.py` を表示 |

- **Include** パターン（`!` なし）と **Exclude** パターン（`!` 付き）を組み合わせ可能。
- Exclude パターンが優先的に評価されます。
- フィルタ結果は ZIP / CSV エクスポート・アクション適用の対象範囲にも反映されます。

### エクスポート

| 形式 | 説明 |
|---|---|
| **ZIP** | フィルタ後のフォルダ構造を維持したまま ZIP としてダウンロード。リネームアクション適用後の名前が反映される。単一フォルダドロップ時はフォルダ名が ZIP ファイル名になる。 |
| **CSV** | リストビュー専用。現在のフィルタ・ソート状態のデータを BOM 付き UTF-8 CSV としてダウンロード。Excel でそのまま開ける。 |

### 統計情報

ヘッダーの棒グラフアイコンをクリックすると、再帰的にスキャンした統計情報をモーダルで表示します。

- **Total Size** — 全ファイルの合計サイズ
- **Files / Folders** — ファイル数 / フォルダ数
- **Ignored Folders** — ドットファイル除外で無視されたフォルダ数
- **Extensions** — 拡張子別ファイル数の集計テーブル

### 設定

| 項目 | デフォルト | 説明 |
|---|---|---|
| Exclude dotfiles | ✅ ON | `.git`, `.vscode` 等のドットファイル/フォルダを除外 |
| Show full path in List View | ✅ ON | リストビューでファイル名をフルパスで表示 |

設定は `localStorage` に自動永続化されます。

---

## 動作仕様

### ファイル入力

- `DataTransferItem.webkitGetAsEntry()` を使用し、ドロップされたアイテムを `FileSystemEntry` として取得。
- ディレクトリエントリの `createReader().readEntries()` を再帰的に呼び出してツリーを走査。
- `readEntries()` は一度に全件返さない仕様のため、空配列が返るまでループで全件取得。

### テキスト/バイナリ判定

ファイル先頭 512 バイトに Null バイト (`0x00`) が含まれるかで判定。

### 文字コード推定 (Encoding Detection)

ファイル先頭 4KB を `ArrayBuffer` として読み込み、以下のヒューリスティクスで判定:

```
1. BOM チェック
   - 0xEF 0xBB 0xBF → UTF-8 (BOM)
   - 0xFE 0xFF       → UTF-16 BE
   - 0xFF 0xFE       → UTF-16 LE

2. 全バイト ≤ 0x7F → ASCII

3. TextDecoder('utf-8', { fatal: true }) でデコード成功 → UTF-8

4. Shift_JIS 判定
   - 第1バイト: 0x81-0x9F or 0xE0-0xFC
   - 第2バイト: 0x40-0x7E or 0x80-0xFC
   - 上記パターンが一貫していれば → Shift_JIS

5. EUC-JP 判定
   - 0xA1-0xFE のバイトが含まれれば → EUC-JP?

6. いずれにも該当しない → Other
```

### 改行コード推定 (EOL Detection)

ファイル先頭 4KB のバイト列を走査し、`CR+LF` / `LF` / `CR` の出現回数を比較。

| 結果 | 条件 |
|---|---|
| `CRLF` | CR+LF が最多 |
| `LF` | LF が最多 |
| `CR` | CR が最多 |
| `Mixed` | 同数の場合 |
| `None` | 改行なし |

### リネームアクション

- 実際のファイルシステムは変更しません（ブラウザの `FileSystemEntry` は読み取り専用）。
- `entryMetadata[fullPath].newFilename` にリネーム後の名前を保持し、表示名と ZIP エクスポート時のファイル名に反映します。
- 既にターゲット拡張子を持つファイルにはアクションを適用しません。

### パフォーマンス

- **Lazy Loading** — ツリービューではフォルダ展開時に初めて子エントリを読み込み、DOMに追加。
- **Chunk Processing** — リストビューでの全ファイル走査は 1000 件ごとにチャンク分割し、`setTimeout(0)` で UI スレッドに制御を返却。
- **メタデータキャッシュ** — `entryMetadata` にファイルサイズ・日時・エンコーディング情報をキャッシュし、再描画時のファイル再読み込みを回避。
- **デバウンス** — フィルタ入力は 300ms のデバウンスでリアルタイム反映。

### LLM エクスポート (LLM Export)

ツールバーの `Export for LLM` ボタンから起動します。1,000万行規模の Visual Studio プロジェクトのソースコードを LLMへ投入可能な統合テキストに変換・分割エクスポートします。ツールバーのGlobフィルタと対象拡張子設定がエクスポート範囲に反映されます。

- **vcxproj 自動解析**: `vcxproj` や `vcxproj.filters` からプロジェクト名、ビルド構成、プリプロセッサ定義、インクルードパス、フィルタ（仮想フォルダ）情報を自動抽出。
- **事前一覧確認モーダル**: エクスポート前に検出された `vcxproj` のビルド定義一覧・ファイル件数をカード形式で事前プレビュー確認し、対象プロジェクトを個別に選択可能。
- **トークン最適化 & 4MB分割**: ヘッダー構成をコンパクト化し、入力上限4MBごとに自動分割（ファイル境界で切断）。
- **メタデータ CSV 同梱**: 統合テキストファイル群に加えて `vcxproj_list.csv` （プロジェクト定義一覧）および `target_files_list.csv` （対象ファイル明細）が ZIP に同梱されます。

詳しいフォーマット仕様については [docs/export_format.md](file:///x:/code/file_flow/docs/export_format.md) を参照してください。

---

## 設計 (Architecture)

### 全体構成

```
file://  で動作可能とするため ES Modules を使用せず、
グローバル名前空間 window.FileFlow にモジュールを登録する IIFE パターンを採用。
HTML はスケルトンのみ保持し、SVG アイコンとモーダルは JS 側で動的に生成する。
```

```
index.html              … スケルトン HTML
style.css               … 全スタイル定義 (CSS Variables ダークテーマ)
docs/
├── requirements.md     … プロジェクト要件定義書
├── export_format.md    … LLM統合テキスト & CSV 出力仕様書
└── ai_format_guide.md  … 統合テキスト & CSV フォーマット解釈リファレンス書
js/
├── state.js            … 定数 + ストア (Proxy/PubSub, updateMeta/getMeta)
├── utils.js            … 汎用 ($, format, escape, Icons, downloadBlob)
├── core.js             … ドメイン (Globパス対応, FS, Detect, Entries, Zipモデル駆動)
├── actions.js          … アクション基底クラス + レジストリ (DOM非依存・純粋)
├── views.js            … TreeView / ListView 描画 (escape徹底)
├── ui.js               … Status/Modal/Stats/Renderコーディネータ + LLMプレビュー
├── export-llm.js       … vcxproj解析 / OKF統合テキスト & CSVエクスポート
└── app.js              … エントリーポイント (イベントバインド + オーケストレーション)
lib/
└── jszip.min.js        … JSZip ライブラリ (setup.sh でダウンロード)
setup.sh                … 初回セットアップスクリプト
```

### 名前空間 (`window.FileFlow`)

```javascript
window.FileFlow = {
    state: {
        currentRootEntries: [],   // ドロップされたルートエントリ群
        appSettings: {            // ユーザー設定 (localStorage 永続化)
            viewMode: 'tree',     // 'tree' | 'list'
            actionMode: 'md',     // 'md' | 'txt' | 'detect'
            excludeDots: true,
            showFullPath: true
        },
        entryMetadata: {},        // fullPath → { size, date, encoding, eol, newFilename, ... }
        searchQuery: ''           // 現在のフィルタクエリ
    },
    actions: {},   // ActionManager + 各 Action クラス (DOM非依存)
    ui: {},        // Render, Status, Stats, initModals, applyActionResult, TreeHooks
    views: {},     // Tree, List (描画専念)
    utils: {}      // $, format, escape, Icons, Glob, FS, Entries, Detect, Zip, csv/blob/path共有
};
```

### モジュール責務

| モジュール | 名前空間 | 責務 |
|---|---|---|
| **state.js** | `FileFlow.state` / `FileFlow.constants` | 定数集約、Proxyストア、PubSub、`updateMeta/getMeta` による通知保証 |
| **utils.js** | `FileFlow.utils.$` ほか | `getElementById`、表示フォーマット、XSS対策 (`escapeHtml/escapeAttr`)、Icons、Blobダウンロード |
| **core.js** | `FileFlow.utils.Glob` | パス対応マッチャー (`**`/`*`/`?`、basename+relPath判定) |
| | `FileFlow.utils.FS` | 反復スタック走査 (`traverse`、中断可)、`readDir` 部分結果返却 |
| | `FileFlow.utils.Entries` | `collectFiles/buildRelPath` (ZIP/一覧/統計のSingle Source) |
| | `FileFlow.utils.Detect` | 文字コード・改行コード検出 |
| | `FileFlow.utils.Zip` | モデル駆動ZIP (DOM非依存・未展開ノードも対象) |
| | 共有 | `csvEscape/bomTextBlob/dirnameOf/normalizeLookupPath/readEntryFile` |
| **actions.js** | `FileFlow.actions.BaseAction` | 基底クラス (`shouldApply`, `execute(entry)` 純粋・DOM非依存) |
| | `FileFlow.actions.ActionManager` | レジストリ (`register`, `resolve`)。`md/txt/detect` 変換を一元化 |
| **views.js** | `FileFlow.views.Tree/List` | 描画専念。Grid.js管理、CSV生成、表示escape徹底 |
| **ui.js** | `FileFlow.ui.Status` | トースト通知 (トークン制でレース解消、ESCでモーダルを閉じる) |
| | `FileFlow.ui.Render` | 描画統括 + `applyActionResult` でDOM反映 |
| | `FileFlow.ui.Stats` | 単一走査の統計計算 + レンダリング |
| | `FileFlow.ui.VcxprojPreview` | LLMエクスポートのプレビュー (escape済み) |
| **export-llm.js** | `FileFlow.llmExport` | vcxproj解析/OKF統合/CSV/index.md生成。Globフィルタ尊重 (旧 `notebookLM` は互換エイリアス) |
| **app.js** | *(IIFE)* | アイコン注入、設定読み書き、全 DOM イベントバインド |

### アクションシステム

Strategy パターンに基づく拡張可能なアクションアーキテクチャ:

```
BaseAction (抽象)
├── shouldApply(entry) → boolean   … 適用条件判定
└── execute(entry) → Promise<{applied, ...}>   … 純粋な実行・State更新のみ（描画反映は ui.applyActionResult）
    │
    ├── RenameAction('.md')   ← ActionManager.register() で登録
    ├── RenameAction('.txt')  ← 同上
    └── DetectAction          ← 同上
```

新しいアクションを追加する場合は `BaseAction` を継承し、`ActionManager.register()` で登録するだけで統合されます。

### スクリプト読み込み順序

ES Modules を使用しないため、`index.html` でのスクリプト読み込み順序が依存関係を定義します:

```
1. gridjs.umd.js           … Grid.js (CDN)
2. lib/jszip.min.js        … JSZip (ローカル)
3. js/state.js              … 定数 + ストア
4. js/utils.js              … 汎用ユーティリティ
5. js/core.js               … ドメイン (Glob/FS/Detect/Entries/Zip)
6. js/actions.js            … アクションシステム (state/coreに依存)
7. js/views.js              … ビュー層
8. js/ui.js                 … UIコーディネータ (+ Preview)
9. js/export-llm.js         … LLMエクスポート (core/uiに依存)
10. js/app.js               … エントリーポイント (全モジュールに依存)
```

### 外部ライブラリ

| ライブラリ | 用途 | 読み込み方法 |
|---|---|---|
| **JSZip 3.10.1** | ZIP ファイル生成 | ローカル (`lib/jszip.min.js`, `setup.sh` で取得) |
| **Grid.js** | リストビューのテーブル描画 | CDN (`unpkg.com/gridjs`) |

---

## ディレクトリ構成

```
file_flow/
├── index.html             # スケルトン HTML (62行)
├── style.css              # スタイルシート (CSS Variables ダークテーマ)
├── setup.sh               # 初回セットアップ (jszip ダウンロード)
├── .gitignore             # /lib, /test_data を除外
├── README.md              # このファイル
├── docs/
│   └── requirements.md    # プロジェクト要件定義書 (受入条件等を含む)
├── js/
│   ├── state.js           # 定数 + ストア
│   ├── utils.js           # 汎用ユーティリティ + アイコン
│   ├── core.js            # Glob/FS/Detect/Entries/Zip
│   ├── actions.js         # アクションシステム (DOM非依存)
│   ├── views.js           # Tree/List描画
│   ├── ui.js              # UIコーディネータ + LLMプレビュー
│   ├── export-llm.js      # vcxproj解析 / OKF統合 / CSVエクスポート
│   └── app.js             # エントリーポイント
├── lib/
│   └── jszip.min.js       # JSZip (setup.sh で生成, .gitignore)
├── test/
│   ├── test.html          # ブラウザ表示用テストランナー (ダブルクリックで起動)
│   ├── test_runner.js     # テストケース定義とアサーションロジック
│   └── run_tests.js       # Node.js CLI実行用テストスクリプト
└── test_data/             # テスト用データ (.gitignore)
```

---

## テスト (Testing)

FileFlow のコアロジック（Globフィルタリング、文字コード・改行コード検出、アクションシステム、ユーティリティ）の動作を検証するためのテストコードが用意されています。

テストは、**ブラウザ上（UI）**と**コマンドライン（CLI）**の両方で実行可能です。

### 1. ブラウザでテストを実行する (推奨)

1. `test/test.html` をブラウザで直接開きます（ダブルクリック可）。
2. 自動的にテストが実行され、結果が画面に表示されます。
3. 再実行したい場合は、画面右上にある `Run Tests` ボタンを押下します。

### 2. コマンドライン (Node.js) でテストを実行する

Node.js 環境が利用可能な場合、以下のコマンドでテストを実行できます。

```bash
node test/run_tests.js
```

すべてのテストが成功すると `SUCCESS`、失敗した場合はエラー詳細とスタックトレースを表示してプロセスが非ゼロで終了します。

---

## ライセンス

特記なし。

