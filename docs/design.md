# FileFlow 設計書 (Design)

要求仕様は [requirements.md](requirements.md) を参照。
個別の深掘りは `detailed/` を参照（[出力フォーマット](detailed/export-format.md)・[出力の解釈方法](detailed/ai-format-guide.md)・[検出ヒューリスティクス](detailed/detection.md)・[エクスポートパイプライン](detailed/export-pipeline.md)）。

## 1. 設計原則

- **`file://` 完結**: ES Modulesを使わず、IIFE＋グローバル名前空間 `window.FileFlow` にモジュールを登録する。`index.html` のスクリプト読み込み順序が依存関係を定義する。
- **関心の分離**: ドメイン層はDOM非依存の純粋ロジックとし、描画はビュー層、統括はUI層、配線はエントリーポイントに寄せる。
- **Single Source of Truth**: ファイル列挙は `Entries.collectFiles` に集約し、ZIP・一覧・統計・エクスポートが同一モデルを参照する。

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
├── export-llm.js   … vcxproj解析 / OKF統合 / CSV・index生成
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
| **export-llm.js** | vcxproj解析・OKF統合・CSV/index生成（旧 `notebookLM` は互換エイリアス）。Globフィルタを尊重 |
| **app.js** | アイコン注入、設定読み書き、全DOMイベントバインド |

## 5. スクリプト読み込み順序

```
1. gridjs.umd.js     … Grid.js (CDN)
2. lib/jszip.min.js   … JSZip (ローカル)
3. js/state.js        … 定数 + ストア
4. js/utils.js        … 汎用ユーティリティ
5. js/core.js         … ドメイン
6. js/actions.js      … アクションシステム
7. js/views.js        … ビュー層
8. js/ui.js           … UI統括 (+ Preview)
9. js/export-llm.js   … LLMエクスポート
10. js/app.js         … エントリーポイント
```

## 6. 主要フロー

- **表示**: Drop → `state.currentRootEntries` → `Render.renderFileList` → ツリー（遅延）/リスト（`Entries.collectFiles`＋チャンク生成）。
- **アクション**: `ActionManager.resolve(mode)` → `execute(entry)`（純粋）→ `ui.applyActionResult` でDOM反映。
- **LLMエクスポート**: スキャン → Glob/拡張子フィルタ → 二重制限で事前割付 → パート単位ストリーミング生成 → index（必要時分割）＋CSV → ZIP。各パートはファイル目次＋ディレクトリサブツリーを持ち単体でも構造が通じる。詳細は [detailed/export-pipeline.md](detailed/export-pipeline.md)。

## 7. 共通規約

- **XSS対策**: 外部由来文字列を `innerHTML` に埋め込む際は必ず `escapeHtml`/`escapeAttr` を通す。可能な箇所は `textContent` を使う。
- **設定の永続化**: `localStorage['FileFlowSettings']` にJSONで保存。旧キー（例: `notebookLMConfig`）からは自動移行する。
- **テスト方針**: コアロジック（Glob、文字コード検出、アクション、ユーティリティ、LLMエクスポートの分割・CSV・内部関数）を `test/test_runner.js` で検証し、`test/test.html`（ブラウザ）と `test/run_tests.js`（Node.js CLI）の両方で実行する。DOMParser を要するXML解析テストはブラウザでのみ実行し、Node.js ではスキップする。
