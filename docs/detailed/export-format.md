# LLMエクスポート形式 — OKF v0.2

準拠対象は [Open Knowledge Format Specification v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)。出力はUTF-8 Markdownと補助CSVを含むZIP。OKFの文書構造・来歴を表現するもので、入力先がリンクを自動参照することや回答精度を保証するものではない。

## ファイル構成

```text
index.md                         # ルートのリンク付き目次
codebase.md                      # 全体概要・集計・ファイル明細
index_files_002_of_N.md           # 明細が大きい場合の続き
<root>_src_001_of_003.md           # ソース本文パート
<root>_src_002_of_003.md
<root>_src_003_of_003.md
target_files_list.csv             # 本文出力に成功したファイル
export_report.csv                # 成功・除外・失敗の記録
folder_structure.csv             # folder_structureモード
vcxproj_list.csv                  # vcxprojモード
```

CSVも推定語数上限で分割することがあり、その場合は連番名となる。モード別CSVはいずれかを出力する。

## ルート目次

予約ファイル `index.md` は概念文書ではなく、各文書へのMarkdownリンクと短い説明を持つ目次。frontmatterは次のバージョン宣言だけとし、`type` や集計値を入れない。

```yaml
---
okf_version: "0.2"
---
```

概要・ファイル明細とソースコードのグループに分ける。リンク先は実際の生成ファイル名から作り、特殊文字をURLエンコードする。

## 概念文書のfrontmatter

`codebase.md` は `type: codebase_overview`、後続明細は `codebase_index_shard`、本文は `codebase_export`。これらはFileFlowが定義するカスタム型。例:

```yaml
---
type: "codebase_export"
title: "example — Source Code (Part 1/3)"
description: "Source code with original paths and file boundaries."
tags: ["codebase", "source-code"]
generated: {"by":"process:fileflow-export","at":"2026-10-08T00:00:00.000Z"}
sources: [{"resource":"Local input file: src/main.js","title":"src/main.js","last_modified":"2026-10-07T00:00:00.000Z"}]
export_mode: "folder_structure"
part_number: 1
total_parts: 3
file_count: 12
total_size_bytes: 32768
entry_points: ["src/main.js"]
---
```

シリアライズにはJSON互換の引用符・配列・オブジェクトを使い、引用符やバックスラッシュを含むパスでも有効なYAMLにする。`generated.at` は生成全体で共通。`sources.resource` の `Local input file: ...` は入力スナップショット内の範囲記述であり、ZIP内のファイルへのリンクではない。本文はパート内に埋め込まれる。ファイル更新日時が取得できた場合だけ `last_modified` を記録する。

概要の入力元は `Local directory snapshot: ...`、明細シャードの入力元は `/codebase.md`。独立検証を実施していないため `verified` は出力しない。旧独自フィールド `format_version: "1.0-okf"` と `generated_at` は使用しない。

## 本文パート

- 全体目次・概要へのリンク、当パートのファイル目次とディレクトリサブツリーを持つ。
- サブツリーは300行までとし、打ち切りを明示する。全パートマップは32パート以下の場合に掲載する。
- 各ファイルは `## File:` 見出し、ルート相対パス等のYAMLメタデータ、言語別コードフェンス、パス付き末尾フッターで囲む。
- ファイルメタデータは `path`、`folder`、`extension`、`size_bytes`、必要に応じて `project`、`filter`、`chunk`。容量は元ファイルの値。
- 本文内のフェンスより長いフェンスを使う。分割されたファイルには `(split k/n)` を付け、断片の順序を示す。
- `entry_points` はファイル名等に基づく候補であり、実際の起動経路を解析・証明した情報ではない。

## 全体概要・明細

`codebase.md` に全体の対象数・成功数・未出力数、プロジェクト情報、ディレクトリ集計、本文パートへのリンク、ファイル別状態と所属パートを記録する。明細が大きい場合は行単位で `index_files_*` に分割する。分割ファイルは複数パートに対応する。

`exported_text_files` と対象CSVは実際に本文へ出力できたファイルだけを数える。未出力の理由は `export_report.csv` を参照する。`non-target` を一律にバイナリと解釈しない。全対象が読み取り失敗した場合も概要・レポートを出力する。

## 分割・検証

現行設定はパート容量（既定4MiB）、元ファイル件数（既定1000）、推定語数（50万未満）のうち厳しい条件で分割する。単一ファイル上限は既定1MiBで、超過ファイルは除外する。UIや保存済み設定の詳細は [export-pipeline.md](export-pipeline.md)。

完成した本文・概要・明細・ルート目次についてBOM込みバイト数と推定語数を確認する。本文は異なる元ファイルの件数も検証する。CSVは推定語数で分割し、パート容量設定は適用しない。ヘッダーや単一索引行など分割できない構造が上限を超える場合は明示的なエラーになる。

語数は空白区切り語数とCJK文字数からの推定で、トークン数ではなく、外部サービスのカウントとも同一ではない。OKF概念文書は `.md` 固定。通常のファイル操作としての「Add .txt」は別機能。

利用手順は [ai-format-guide.md](ai-format-guide.md)、今後の設定見直しは [改善計画](../llm-export-improvements.md) を参照。
