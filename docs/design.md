# FileFlow 設計書 (Design)

要求仕様は [requirements.md](requirements.md) を参照。
個別の深掘りは `detailed/` を参照（[出力フォーマット](detailed/export-format.md)・[出力の解釈方法](detailed/ai-format-guide.md)・[検出ヒューリスティクス](detailed/detection.md)・[エクスポートパイプライン](detailed/export-pipeline.md)）。

## 1. 設計原則

- **`file://` 完結**: ES Modulesを使わず、IIFE＋グローバル名前空間 `window.FileFlow` にモジュールを登録する。`index.html` のスクリプト読み込み順序が依存関係を定義する。
- **関心の分離**: ドメイン層はDOM非依存の純粋ロジックとし、描画はビュー層、統括はUI層、配線はエントリーポイントに寄せる。
- **Single Source of Truth**: ZIPと一覧は `Entries.collectFiles` を共有し、LLM収集と統計は `FS` の走査と共通相対パス判定を使う。表示DOMを出力範囲の根拠にしない。

## 2. 全体構成

```
index.html          … スケルトン HTML
style.css           … 全スタイル定義 (CSS Variables ダークテーマ)
js/
├── state.js        … 定数 + ストア (Proxy/PubSub, updateMeta/getMeta)
├── utils.js        … 汎用 ($, format, escape, Icons, downloadBlob)
├── core.js         … ドメイン (Glob, FS, Detect, Entries, Zip, 共有helper)
├── actions.js      … アクション基底クラス + レジストリ (DOM非依存)
├── views.js        … TreeView / ListView 描画 (escape徹底)
├── ui.js           … Status/Modal/Stats/Render統括 + LLMプレビュー
├── export-common.js … 共通制限 / 分割helper / vcxproj解析
├── export-consolidator.js … Blob保持 / ソース分割 / 最終検証
├── export-format.js … CSV / index生成
├── export-llm.js   … 収集 / 設定 / プレビュー / 出力統括
└── app.js          … エントリーポイント (イベントバインド + 指示出し)
```

HTML はスケルトンのみ保持し、SVG アイコンとモーダルは JS 側で動的に生成する。

## 3. 名前空間と状態管理

```javascript
window.FileFlow = {
    state:   { currentRootEntries, appSettings, entryMetadata, searchQuery, ... },
    actions: { BaseAction, ActionManager, ... },  // DOM非依存
    views:   { Tree, List },                      // 描画専念
    ui:      { Status, Render, Stats, ... },      // 統括
    utils:   { $, Glob, FS, Entries, Detect, Zip, ... }
};
```

`FileFlow.state` は Proxy＋Pub/Sub の軽量ストア。`entryMetadata` の更新は必ず `updateMeta(path, patch)` 経由で行い、通知漏れを防ぐ（ネストの直接書き換え禁止）。

## 4. モジュール責務

| モジュール | 責務 |
|---|---|
| **state.js** | 定数集約、Proxyストア、PubSub、`updateMeta/getMeta` による通知保証 |
| **utils.js** | `getElementById`、表示フォーマット、XSS対策（`escapeHtml/escapeAttr`）、Icons、Blobダウンロード |
| **core.js** | パス対応Glob（`**`/`*`/`?`、basename＋relPath判定）、反復スタックFS走査（中断可）、文字コード・改行コード検出、`collectFiles/buildRelPath`、モデル駆動ZIP、CSV/Blob/パス共有helper |
| **actions.js** | Strategy パターン。`BaseAction`（`shouldApply`、`execute(entry)` 純粋）を継承し `ActionManager.register()` で登録する。`md/txt/detect` の識別子変換は `resolveActionId` に一元化 |
| **views.js** | 描画専念。TreeView（遅延展開）/ ListView（Grid.js管理、カラムフィルタ・ソート、CSV生成）、表示escape徹底 |
| **ui.js** | Status（トークン制でレース解消）、Modal（ESC対応）、Render統括＋`applyActionResult` でDOM反映、単一走査の統計、LLMプレビュー（escape済み） |
| **export-common.js** | 共通制限・文字／単語分割・XML解析 |
| **export-consolidator.js** | ファイルを逐次読み込み、断片をBlob保持。BOMを含む完成出力のバイト数・単語数・ファイル件数を検証。失敗・除外を返す |
| **export-format.js** | 処理結果に基づく索引・CSV生成。索引はBOM込みサイズも検証 |
| **export-llm.js** | スキャン・設定検証・プレビュー・ZIP統括（旧 `notebookLM` は互換エイリアス） |
| **app.js** | アイコン注入、設定読み書き、全DOMイベントバインド |

