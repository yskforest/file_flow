# 検出ヒューリスティクス詳細 (Detection Details)

[要求仕様書](../requirements.md)・[設計書](../design.md) の補足。文字コード・改行コード推定とテキスト/バイナリ判定の詳細仕様。

## 1. テキスト/バイナリ判定

ファイル先頭 512 バイトに Null バイト（`0x00`）が含まれるかで判定する（UTF-16 を除く）。

## 2. 文字コード推定

ファイル先頭 4KB を `ArrayBuffer` として読み込み、以下のヒューリスティクスで判定する。

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

## 3. 改行コード推定

ファイル先頭 4KB のバイト列を走査し、`CR+LF` / `LF` / `CR` の出現回数を比較する。

| 結果 | 条件 |
|---|---|
| `CRLF` | CR+LF が最多 |
| `LF` | LF が最多 |
| `CR` | CR が最多 |
| `Mixed` | 同数の場合 |
| `None` | 改行なし |

## 4. 一覧表示とエクスポート本文の違い

- 一覧表示・Detect Infoバッジ用の判定（`Detect`、先頭4KBヒューリスティクス）と、LLMエクスポート本文のデコード（UTF-8 strict → Shift_JIS → EUC-JP → UTF-16LE/BE → UTF-8 non-strict の順で試行）は別系統であり、結果が異なる場合がある。
