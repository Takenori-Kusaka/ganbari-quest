// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/certificates。置き場所の規則は docs/DESIGN.md §6
import { adminScreenHeading } from '../admin-screens';
import { CERTIFICATE_TERMS, PLAN_FULL_TERMS } from '../terms';
import { APP_LABELS } from './common';

// #4674: PAGE_GUIDE_LABELS.adminCertificates が印刷 / シェアのボタン名を参照するため同様に前置きする
export const CERTIFICATE_DETAIL_LABELS = {
	pageTitle: CERTIFICATE_TERMS.full,
	backLink: '一覧に戻る',
	previewTitle: `📜 ${CERTIFICATE_TERMS.canonical}プレビュー`,
	printButton: '🖨️ 印刷 / PDF保存',
	pdfUpgradeNote: 'PDF保存はスタンダードプラン以上',
	upgradeLink: 'アップグレード',
	shareCardTitle: '🎉 がんばりカード',
	shareCardDesc: '達成を画像でダウンロードして、LINEやSNSでシェアできます',
	downloadButton: '📥 画像をダウンロード',
	closeButton: '閉じる',
	showShareCardButton: '🎉 シェアカードを表示',
	// #4512: シェアカード生成 (canvas) / ダウンロード結果の文言を SSOT へ集約
	shareCardBrandText: APP_LABELS.name,
	downloadSuccess: 'ダウンロードしました！',
	downloadFailed: 'ダウンロードに失敗しました',
	certificateNotFound: `${CERTIFICATE_TERMS.canonical}が見つかりません`,
} as const;

export const CERTIFICATES_PAGE_LABELS = {
	pageTitle: adminScreenHeading('certificates'),
	backToReportsLink: 'レポートへ',
	freePlanNotePrefix: `${PLAN_FULL_TERMS.free}では${CERTIFICATE_TERMS.canonical}の閲覧のみ可能です。PDF保存は`,
	freePlanNoteLink: `${PLAN_FULL_TERMS.standard}以上`,
	freePlanNoteSuffix: 'で利用できます。',
	emptyTitle: `まだ${CERTIFICATE_TERMS.canonical}がありません`,
	emptyDesc: `活動を記録すると、節目を達成したときに${CERTIFICATE_TERMS.canonical}が発行されます`,
	noChildrenTitle: '子供が登録されていません',
	// #4674 F5: カテゴリ見出しは page 直書きをやめて本 SSOT に集約 (ガイド文言も同じ値を引く)。
	// short はカード上のバッジ表記 (子供にも読めるひらがな)。
	categoryStreak: '🔥 連続記録',
	categoryLevel: '🌟 レベルアップ',
	categoryMonthly: '📜 月間がんばり',
	categoryMaster: '🎓 カテゴリマスター',
	categoryAnnual: '🏆 年間がんばり大賞',
	categoryShortStreak: 'れんぞく',
	categoryShortLevel: 'レベル',
	categoryShortMonthly: 'がつかん',
	categoryShortMaster: 'マスター',
	categoryShortAnnual: 'ねんかん',
} as const;
