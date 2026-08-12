// infra/lib/ops-alert-log-terms.ts
// #4399 follow-up — 転送 Lambda が「通知を届けられたか」を log に残すための検索語 SSOT。
//
// ## なぜ要るのか
//
// #4399 で `ALARM_NOTIFY_POLICY` の既定が「届ける」になり、alarm は SNS → 転送 Lambda →
// Discord webhook という一本道を通るようになった。ところが**その一本道の末端が失敗しても
// 誰にも分からない**:
//
//   - 転送 Lambda は非 2xx / timeout / socket error のいずれも `console.error` で握り潰し、
//     例外を投げない (= Lambda の Errors metric に 1 件も乗らない)
//   - Discord webhook は channel 単位の rate limit を持つため、**16 alarm が同時に鳴る
//     「最も通知が必要な瞬間」に 429 が返り、その通知だけが黙って捨てられる**
//
// これは #4119 / #4174 の「経路はあるのに 0 通」と同じ欠陥である。log 本文を唯一の情報源として
// MetricFilter で metric 化し、失敗を alarm で拾えるようにする (entitlement fail-closed #3998 /
// ops-access-denied #4363 と同じ手口)。
//
// ## この定数を lib 側に置く理由
//
// 検索語は **転送 Lambda (書き手) と OpsStack の MetricFilter (読み手) の両方**が使う。
// アプリ側 (`src/`) の log 用語は CDK の tsconfig rootDir 制約で import できず literal +
// drift 検証 test で担保しているが、ここは**どちらも `infra/` 配下**なので同じ定数を
// import できる。literal の二重管理と drift 検証そのものが不要になる (SSOT 1 箇所)。
//
// OpsStack (`ops-stack.ts`) ではなく独立 module に置くのは、Lambda 側が import したときに
// `aws-cdk-lib` を bundle に引き込まないため。
//
// ## 値は載せない
//
// alarm 名・通知本文・webhook URL は載せない (`[auth-alert]` 系の既存規約と同じ)。
// 数えたいのは「届いた / 届かなかった」と、届かなかったときの**分類**だけである。

/** 転送に成功した (Discord が 2xx を返した) ことを表す検索語。流入量の実測にも使う。 */
export const OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM = '[ops-alert] forward-succeeded';

/** 転送に失敗した (通知が人に届かなかった) ことを表す検索語。 */
export const OPS_ALERT_FORWARD_FAILED_LOG_TERM = '[ops-alert] forward-failed';

/**
 * 転送失敗の分類。**対処が分岐する単位**で切る:
 *
 * - `http-<status>` … Discord が応答を返したうえで拒否した。429 = rate limit (同時多発時に起きる)、
 *   401/404 = webhook URL が失効・誤り (再設定が要る)
 * - `timeout` ……… 5 秒以内に応答が無い。Discord 側の輻輳
 * - `network` ……… 接続自体が確立しない。DNS / egress の問題
 * - `no-webhook` … `DISCORD_WEBHOOK_INCIDENT` が未設定。**全通知が最初から 0 通**になる状態で、
 *   deploy gate をすり抜けた場合にだけ起きる (#4119 / #4174 の再演)
 * - `exception` …… 上記以外の想定外例外
 */
export type OpsAlertForwardFailureReason =
	| `http-${number}`
	| 'timeout'
	| 'network'
	| 'no-webhook'
	| 'exception';

/** 失敗 log の 1 行を組み立てる (書き手と test で同じ形を共有するため関数にする)。 */
export function formatForwardFailureLog(reason: OpsAlertForwardFailureReason): string {
	return `${OPS_ALERT_FORWARD_FAILED_LOG_TERM} reason=${reason}`;
}
