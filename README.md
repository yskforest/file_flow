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

---

## 設計 (Architecture)

### 全体構成

```
file://  で動作可能とするため ES Modules を使用せず、
グローバル名前空間 window.FileFlow にモジュールを登録する IIFE パターンを採用。
HTML はスケルトンのみ保持し、SVG アイコンとモーダルは JS 側で動的に生成する。
```

```
index.html          … スケルトン HTML (62行)
style.css           … 全スタイル定義 (CSS Variables ダークテーマ)
docs/
└── requirements.md … プロジェクト要件定義書（要件・制約・仕様・受入条件等）
js/
├── utils.js        … 名前空間定義 + ユーティリティ群 + アイコンヘルパー
├── actions.js      … アクション基底クラス + レジストリ + 全アクション
├── ui.js           … UI 描画 / モーダル生成 / フィルタ / ステータス / 統計
└── app.js          … エントリーポイント (イベントバインド + オーケストレーション)
lib/
└── jszip.min.js    … JSZip ライブラリ (setup.sh でダウンロード)
setup.sh            … 初回セットアップスクリプト
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
    actions: {},   // ActionManager + 各 Action クラス
    ui: {},        // Render, Status, Stats, initModals
    utils: {}      // $, formatBytes, Icons, Glob, FS, Detect, Zip
};
```

### モジュール責務

| モジュール | 名前空間 | 責務 |
|---|---|---|
| **utils.js** | `FileFlow.utils.$` | `getElementById` ショートカット |
| | `FileFlow.utils.formatBytes` | バイト数フォーマット |
| | `FileFlow.utils.Icons` | SVG アイコンテンプレートマップ |
| | `FileFlow.utils.Glob` | Glob パターンマッチャー生成 |
| | `FileFlow.utils.FS` | ディレクトリ読み込み (`readDir`)、再帰走査 (`traverse`) |
| | `FileFlow.utils.Detect` | 文字コード・改行コード検出 (`detectFileInfo`) |
| | `FileFlow.utils.Zip` | ZIP 生成 + ダウンロード (`downloadZip`) |
| **actions.js** | `FileFlow.actions.BaseAction` | アクション基底クラス (`shouldApply`, `execute`) |
| | `FileFlow.actions.ActionManager` | アクションレジストリ (`register`, `getAction`) |
| | `FileFlow.actions.RenameAction` | `.md` / `.txt` 拡張子付与アクション |
| | `FileFlow.actions.DetectAction` | 文字コード・改行コード検出アクション |
| **ui.js** | `FileFlow.ui.Status` | トースト通知 (`show`, `hide`, `error`) |
| | `FileFlow.ui.initModals` | Settings / Stats モーダルの動的生成 |
| | `FileFlow.ui.Render` | ツリー/リスト描画、Grid.js 管理、カラムフィルタ/ソート、CSV エクスポート |
| | `FileFlow.ui.Stats` | 統計計算 + レンダリング (`show`) |
| **app.js** | *(IIFE)* | アイコン注入、設定読み書き、全 DOM イベントバインド |

### アクションシステム

Strategy パターンに基づく拡張可能なアクションアーキテクチャ:

```
BaseAction (抽象)
├── shouldApply(entry) → boolean   … 適用条件判定
└── execute(itemDiv, entry) → Promise   … 実行ロジック
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
3. js/utils.js             … 名前空間 + ユーティリティ (FileFlow.utils.*)
4. js/actions.js           … アクションシステム (FileFlow.actions.*)
5. js/ui.js                … UI層 (FileFlow.ui.*)
6. js/app.js               … エントリーポイント (全モジュールに依存)
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
│   ├── utils.js           # 名前空間 + ユーティリティ + アイコン (178行)
│   ├── actions.js         # アクションシステム (89行)
│   ├── ui.js              # UI描画 + モーダル + 統計 (549行)
│   └── app.js             # エントリーポイント (179行)
├── lib/
│   └── jszip.min.js       # JSZip (setup.sh で生成, .gitignore)
└── test_data/             # テスト用データ (.gitignore)
```

---

## ライセンス

特記なし。
