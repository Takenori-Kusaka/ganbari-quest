/**
 * infra/lambda/ops-alert-forwarder/index.ts
 *
 * #4189 — SNS topic `ganbari-quest-ops-alerts` に届いた CloudWatch アラームを Discord へ転送する。
 *
 * ## なぜ Lambda を挟むのか
 *
 * メール subscription をやめ Discord に寄せる。**既定は届ける**が、恒常発火の是正が進行中の
 * alarm だけは暫定的に抑止したい（通知の総量が捌ける状態を保つため）。SNS の subscription
 * filter でも近いことはできるが、判定根拠（何がどれくらい鳴っていて、どの Issue で直しているか）を
 * コードに残せないため、方針表 (`ops-alert-policy.ts`) を読む Lambda を挟む。
 *
 * ## 落とした通知は「消える」のではなく log に残る
 *
 * `notify: false` の alarm も **CloudWatch 上には alarm として存在し**、本 Lambda の
 * log にも「抑止した」ことが残る。誰にも見えない場所に消えるわけではない。
 *
 * ## 転送失敗は「投げずに数える」(#4399 follow-up)
 *
 * 非 2xx / timeout / socket error のいずれでも **例外を投げず** `resolve()` する。この判断を
 * 選んだ理由:
 *
 *   1. **呼び出し元が SNS の非同期呼び出しで、落として得るものが無い。** 例外を投げると
 *      Lambda が最大 2 回 自動リトライするが、`handler` は `event.Records` を先頭から順に
 *      処理し冪等性を持たないため、**複数 record のうち後ろだけ失敗した場合に、前の record が
 *      再送されて同じ通知が重複して届く**。障害中に通知が二重に鳴るのは、届かないのとは別種の
 *      「捌けない状態」を作る
 *   2. **失敗の検知を Lambda のリトライ意味論に依存させたくない。** Errors metric に乗せても
 *      「何回目のリトライで諦めたか」は分からず、結局どの失敗が起きたのか (429 / timeout /
 *      webhook 失効) を切り分けられない
 *   3. 一方で **握り潰したままにはしない** — 成否を構造化 log に出し、OpsStack 側の
 *      MetricFilter で metric 化して、失敗は専用 alarm (`ganbari-quest-ops-alert-forward-failed`)
 *      で拾う。「落とさない」と「気付けない」を切り離す
 *
 * 429 に対する retry-after 準拠の再送は、実測 (`GanbariQuest/Ops` の AlertForwardFailed) で
 * 実際に起きることを確かめてから入れる。起きるか分からない再送機構を先に足さない (ADR-0010)。
 */

import * as http from 'node:http';
import * as https from 'node:https';
import {
	formatForwardFailureLog,
	OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM,
	type OpsAlertForwardFailureReason,
} from '../../lib/ops-alert-log-terms';
import { shouldNotifyToDiscord } from '../../lib/ops-alert-policy';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_INCIDENT ?? '';

/** SNS が CloudWatch alarm を配送するときの payload（必要な項目のみ）。 */
interface CloudWatchAlarmMessage {
	AlarmName?: string;
	AlarmDescription?: string | null;
	NewStateValue?: string;
	NewStateReason?: string;
	StateChangeTime?: string;
	Region?: string;
}

interface SnsEventRecord {
	Sns?: { Message?: string; Subject?: string | null };
}

interface SnsEvent {
	Records?: SnsEventRecord[];
}

/** ALARM = 赤 / OK = 緑 / それ以外 = 灰。 */
function colorFor(state: string | undefined): number {
	if (state === 'ALARM') return 0xdc2626;
	if (state === 'OK') return 0x16a34a;
	return 0x9ca3af;
}

export async function handler(event: SnsEvent): Promise<void> {
	const records = event.Records ?? [];

	for (const record of records) {
		const raw = record.Sns?.Message;
		if (!raw) {
			console.warn('[ops-alert] SNS message が空です (skip)');
			continue;
		}

		let message: CloudWatchAlarmMessage;
		try {
			message = JSON.parse(raw) as CloudWatchAlarmMessage;
		} catch {
			// CloudWatch alarm 以外 (AWS Health event 等) も同 topic に来る。
			// 判定できないものは **落とさず** 転送する (未知を握り潰さない)。
			await postDiscordEmbed({
				title: '運用通知',
				description: raw.slice(0, 1800),
				color: colorFor(undefined),
			});
			continue;
		}

		const alarmName = message.AlarmName;
		if (!alarmName) {
			console.warn('[ops-alert] AlarmName が無い message (skip せず転送)');
			await postDiscordEmbed({
				title: '運用通知',
				description: raw.slice(0, 1800),
				color: colorFor(undefined),
			});
			continue;
		}

		if (!shouldNotifyToDiscord(alarmName)) {
			// **抑止したことを log に残す** — 「通知が来ない」と「抑止した」を区別できるようにする。
			console.log(
				`[ops-alert] suppressed alarm=${alarmName} state=${message.NewStateValue ?? '?'} ` +
					'(ops-alert-policy.ts で notify: false。恒常発火の是正が進行中の暫定抑止)',
			);
			continue;
		}

		await postDiscordEmbed({
			title: `${message.NewStateValue === 'OK' ? '復旧' : '異常'}: ${alarmName}`,
			description: message.NewStateReason?.slice(0, 1800) ?? '(理由なし)',
			color: colorFor(message.NewStateValue),
			fields: [
				{ name: 'リージョン', value: message.Region ?? '-', inline: true },
				{ name: '発生時刻', value: message.StateChangeTime ?? '-', inline: true },
			],
		});
	}
}

