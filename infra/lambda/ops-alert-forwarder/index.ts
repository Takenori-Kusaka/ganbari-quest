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
 */

import * as http from 'node:http';
import * as https from 'node:https';
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

async function postDiscordEmbed(embed: object): Promise<void> {
	if (!DISCORD_WEBHOOK_URL) {
		// ここに来るのは deploy gate をすり抜けた場合のみ。**握り潰さず error で残す**
		// (#4119 / #4174 の「通知経路はあるのに 0 通」を再演しない)。
		console.error('[ops-alert] DISCORD_WEBHOOK_INCIDENT が未設定のため通知できません');
		return;
	}

	try {
		const payload = JSON.stringify({ embeds: [embed] });

		await new Promise<void>((resolve) => {
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
						resolve();
					} else {
						console.error('[ops-alert] Discord webhook failed:', res.statusCode, body);
						resolve(); // 通知失敗で Lambda を落とさない
					}
				});
			});

			req.on('timeout', () => {
				req.destroy();
				console.error('[ops-alert] Discord webhook timed out');
				resolve();
			});

			req.on('error', (err) => {
				console.error('[ops-alert] Discord webhook error:', err);
				resolve();
			});

			req.write(payload);
			req.end();
		});
	} catch (e) {
		console.error('[ops-alert] Discord notification error:', e);
	}
}
