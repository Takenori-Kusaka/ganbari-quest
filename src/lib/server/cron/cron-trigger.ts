// src/lib/server/cron/cron-trigger.ts
// #4338: cron endpoint の呼び出しが「定時実行」か「人の手」かを見分けるための marker。
//
// ## なぜ認証ヘッダで見分けないか
//
// `verifyCronAuth` (src/lib/server/auth/cron-auth.ts) は `x-cron-secret` と
// `Authorization: Bearer` を**同等に**受理し、CRON_SECRET / OPS_SECRET_KEY も同等に扱う。
// つまり認証ヘッダの種類も secret の種類も、人と機械の区別には一切使えない。
// 運用者が curl で `Authorization: Bearer $CRON_SECRET` を送れば dispatcher と同一になる。
//
// ## 見分け方: 自動呼び出し側が「自分は自動である」と名乗る
//
// 自動呼び出しは 2 経路とも我々のコードなので、marker を確実に送れる:
//   - AWS: infra/lambda/cron-dispatcher/index.ts  (EventBridge → dispatcher → Function URL)
//   - NUC: scripts/scheduler.ts                   (node-cron → APP_URL)
//
// ## 既定を「手動」にする理由 (向きを逆にしない)
//
// marker を送り忘れた自動実行は「人がやった」と記録される (過検知)。
// 逆に「marker が無ければ自動」にすると、人が手で叩いた実行が「定時実行」として記録され、
// 記録から人の判断による削除を消してしまう — これは #4338 の決裁で明示的に却下された状態である。
// 記録の目的が「いつ・どの経路で消えたか」を後から答えることである以上、安全側は手動。

/** 自動 (スケジューラ) 呼び出しであることを名乗るヘッダ名。 */
export const CRON_TRIGGER_HEADER = 'x-cron-trigger';

/** 上記ヘッダの値。これ以外 (欠落を含む) は手動扱いになる。 */
export const CRON_TRIGGER_SCHEDULED = 'scheduled';

/**
 * リクエストが自動 (スケジューラ) 由来かどうか。
 * marker が無い / 値が違う場合は false = 手動扱い (上記「既定を手動にする理由」参照)。
 */
export function isScheduledCronTrigger(request: Request): boolean {
	return request.headers.get(CRON_TRIGGER_HEADER) === CRON_TRIGGER_SCHEDULED;
}
