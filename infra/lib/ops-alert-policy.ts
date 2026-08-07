// infra/lib/ops-alert-policy.ts
// #4189 — CloudWatch アラームを Discord に出すかどうかの SSOT。
//
// ## 既定は「届ける」
//
// alarm を足したら **Discord (incident webhook) に出るのが既定**。監視は「人に届いて初めて監視」で
// あり、届かない alarm は CloudWatch 上に存在するだけで障害の検知には何も寄与しない。
//
// 守りたいのは通知の**総量が捌ける状態**であって、通知そのものではない（オーナー、2026-08-07）。
//
//   > 恒常的に発生する障害は早期回復対象にしたり、常に起きる場合は例外処理を正しくするべき。
//   > 障害の数が多すぎると捌けなくなるよ、という指摘であって、握りつぶしていいという指摘ではない。
//
// したがって**鳴りすぎたときの対処は「通知を止める」ではなく「原因を直す」**である。順に
//
//   1. 例外処理・早期回復を直す（そもそも鳴らなくする）
//   2. それでも平常時に鳴るなら **閾値 / 評価期間を調整する**（何を異常と呼ぶかの定義を直す）
//   3. 1・2 の作業が進行中の間だけ、暫定的に `notify: false` で抑止する
//
// ## `notify: false` にしてよい条件（例外）
//
// **いま恒常発火していて、その原因を直す作業が進行中**の場合に限る。このとき `reason` に書くのは
// 「鳴らさない理由」ではなく、次の 2 点である。
//
//   (a) 何がどれくらいの頻度で鳴っているか（実測）
//   (b) 早期回復 / 例外処理の是正をどの Issue で進めているか（**`#NNNN` 必須**）
//
// **是正 Issue を参照しない `notify: false` は CI が弾く**（`tests/unit/infra/ops-alert-policy.test.ts`）。
// 抑止に必ず出口を持たせ、「暫定」が恒久化するのを防ぐ。
//
// ## no-silent-gap
//
// OpsStack が作る alarm は**全件がこの表に載っていなければならない**。
// 載っていない alarm が増えたら `tests/unit/infra/ops-alert-policy.test.ts` が fail する。
// runtime で未宣言の alarm 名に出くわした場合は**転送する**（判断できないものを黙って捨てない）。
//
// 運用手順は `docs/runbooks/ops-alert-notification.md` を参照。

/** alarm 1 件の通知方針。 */
export interface AlarmNotifyPolicy {
	/** Discord に出すか。**既定は true**（抑止は是正作業中の例外に限る）。 */
	notify: boolean;
	/**
	 * なぜその判断なのか。
	 *
	 * - `notify: true`  … その alarm が鳴いたとき**人が何を知ることになるか**（顧客影響 / 対処の要否）。
	 *   ノイズ懸念に閾値・評価期間で対処した場合はその内容も書く
	 * - `notify: false` … **(a) 何がどれくらいの頻度で鳴っているか** と
	 *   **(b) 是正をどの Issue で進めているか（`#NNNN` 必須）**
	 *
	 * 空 / 定型 stub / 極端な短文は CI で弾く（#4237 と同型）。
	 */
	reason: string;
}

/**
 * alarm 名 → 通知方針。**alarm を追加したらここにも 1 行足す**（忘れると CI が落ちる）。
 *
 * 新規 alarm は `notify: true` で足す。恒常発火が実測され、その是正 Issue を立てたときだけ
 * 一時的に `false` へ落とす。
 */
