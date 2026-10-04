# FileFlow

ブラウザ上でフォルダ構造を可視化し、拡張子の一括付与・文字コード検出・ZIP/CSVエクスポート・LLM向けソース統合などの一括処理を行うクライアントサイド完結型ツール。

サーバー不要で、`file://` プロトコル（HTMLファイルのダブルクリック）でもそのまま動作します。

## クイックスタート

```bash
sh setup.sh            # 初回のみ: jszip をローカルに配置
```

`index.html` をブラウザで直接開きます（ダブルクリック可）。ローカルサーバー経由でも動作します（例: `python -m http.server 8080`）。

## 使用方法

1. **フォルダをドロップ** — 画面中央のドロップゾーンにドラッグ＆ドロップします。
2. **閲覧** — ツリービュー（遅延読み込み）/ リストビュー（Grid.jsの6カラム表）を切り替えて確認します。
3. **フィルタリング** — ツールバーの入力欄に Glob パターン（例: `*.js`、`!*.log`、`src/**/*.py`）を入力して絞り込みます。
4. **アクション適用** — ヘッダーのモードバッジで処理（Add `.md` / `.txt`、Detect Info）を選び、ファイルクリックで個別適用、`Apply Action` で一括適用します。
5. **エクスポート** — `Download ZIP` / `Download CSV` で出力します。
6. **LLM向け統合** — `Export for LLM` でソースコードをOKF準拠の統合テキスト＋index＋CSVのZIPとして出力します（容量・件数の二重制限で自動分割）。

設定（ドットファイル除外、表示切替、エクスポート上限など）は `localStorage` に自動永続化されます。

### LLMエクスポートの2モード

| モード | 使いどころ | 特徴 |
|---|---|---|
| **vcxproj** | `.vcxproj` があるC++案件 | ビルド単位（PJ・仮想フォルダ）で整理。Defines/Includes・PJ選択付き。`vcxproj_list.csv` を同梱 |
| **フォルダ構造** | 素のOSS・多言語リポジトリ | 物理ディレクトリのまま整理。`folder_structure.csv` を同梱 |

`.vcxproj` 検出時は自動選択されます。どちらも各パートにファイル目次＋ディレクトリツリー付き、`index.md`（肥大時は分割）に全体索引を集約します。バイナリ（`.dll` 等）は本文から除外し、indexに一覧のみ記録します。

## 設計（概要）

`file://` 完結のため ES Modules を使わず、IIFE＋グローバル名前空間 `window.FileFlow` にモジュールを登録します。ドメイン層はDOM非依存の純粋ロジック、描画はビュー層、統括はUI層、配線はエントリーポイントに分離しています。

```
js/state.js       … 定数 + ストア
js/utils.js       … 汎用ユーティリティ
js/core.js        … Glob / FS / 検出 / Entries / ZIP
js/actions.js     … アクションシステム
js/views.js       … Tree / List 描画
js/ui.js          … UI統括 + プレビュー
js/export-llm.js  … LLMエクスポート
js/app.js         … エントリーポイント
```

詳細は [docs/design.md](docs/design.md)（[requirements.md](docs/requirements.md) は要求仕様）を参照。

## テスト

```bash
node test/run_tests.js   # CLI実行（test/test.html でもブラウザ実行可）
```

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要求仕様書（この二文書で全体像が完結） |
| [docs/design.md](docs/design.md) | 設計書（この二文書で全体像が完結） |
| [docs/detailed/](docs/detailed/) | 個別詳細（出力仕様・解釈・検出・パイプライン） |

## ライセンス

特記なし。
