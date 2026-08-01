# OKF 準拠 統合ソースコード ＆ メタデータ・フォーマット解釈ガイド (Output Format Reference)

本文書は、本ツールによって出力された OKF 準拠統合ソースコードファイル（`*_src_*.md` / `*_src_*.txt`）およびメタデータ CSV ファイルに含まれる構造、記号、メタデータ項目の意味を説明した仕様リファレンスです。

---

## 1. ファイル構成

エクスポート成果物は以下のファイル群で構成されます：

1. **`index.md`**: OKF コードベースインデックス。全ディレクトリ構造テーブル、パート対応表、全ファイル一覧（バイナリ含む）を含む。**LLMに最初に読み込ませるべきファイル。**
2. **`*_src_XXX_of_YYY.md` (または `.txt`)**: 複数ファイルを統合し指定サイズ以下（デフォルト4MB）に分割した OKF 準拠 Markdown ソースコードファイル。
3. **`vcxproj_list.csv`** (vcxproj モード時): 検出された Visual Studio プロジェクト（`.vcxproj`）のビルド定義一覧。
4. **`folder_structure.csv`** (フォルダ構造モード時): ディスク上の物理ディレクトリ構造・深さ・ファイル数・容量一覧。
5. **`target_files_list.csv`**: 統合テキストに含まれる対象全ソースファイルのメタデータ明細テーブル。

---

## 2. 統合ファイル (`*_src_*.md` / `.txt`) の構造と記号の意味

### 2.1 先頭 OKF YAML Frontmatter (`--- ... ---`)

すべての統合ファイルの先頭には、ドキュメント全体を識別するための OKF YAML フロントマターが付与されます。

```yaml
---
type: codebase_export
format_version: "1.0-okf"
title: "Project Name Source Code Export (Part X/Y)"
export_mode: "vcxproj" # または "folder_structure"
part_number: 1
total_parts: 3
file_count: 142
total_size_bytes: 3840120
generated_at: "2026-07-30T09:20:00Z"
entry_points:
  - "src/main.cpp"
---
```

### 2.2 コンパクト File Index ＆ 他パート要約

各パートのヘッダーには以下が含まれます：

- **File Index テーブル**: 当該パートに含まれるファイルのみのMarkdownテーブル（番号、パス、サイズ）
- **Other Parts — Directory Summary**: 他パートのディレクトリ単位集約テーブル（パート番号、ファイル数、主要ディレクトリ）
- **`index.md` 参照**: 全体の完全なファイル一覧は `index.md` を参照するよう案内

> **設計理由**: 全ファイルの一覧を全パートに繰り返し掲載すると、3万ファイル規模で各パートのヘッダーだけで数百KB消費します。パートごとのローカル目次 + ディレクトリ単位要約に簡略化することで、ソースコードに割り当てられる有効容量を最大化しています。

### 2.3 OKF File Block (ファイル境界 ＋ メタデータ ＋ コードフェンス)

各ソースファイルは、ファイル単位の見出し、YAML メタデータブロック、および言語別コードフェンスで明確に包まれます。

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

#### 各要素の意味:
- **`## File: <パス>`**: 対象ファイルのルート相対パスを示す H2 見出し。
- **` ```yaml ... ``` `**: ファイル単位の相対パス、所属フォルダ、帰属プロジェクト、フィルタ、拡張子、容量バイト数。
- **` ```<lang> ... ``` `**: プログラミング言語識別子付きコードフェンス。C/C++/Python 等に含まれる `#include` やコメント行が Markdown 見出しと誤認されるのを防ぎます。

---

## 3. メタデータ CSV のフィールド定義

### 3.1 `vcxproj_list.csv` のフィールド定義 (vcxproj モード)
| カラム名 | 意味・内容 | 例 |
|---|---|---|
| `Project Name` | Visual Studio プロジェクト名 | `TestEngine` |
| `Project Path` | `.vcxproj` ファイルの相対パス | `test_data/vs_project/TestEngine.vcxproj` |
| `Configurations` | ターゲット構成一覧 | `Debug\|x64; Release\|x64` |
| `Sources` | C/C++ ソースファイル数 | `142` |
| `Headers` | ヘッダーファイル数 | `89` |
| `Resources` | リソースファイル数 | `2` |
| `Preprocessor Defines` | プリプロセッサマクロ定義 | `WIN32; _DEBUG; ENGINE_DLL` |
| `Include Directories` | 追加インクルードディレクトリ | `../include; $(SolutionDir)common` |

### 3.2 `folder_structure.csv` のフィールド定義 (フォルダ構造モード)
| カラム名 | 意味・内容 | 例 |
|---|---|---|
| `Folder Path` | 相対フォルダパス | `src/core` |
| `Parent Folder` | 親フォルダ | `src` |
| `Depth` | 階層の深さ | `2` |
| `File Count` | フォルダ直下の対象ファイル数 | `5` |
| `Total Size (Bytes)` | フォルダ直下ファイルの合計サイズ | `45120` |

### 3.3 `target_files_list.csv` のフィールド定義
| カラム名 | 意味・内容 | 例 |
|---|---|---|
| `File Path` | ルートからの相対ファイルパス | `src/core/Engine.cpp` |
| `Project Name` | 帰属するプロジェクト名 | `TestEngine` |
| `Filter Path` | VS仮想フォルダパス | `Source Files/Core` |
| `Size (Bytes)` | ファイルサイズ（バイト） | `15234` |
| `Extension` | ファイル拡張子 | `.cpp` |
