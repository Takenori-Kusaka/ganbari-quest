// src/lib/domain/constants/notification.ts
// プッシュ通知の配信量に関する定数 (#4664)。
//
// 値がサービス層 (notification-service.ts) の private const に閉じていたため、
// 設定画面やページガイドが「1 日 3 件まで」を数値直書きで書くか、書かずに黙るかの
// 二択になっていた。domain 層に出して server / UI / ガイドが同じ値を引く。

/** 1 テナントあたり 1 日に送るプッシュ通知の上限件数 */
export const MAX_DAILY_NOTIFICATIONS = 3;

/**
 * 達成通知 (きろく完了 / レベルアップ) の 1 日の上限件数 (#4706 PO 決裁 2026-10-08)。
 *
 * 全種別共通の `MAX_DAILY_NOTIFICATIONS` だけだと、朝の達成通知が枠を使い切り、夜のストリーク警告と
 * 朝のリマインダーが届かない。達成通知だけ別に絞ることで、全体 3 通のうち少なくとも 2 通
 * (リマインダー + ストリーク警告) を達成通知に押し出されない枠として残す。
 */
export const MAX_DAILY_ACHIEVEMENT_NOTIFICATIONS = 1;

/** 達成通知として数える `notification_type` (`sendAchievementNotification` が送る 2 種) */
export const ACHIEVEMENT_NOTIFICATION_TYPES = ['achievement', 'level_up'] as const;

/** サイレント時間帯の既定 (JST、HH:MM)。開始 > 終了 のラップアラウンドを許す */
export const DEFAULT_QUIET_START = '21:00';
/** @see DEFAULT_QUIET_START */
export const DEFAULT_QUIET_END = '07:00';
