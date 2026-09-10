import { fail, redirect } from '@sveltejs/kit';
import { childAgeFromBirthDate } from '$lib/domain/child-age';
import { todayDateJST } from '$lib/domain/date-utils';
import { SETUP_CHILDREN_LABELS } from '$lib/domain/labels';
import {
	resolveTrialStartedNoticeEndDate,
	TRIAL_STARTED_QUERY_KEY,
} from '$lib/domain/trial-started-notice';
import { getAuthMode, requireTenantId } from '$lib/server/auth/factory';
import { resolveSetupGateTenantId } from '$lib/server/routing/setup-gate';
import { addChild, getAllChildren } from '$lib/server/services/child-service';
import { trackSetupFunnel } from '$lib/server/services/setup-funnel-service';
import { isSetupRequired, markSetupWizardStarted } from '$lib/server/services/setup-service';
import { getTrialStatus } from '$lib/server/services/trial-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.context) {
		redirect(302, '/auth/login');
	}
	const tenantId = requireTenantId(locals);
	trackSetupFunnel('setup_start', tenantId);
	const children = await getAllChildren(tenantId);
	// 「ホームに戻る」は /switch を指すが、hooks.server.ts のセットアップ誘導は
	// 「子供 0 人なら全 path を /setup へ 302」を掛けており除外リストに /switch が無い
	// (/admin も同様)。つまりセットアップ必須のあいだ、この画面に出せる「出口」は
	// 復元画面 (/admin/settings/data、除外済) だけで、ホームリンクは自分自身に戻る
	// 無反応リンクになる。出口が実在するときだけ出す。
	//
	// #4885 でセットアップ誘導は cognito にも掛かる。判定を実行モードのリテラルで持たず、
	// gate 自身の SSOT (resolveSetupGateTenantId) に問う — 「gate を回すテナントか」が
	// そのまま「/switch が自分自身に戻るか」と一致する (demo は回さないので従来どおり出す)。
	const setupEnforced =
		resolveSetupGateTenantId({ authMode: getAuthMode(), tenantId }) !== undefined &&
		children.length === 0 &&
		(await isSetupRequired(tenantId));
	// PO 決裁 2026-09-10 決定 3(a): #4885 以降、申込経路の顧客はここが事実上の着地画面になる
	// (/admin?trialStarted=1 は setup gate に倒され、admin layout の告知に到達しない)。
	// 旗が立っているときだけ問い合わせる (通常の setup 表示に DB 1 回を足さない)。
	const trialStartedNoticeEndDate = url.searchParams.has(TRIAL_STARTED_QUERY_KEY)
		? resolveTrialStartedNoticeEndDate(url.searchParams, await getTrialStatus(tenantId))
		: null;
	return { children, canReturnHome: !setupEnforced, trialStartedNoticeEndDate };
};

export const actions: Actions = {
	addChild: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const formData = await request.formData();
		const nickname = formData.get('nickname')?.toString().trim();
		const ageStr = formData.get('age')?.toString();
		const theme = formData.get('theme')?.toString() || 'pink';
		// #4718: 誕生日は任意 (admin/children と同じ検証)。入れた子だけ誕生日ボーナスの対象になり、
		// 年齢だけの子は service/repo 層で推定誕生日を合成して保存する (0 歳にならない)。
		const birthDate = formData.get('birthDate')?.toString() || null;

		if (!nickname || nickname.length === 0) {
			return fail(400, { error: SETUP_CHILDREN_LABELS.errorNicknameRequired });
		}
		if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
			return fail(400, { error: SETUP_CHILDREN_LABELS.birthdayInvalidFormat });
		}
		if (birthDate && birthDate > todayDateJST()) {
			return fail(400, { error: SETUP_CHILDREN_LABELS.birthdayInFuture });
		}

		// 誕生日があれば年齢は誕生日から自動計算 (入力欄は disabled で送信されない)。
		// #4718 (QM): 丸めは domain SSOT (childAgeFromBirthDate) に委譲する。生値のままだと
		// 19 歳以上になる誕生日で「年齢は 0〜18 で入力してください」と返るのに、その年齢欄は
		// disabled で直せない = 初回セットアップの行き止まりになる (admin 側は元から丸めていた)。
		const age = birthDate ? childAgeFromBirthDate(birthDate) : Number(ageStr);
		if (Number.isNaN(age) || age < 0 || age > 18) {
			return fail(400, { error: SETUP_CHILDREN_LABELS.errorAgeRange });
		}

		// #0262 / #4419: UI モードは年齢から自動判定する。判定は addChild (service 層) の
		// 責務に統一したので、ここでは渡さず結果を受け取る (route ごとの二重実装を作らない)。
		const child = await addChild(
			{ nickname, age, theme, birthDate: birthDate ?? undefined },
			tenantId,
		);
		trackSetupFunnel('setup_child_registered', tenantId, {
			nickname,
			age,
			uiMode: child.uiMode,
		});
		// ウィザードを歩き始めた印を **この action で** 立てる。
		//
		// ここに置く理由は 2 つある。
		//
		// ① 到達できる唯一の書き込み点である。step 1 の `next` action に置いていたときは
		//    1 度も走らなかった — `addChild` で子供が 1 人できた瞬間に `isSetupRequired` が
		//    false になり、hooks の gate が **次の POST (`?/next`) 自体を** 302 `/` で弾く。
		//    印を立てるコードに到達できないので settings は空のまま、判定は旧条件と数学的に
		//    等価に潰れていた (adversarial reviewer の実測: settings 0 行)。この POST は
		//    子供 0 人の時点で処理されるので gate を通る。
		// ② `load` (GET) ではなく action (POST) に置く。`src/app.html` は
		//    `data-sveltekit-preload-data="hover"` を全ページに掛けているため、load に
		//    書き込みを置くと **リンクにカーソルを載せただけで印が立つ**。「子供を 1 人作った」
		//    という不可逆な出来事にだけ印を紐付ける。
		//
		// 印が立たなくても子供の登録自体は成立させる (ウィザードが進めないだけでデータは入る)。
		await markSetupWizardStarted(tenantId);
		return { success: true };
	},

	next: async ({ locals }) => {
		const tenantId = requireTenantId(locals);
		const children = await getAllChildren(tenantId);
		if (children.length === 0) {
			return fail(400, { error: SETUP_CHILDREN_LABELS.errorNoChildren });
		}
		redirect(302, '/setup/questionnaire');
	},
};
