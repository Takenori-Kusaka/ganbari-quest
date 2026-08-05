// infra/lib/ops-alert-policy.ts
// #4189 — CloudWatch アラームを Discord に出すかどうかの SSOT。
//
// ## なぜ「既定で鳴らさない」のか（オーナー決裁 2026-08-03、案 B の制約 ②）
//
// > 本番のアラートが常態化していると見逃しかねないので、通知予測として十分効果的で
// > あることが認められてから届くように設定しましょうね
//
// 鳴りっぱなしの通知は「見ない通知」になり、**本物の障害が同じ見た目で埋もれる**。
// そこで通知は **opt-in** にする。
//
//   - `notify: false` … CloudWatch 上には alarm として存在し、コンソール / メトリクスでは見える。
//                       **Discord には出さない**（既定）
//   - `notify: true`  … Discord に出す。**「実際に鳴らして有効だった」根拠を reason に書く**
//
// 昇格の手順は `docs/runbooks/ops-alert-notification.md` を参照。
//
// ## no-silent-gap
//
// OpsStack が作る alarm は**全件がこの表に載っていなければならない**。
// 載っていない alarm が増えたら `tests/unit/infra/ops-alert-policy.test.ts` が fail する
// （宣言を忘れた alarm が「既定で鳴らない」まま誰にも気付かれずに埋もれるのを防ぐ）。

/** alarm 1 件の通知方針。 */
export interface AlarmNotifyPolicy {
	/** Discord に出すか。**既定は false**（有効性が確認できたものだけ true に上げる）。 */
	notify: boolean;
	/**
	 * なぜその判断なのか。
	 *
	 * - `notify: false` … まだ実績が無い / ノイズが想定される、など**現時点で鳴らさない理由**
	 * - `notify: true`  … **鳴らして有効だった根拠**（いつ・何を検知したか）
	 *
	 * 空 / 定型 stub / 極端な短文は CI で弾く（#4237 と同型）。
	 */
	reason: string;
}

/**
 * alarm 名 → 通知方針。**alarm を追加したらここにも 1 行足す**（忘れると CI が落ちる）。
 *
 * 初期値は **全件 `notify: false`**。本番で 1 サイクル観測し、
 * 「鳴った / 鳴らなかった」の実績が付いたものから `true` に上げる。
 */
export const ALARM_NOTIFY_POLICY: Record<string, AlarmNotifyPolicy> = {
	'ganbari-quest-lambda-errors': {
		notify: false,
		reason:
			'本番稼働の実績が無く、平常時に何回鳴るかを観測していない。1 サイクル観測してから昇格する',
	},
	'ganbari-quest-lambda-throttles': {
		notify: false,
		reason: '同時実行 50 に対して throttle 1 回で発火する。平常時のバースト頻度が未計測',
	},
	'ganbari-quest-lambda-duration-p99': {
		notify: false,
		reason: 'cold start を含む p99 10 秒。SSR 初回アクセスで日常的に超える可能性があり未検証',
	},
	'ganbari-quest-lambda-concurrent': {
		notify: false,
		reason: '同時実行 50 は現在の利用規模では到達しない想定。到達時のみ意味を持つため実績待ち',
	},
	'ganbari-quest-lambda-url-5xx': {
		notify: false,
		reason:
			'5xx は本来鳴らすべき筆頭だが、平常時の 0 件を先に確認しないと閾値 5 の妥当性が判断できない',
	},
	'ganbari-quest-lambda-url-4xx-spike': {
		notify: false,
		reason: '4xx は bot / 未認証アクセスで日常的に出る。閾値 50 が実トラフィックで妥当か未計測',
	},
	'ganbari-quest-cloudfront-5xx': {
		notify: false,
		reason: 'geoRestriction(JP) 外からのアクセスが 4xx/5xx に混ざる。平常値の観測が先',
	},
	'ganbari-quest-auth-entitlement-db-unavailable': {
		notify: false,
		reason:
			'log MetricFilter 由来で平常時はデータ点が無い。fail-closed の実発火を 1 度も観測していない',
	},
	'ganbari-quest-cron-dispatcher-errors': {
		notify: false,
		reason: 'cron 失敗は顧客影響が出るまで時間差がある。まず失敗頻度の実績を取る',
	},
	'ganbari-quest-static-assets-s3-4xx': {
		notify: false,
		reason: 'S3 origin offload 有効時のみ生成される。offload 自体が本番未適用で実績ゼロ',
	},
	'ganbari-quest-static-assets-s3-5xx': {
		notify: false,
		reason: '同上。S3 origin offload が本番未適用のため観測データが無い',
	},
};

/** Discord に出す alarm かどうかを判定する（未宣言は「出さない」に倒す = fail-safe）。 */
export function shouldNotifyToDiscord(alarmName: string): boolean {
	return ALARM_NOTIFY_POLICY[alarmName]?.notify === true;
}
