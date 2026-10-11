import { createECDH } from 'node:crypto';

/**
 * Web Push の VAPID 鍵 (#4706)。
 *
 * 公開鍵は P-256 の非圧縮点 (65 byte = base64url 87 文字)、秘密鍵はスカラー (32 byte = 43 文字)。
 * 形式だけでなく **秘密鍵から導いた公開鍵が一致すること**まで確かめる。片方だけ作り直すと、
 * 購読は旧公開鍵で作られ JWT は新秘密鍵で署名されるため、push サービスが送信のたびに 401/403 を返す。
 * 401/403 は 410/404 と違って購読を消さないので、失敗が毎日続くのに cron は 200 のままになる。
 */
export function isVapidKeyPair(publicKey: string, privateKey: string): boolean {
	if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) {
		return false;
	}
	try {
		const ecdh = createECDH('prime256v1');
		ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
		return ecdh.getPublicKey('base64url') === publicKey;
	} catch {
		// 0 や曲線の位数以上など、P-256 の秘密鍵として無効な値
		return false;
	}
}
