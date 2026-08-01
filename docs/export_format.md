# NotebookLM ＆ LLMエージェント向け OKF 準拠ソースコード統合エクスポート仕様書

## 1. 概要 (Overview)

本機能は、Visual Studio（C/C++/C#）プロジェクトや各種言語（Python, Node.js, Go, Rust, Java 等）のソースコードを、Google Cloud 提唱の **Open Knowledge Format (OKF)** に準拠した構造化 Markdown / テキストファイルとして一括統合エクスポートするための機能です。

### 主な特徴
- **2つの解析モード**:
  - **vcxproj モード**: `.vcxproj` や `.vcxproj.filters` の XML 解析により、ビルド設定 (`Defines`, `IncludeDirs`) と仮想フィルタ構造を保持。
  - **フォルダ構造モード**: ディスク上の実際の物理ディレクトリ階層をアスキー・ディレクトリツリー図としてテキストヘッダーに可視化。
- **自動判別 ＆ 手動選択**: フォルダドロップ時に `.vcxproj` の有無で初期モードを自動決定。プレビューモーダル上でいつでも切り替え可能。
- **OKF 準拠構造化フォーマット**: 最先頭に YAML Frontmatter を配置し、各ファイルブロックを YAML メタデータ ＋ 言語別コードフェンス（` ```cpp `, ` ```python ` 等）で厳密に保護。
- **拡張子選択機能**: 出力形式として `.md` (Markdown) または `.txt` (Text) を選択可能。
- **自由なファイル分割サイズ**: 1MB, 2MB, 4MB (NotebookLM標準), 8MB, 16MB, カスタムMB指定, または一括（分割なし）を選択可能。
- **全パート共通グローバルインデックス**: 複数パートに分割された際にも、全パートのヘッダーに全体のファイル目次 (`[x]` 該当パート / `[ ]` 他パート) を掲載し、LLM が文脈を見失わないよう保護。
- **メタデータ CSV 同梱**: モードに応じて `vcxproj_list.csv` または `folder_structure.csv` と、全対象明細 `target_files_list.csv` を同梱。

---

## 2. 成果物の構成 (Export Artifacts Structure)

エクスポート実行時、以下のファイル群を含む ZIP アーカイブがダウンロードされます。

```
<root_name>_notebooklm_export.zip
├── <root_name>_src_001_of_003.md    # OKF 統合ソースコード Part 1 (拡張子: .md または .txt)
├── <root_name>_src_002_of_003.md    # OKF 統合ソースコード Part 2
├── <root_name>_src_003_of_003.md    # OKF 統合ソースコード Part 3
├── vcxproj_list.csv                  # vcxproj モード時: ビルド定義一覧
├── folder_structure.csv              # フォルダ構造モード時: ディレクトリ階層一覧
└── target_files_list.csv             # 統合テキストに含まれる全対象ファイル一覧
```

---

## 3. OKF 統合ファイル (`.md` / `.txt`) のフォーマット仕様

各統合ファイルは以下のセクションで構成されます。

### 3.1 OKF YAML Frontmatter
ファイル最先頭に配置される、エクスポート全体のメタデータです。

```yaml
---
type: codebase_export
format_version: "1.0-okf"
title: "TestEngine Source Code Export (Part 1/3)"
description: "Consolidated codebase export formatted for NotebookLM and AI agents"
export_mode: "vcxproj"
part_number: 1
total_parts: 3
file_count: 142
total_size_bytes: 3840120
generated_at: "2026-07-30T09:20:00.000Z"
entry_points:
  - "src/main.cpp"
  - "CMakeLists.txt"
---
```

### 3.2 ヘッダーセクション（ディレクトリツリー ＆ グローバル目次）

```markdown
# Project Overview & Structure
- **Root Workspace**: `TestEngine`
- **Export Mode**: `Visual Studio (vcxproj)`
- **Total Project Files**: 420 | **Files in Part 1/3**: 142

## Directory Tree Structure
```
├── src/
│   ├── core/
│   │   ├── Engine.cpp
│   │   └── Parser.cpp
│   └── main.cpp
└── include/
    └── Engine.h
```

## Global File Index (Part 1 of 3)
- [x] 1. `src/main.cpp` [TestEngine] (This Part)
- [x] 2. `src/core/Engine.cpp` [TestEngine] (This Part)
- [ ] 143. `src/utils/Helper.cpp` (Part 2)

---

# Source Code Section
```

### 3.3 ソースコードブロック (OKF File Block)

各ソースファイルは、ファイル単位の H2 見出し、YAML メタデータ、およびコードフェンスで囲まれて出力されます。

```markdown
## File: `src/core/Engine.cpp`

```yaml
path: "src/core/Engine.cpp"
folder: "src/core"
project: "TestEngine"
filter: "Source Files/Core"
extension: ".cpp"
size_bytes: 15234
```

```cpp
#include "Engine.h"

namespace Core {
    Engine::Engine() {}
}
```
```

---

## 4. メタデータ CSV 仕様

### 4.1 `vcxproj_list.csv` (vcxproj モード時)
| カラム名 | 説明 | 例 |
|---|---|---|
| `Project Name` | プロジェクト名 | `TestEngine` |
| `Project Path` | `.vcxproj` の相対パス | `test_data/vs_project/TestEngine.vcxproj` |
| `Configurations` | ターゲット構成の一覧 | `Debug\|x64; Release\|x64` |
| `Sources` | C/C++ ソースファイル数 | `142` |
| `Headers` | ヘッダーファイル数 | `89` |
| `Resources` | リソースファイル数 | `2` |
| `Preprocessor Defines` | プリプロセッサ定義 | `WIN32; _DEBUG; ENGINE_DLL` |
| `Include Directories` | 追加インクルードディレクトリ | `../include; $(SolutionDir)common` |

### 4.2 `folder_structure.csv` (フォルダ構造モード時)
| カラム名 | 説明 | 例 |
|---|---|---|
| `Folder Path` | 相対フォルダパス | `src/core` |
| `Parent Folder` | 親フォルダ | `src` |
| `Depth` | 階層の深さ | `2` |
| `File Count` | フォルダ直下の対象ファイル数 | `5` |
| `Total Size (Bytes)` | フォルダ直下ファイルの合計サイズ | `45120` |

### 4.3 `target_files_list.csv` (統合対象全明細)
| カラム名 | 説明 | 例 |
|---|---|---|
| `File Path` | 相対ファイルパス | `src/core/Engine.cpp` |
| `Project Name` | 帰属プロジェクト名 | `TestEngine` |
| `Filter Path` | VS上の仮想フォルダ（フィルタ）パス | `Source Files/Core` |
| `Size (Bytes)` | ファイルサイズ | `15234` |
| `Extension` | 拡張子 | `.cpp` |

---

## 5. NotebookLM への推薦利用手順

1. エクスポートされた ZIP ファイルを解凍します。
2. NotebookLM のソース追加画面を開きます。
3. 生成された OKF 統合ファイル (`*_src_001_of_XXX.md` または `.txt`) をアップロードします。
4. ディレクトリ構造やプロジェクト定義を確認したい場合は、同梱されている CSV ファイル (`vcxproj_list.csv` または `folder_structure.csv`) も追加ソースとして投入可能です。
