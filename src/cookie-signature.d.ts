// EPIC #2310 / Issue #2353: cookie-signature OSS は @types がない (TypeScript declaration なし)。
// ADR-0050 で採用済み + 公式 README 通りの sign/unsign 2 関数 API のため簡易宣言で十分。
declare module 'cookie-signature' {
	export function sign(val: string, secret: string | Buffer): string;
	export function unsign(input: string, secret: string | Buffer): string | false;
	const _default: { sign: typeof sign; unsign: typeof unsign };
	export default _default;
}
