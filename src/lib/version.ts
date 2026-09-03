// アプリ版数。値は vite.config.ts の `define` がビルドのたびに埋め込む (生成物はコミットしない)。
// 形は `v{major}.{YYYYMMDD}.0` (#0180 日付ベースバージョニング)。設定 > サポート / /api/health / /api/ready が表示する。
// 旧実装 (`prebuild` が本ファイルを書き換える) は build のたびに PR へ版数 diff を混ぜていた (PO 回答 2026-09-03)。

export const APP_VERSION: string = __APP_VERSION__;
export const APP_VERSION_DATE: string = __APP_VERSION_DATE__;
