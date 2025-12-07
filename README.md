# Folder Viewer

フォルダ構造を可視化し、一括処理（拡張子付与など）を行ってZIP化するツール。
クライアントサイド(JS)のみで完結し、オフラインで安全に動作します。

## 主な仕様

*   **処理モード**: ファイルに対して `.md` または `.txt` 拡張子を付与（テキストファイル判定ロジックに基づく）。
*   **テキスト判定**: 以下を対象とする。
    *   `text/` で始まるMIMEタイプ
    *   **拡張子のないファイル**
    *   **対応拡張子一覧**:
        *   **Web/Data**: `.html`, `.css`, `.js`, `.ts`, `.tsx`, `.jsx`, `.json`, `.xml`, `.yml`, `.yaml`, `.csv`
        *   **C/C++**: `.c`, `.cpp`, `.h`, `.hpp`, `.cc`, `.cxx`
        *   **Code**: `.py`, `.java`, `.rb`, `.php`, `.sql`
        *   **Config/System**: `.sh`, `.bat`, `.log`, `.toml`, `.ini`, `.cfg`, `.conf`
        *   **Doc**: `.txt`, `.md`
*   **ZIP出力**: 
    *   単一フォルダ時は「フォルダ名.zip」
    *   複数時は「files.zip」
*   **設定**: ドットファイル（`.git`等）の除外（デフォルトON）。

## セットアップ（初回のみ）

外部ライブラリ(`jszip`)をローカルに配置するため、以下を実行してください。

```bash
sh setup.sh
```

## 技術スタック
*   HTML / CSS / Vanilla JS
*   JSZip (Local)