/**
 * 転送失敗を **metric として数えられる形**で 1 行だけ残す。
 *
 * `reason` 以外 (alarm 名 / 通知本文 / webhook URL) は載せない。`[auth-alert]` 系と同じ規約で、
 * 数えたいのは「届かなかった」ことと、その分類 (対処が分岐する単位) だけである。
 */
function logForwardFailure(reason: OpsAlertForwardFailureReason, detail?: unknown): void {
	// detail (status body / error object) は metric 用の行に混ぜない。混ぜると filter が
	// 本文中の語に反応しうるし、載せる必要のない文字列を CloudWatch に残すことになる。
	//
	// **detail 行には検索語を含めない**。含めると 1 回の失敗が 2 件として数えられ、
	// metric が実態の 2 倍になる (この 2 重計上は test が実測で検出した)。
	console.error(formatForwardFailureLog(reason));
	if (detail !== undefined) console.error('[ops-alert] 転送失敗の詳細:', detail);
}

async function postDiscordEmbed(embed: object): Promise<void> {
	if (!DISCORD_WEBHOOK_URL) {
		// ここに来るのは deploy gate をすり抜けた場合のみ。**握り潰さず error で残す**
		// (#4119 / #4174 の「通知経路はあるのに 0 通」を再演しない)。
		console.error('[ops-alert] DISCORD_WEBHOOK_INCIDENT が未設定のため通知できません');
		logForwardFailure('no-webhook');
		return;
	}

	try {
		const payload = JSON.stringify({ embeds: [embed] });

		await new Promise<void>((resolve) => {
			// 1 回の送信につき **結果は 1 件だけ数える**。
			// `req.destroy()` (timeout 時) は直後に 'error' も発火させるため、素直に書くと
			// 1 回の timeout が timeout + network の 2 件として metric に乗り、
			// 「何通届かなかったか」が実態より多く見える (test が実測で検出した)。
			let settled = false;
			const settle = (
				outcome:
					| { ok: true }
					| { ok: false; reason: OpsAlertForwardFailureReason; detail?: unknown },
			) => {
				if (settled) return;
				settled = true;
				if (outcome.ok) {
					// 成功も数える。1 週間の Sum が「実際に何通届いたか」の実測になる
					// (オーナー決裁 2026-08-07 が一斉 ON の条件にした流入量の観測)。
					console.log(OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM);
				} else {
					logForwardFailure(outcome.reason, outcome.detail);
				}
				resolve(); // 通知失敗で Lambda を落とさない (理由は冒頭コメント)
			};

			const url = new URL(DISCORD_WEBHOOK_URL);
			const isHttps = url.protocol === 'https:';
			const client = isHttps ? https : http;
			const options: https.RequestOptions = {
				hostname: url.hostname,
				port: url.port ? Number(url.port) : isHttps ? 443 : 80,
				path: url.pathname + url.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload),
				},
				timeout: 5_000,
			};

			const req = client.request(options, (res) => {
				let body = '';
				res.on('data', (chunk: Buffer) => {
					body += chunk.toString();
				});
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						settle({ ok: true });
					} else {
						// 429 (channel 単位の rate limit) はここに来る。**16 alarm が同時に鳴る
						// = 最も通知が要る瞬間**ほど起きるため、必ず数える。
						settle({
							ok: false,
							reason: `http-${res.statusCode ?? 0}`,
							detail: body.slice(0, 200),
						});
					}
				});
			});

			req.on('timeout', () => {
				settle({ ok: false, reason: 'timeout' });
				req.destroy(); // destroy が誘発する 'error' は settled 済みなので数えない
			});

			req.on('error', (err) => {
				settle({ ok: false, reason: 'network', detail: err });
			});

			req.write(payload);
			req.end();
		});
	} catch (e) {
		logForwardFailure('exception', e);
	}
}