export const ALARM_NOTIFY_POLICY: Record<string, AlarmNotifyPolicy> = {
	'ganbari-quest-lambda-errors': {
		notify: true,
		reason:
			'アプリ Lambda が 5 分で 3 回以上失敗している = 顧客の画面がエラーになっている。知らずに済ませてよい事象ではない',
	},
	'ganbari-quest-lambda-throttles': {
		notify: true,
		reason:
			'throttle は顧客に 429 / 503 が返っている状態で、同時実行上限の引き上げか原因の除去が要る。1 回でも人が知る必要がある',
	},
	'ganbari-quest-lambda-duration-p99': {
		notify: true,
		reason:
			'p99 10 秒超は SSR が実用的な速度で返せていない状態。cold start の単発スパイクで鳴らないよう、evaluationPeriods 2 / datapointsToAlarm 2（10 分連続）に調整して通知は維持する',
	},
	'ganbari-quest-lambda-concurrent': {
		notify: true,
		reason:
			'同時実行 50 到達は throttle の直前で、到達した時点が上限引き上げを判断する唯一のタイミング。現在の規模では平常時に到達しないためノイズにならない',
	},
	'ganbari-quest-lambda-url-5xx': {
		notify: true,
		reason: '5xx は顧客がサービスを使えていない直接の証拠。届けるべき筆頭であり抑止する理由が無い',
	},
	'ganbari-quest-lambda-url-4xx-spike': {
		notify: true,
		reason:
			'4xx スパイクは認可・ルーティングの破損か攻撃の兆候。bot 由来の平常ノイズで鳴らないよう evaluationPeriods 2 / datapointsToAlarm 2（10 分連続で 5 分あたり 50 回以上）に調整して通知は維持する',
	},
	'ganbari-quest-cloudfront-5xx': {
		notify: true,
		reason:
			'CloudFront 5xx 率 5% 超は配信層で顧客が到達できていない状態。origin 側の alarm では拾えない層のため独立して届ける',
	},
	'ganbari-quest-auth-entitlement-db-unavailable': {
		notify: true,
		reason:
			'entitlement 解決の fail-closed 発火 = DB 障害で有効な Cookie を持つ顧客が軒並み 503 になっている。#3998 で PO がこの trade-off を承認した前提が「起きたら気付けること」であり、届かなければ承認の前提が崩れる',
	},
	'ganbari-quest-grace-period-partial-failure': {
		notify: true,
		reason:
			'猶予期間 cron の部分失敗は課金状態が実態とずれたまま放置される。endpoint 側の sendDiscordAlert と重複しうるが、cron 自体が起動しなかった場合はそちらが出ないため alarm 経路も維持する',
	},
	'ganbari-quest-cron-dispatcher-errors': {
		notify: true,
		reason:
			'cron 失敗は顧客影響が出るまで時間差がある = 失敗した時点で気付ければ影響が出る前に直せる。時間差は抑止の理由ではなく届ける理由',
	},
	'ganbari-quest-ops-access-denied': {
		notify: true,
		reason:
			'/ops への拒否は不審アクセスか正規運営者の締め出しのどちらかで、いずれも人の判断が要る。平常時はデータ点自体が無く（NOT_BREACHING）ノイズにならない',
	},
	'ganbari-quest-ai-provider-unavailable': {
		notify: true,
		reason:
			'オーナー決裁 2026-08-07「AI 不達のアラートは Discord の障害通知へ webhook で飛ばすべき」。(a) AI 不達は有料機能が事実上死んでいる状態で、顧客向け文言が「運営が検知済み」と伝えている以上、人に届かなければその一文が嘘になる。(b) 発生源の log は latch により理由ごとにプロセス内 1 回しか出ないため、構造的に鳴りっぱなしにならない。(c) 万一恒常発火したら通知を止めるのではなく、早期回復 / 例外処理の是正で応じる (同決裁: 恒常的に発生する障害は早期回復対象であって、通知を握りつぶしてよいという意味ではない)',
	},
	'ganbari-quest-static-assets-s3-4xx': {
		notify: true,
		reason:
			'S3 origin の 4xx は deploy 漏れ / 参照ずれで顧客の画面が崩れている状態。offload 有効時のみ生成されるため無効な間は発火しない',
	},
	'ganbari-quest-static-assets-s3-5xx': {
		notify: true,
		reason: 'S3 origin の 5xx は静的配信そのものの障害。4xx と同じく届けないと画面崩れに気付けない',
	},
};

/**
 * Discord に出す alarm かどうかを判定する。
 *
 * **未宣言の alarm は「出す」に倒す** — 宣言漏れは CI（no-silent-gap test）が止める前提であり、
 * runtime まで漏れたものを黙って捨てると #4119 / #4174 の「経路はあるのに 0 通」を再演する。
 */
export function shouldNotifyToDiscord(alarmName: string): boolean {
	return ALARM_NOTIFY_POLICY[alarmName]?.notify !== false;
}