## 5. スクリプト読み込み順序

```
1. gridjs.umd.js     … Grid.js 6.2.0 (ローカル)
2. lib/jszip.min.js   … JSZip (ローカル)
3. js/state.js        … 定数 + ストア
4. js/utils.js        … 汎用ユーティリティ
5. js/core.js         … ドメイン
6. js/actions.js      … アクションシステム
7. js/views.js        … ビュー層
8. js/ui.js           … UI統括 (+ Preview)
9. js/export-common.js … 共通制限・XML解析
10. js/export-consolidator.js … ソース統合
11. js/export-format.js … CSV・index
12. js/export-llm.js … LLM統括
13. js/app.js         … エントリーポイント
```

## 6. 主要フロー

- **表示**: Drop → `state.currentRootEntries` → `Render.renderFileList` → ツリー（遅延）/リスト（`Entries.collectFiles`＋チャンク生成）。
- **アクション**: `ActionManager.resolve(mode)` → `execute(entry)`（純粋）→ `ui.applyActionResult` でDOM反映。
- **LLMエクスポート**: スキャン → Glob/拡張子フィルタ → 断片を逐次Blob化 → バイト・単語・件数制限で梱包 → 最終検証・再分割 → OKF v0.2のルート目次＋codebase概要（明細は必要時分割）＋CSV → ZIP。各パートはファイル目次＋ディレクトリサブツリーを持ち単体でも構造が通じる。詳細は [detailed/export-pipeline.md](detailed/export-pipeline.md)。

## 7. 共通規約

- **XSS対策**: 外部由来文字列を `innerHTML` に埋め込む際は必ず `escapeHtml`/`escapeAttr` を通す。可能な箇所は `textContent` を使う。
- **設定の永続化**: `localStorage['FileFlowSettings']` にJSONで保存。旧キー（例: `notebookLMConfig`）からは自動移行する。
- **テスト方針**: コアロジック（Glob、文字コード検出、アクション、ユーティリティ、LLMエクスポートの分割・CSV・内部関数）を `test/test_runner.js` で検証し、`test/test.html`（ブラウザ）と `test/run_tests.js`（Node.js CLI）の両方で実行する。DOMParser を要するXML解析テストはブラウザでのみ実行し、Node.js ではSKIPと表示し、Docker内のChromiumで実行する。

## 8. 非同期処理と出力保証

- 描画世代IDで古い一覧処理の画面・メタデータ反映を止める。Clearも世代を更新し、Gridを破棄する。
- 遅延展開で生成するファイルにも現在のGlobを適用する。
- 仮想リネーム後の相対パスは `utils.outputPath` で一覧・CSV・ZIPに共有する。
- 一覧読み取りは32件単位、通常ZIPは8件の並列上限。行順序は非同期完了順に依存しない。
- アクション・出力中は関連操作を無効化し、終了・失敗時に復元する。
- ZIP出力パスの重複は読み取り開始前に検出し、生成を中止する。
- 取得失敗はレポートCSVに記録。LLMの索引・対象CSVには実際の成功結果を反映する。全対象が失敗・除外でもレポートと索引を出力する。
- セットアップは固定URL・SHA-256検証・一時ファイル・atomic renameを用い、失敗時に既存ファイルを壊さない。
