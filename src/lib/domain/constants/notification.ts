// src/lib/domain/constants/notification.ts
// プッシュ通知の配信量に関する定数 (#4664)。
//
// 値がサービス層 (notification-service.ts) の private const に閉じていたため、
// 設定画面やページガイドが「1 日 3 件まで」を数値直書きで書くか、書かずに黙るかの
// 二択になっていた。domain 層に出して server / UI / ガイドが同じ値を引く。

/** 1 テナントあたり 1 日に送るプッシュ通知の上限件数 */
export const MAX_DAILY_NOTIFICATIONS = 3;

/** サイレント時間帯の既定 (JST、HH:MM)。開始 > 終了 のラップアラウンドを許す */
export const DEFAULT_QUIET_START = '21:00';
/** @see DEFAULT_QUIET_START */
export const DEFAULT_QUIET_END = '07:00';
