// src/lib/server/db/factory.ts
// DATA_SOURCE 環境変数による SQLite / DynamoDB バックエンド切り替え

import * as dynamoAchievementRepo from './dynamodb/achievement-repo';
import * as dynamoActivityPrefRepo from './dynamodb/activity-pref-repo';
import * as dynamoActivityRepo from './dynamodb/activity-repo';
import * as dynamoAuthRepo from './dynamodb/auth-repo';
import * as dynamoAvatarRepo from './dynamodb/avatar-repo';
import * as dynamoBirthdayRepo from './dynamodb/birthday-repo';
import * as dynamoCareerRepo from './dynamodb/career-repo';
import * as dynamoChecklistRepo from './dynamodb/checklist-repo';
import * as dynamoChildRepo from './dynamodb/child-repo';
import * as dynamoDailyMissionRepo from './dynamodb/daily-mission-repo';
import * as dynamoEvaluationRepo from './dynamodb/evaluation-repo';
import * as dynamoImageRepo from './dynamodb/image-repo';
import * as dynamoLoginBonusRepo from './dynamodb/login-bonus-repo';
import * as dynamoPointRepo from './dynamodb/point-repo';
import * as dynamoSettingsRepo from './dynamodb/settings-repo';
import * as dynamoSpecialRewardRepo from './dynamodb/special-reward-repo';
import * as dynamoStatusRepo from './dynamodb/status-repo';
import * as dynamoStorageRepo from './dynamodb/storage-repo';
import * as dynamoTitleRepo from './dynamodb/title-repo';
import type { IAchievementRepo } from './interfaces/achievement-repo.interface';
import type { IActivityPrefRepo } from './interfaces/activity-pref-repo.interface';
import type { IActivityRepo } from './interfaces/activity-repo.interface';
import type { IAuthRepo } from './interfaces/auth-repo.interface';
import type { IAvatarRepo } from './interfaces/avatar-repo.interface';
import type { IBirthdayRepo } from './interfaces/birthday-repo.interface';
import type { ICareerRepo } from './interfaces/career-repo.interface';
import type { IChecklistRepo } from './interfaces/checklist-repo.interface';
import type { IChildRepo } from './interfaces/child-repo.interface';
import type { IDailyMissionRepo } from './interfaces/daily-mission-repo.interface';
import type { IEvaluationRepo } from './interfaces/evaluation-repo.interface';
import type { IImageRepo } from './interfaces/image-repo.interface';
import type { ILoginBonusRepo } from './interfaces/login-bonus-repo.interface';
import type { IPointRepo } from './interfaces/point-repo.interface';
import type { ISettingsRepo } from './interfaces/settings-repo.interface';
import type { ISpecialRewardRepo } from './interfaces/special-reward-repo.interface';
import type { IStatusRepo } from './interfaces/status-repo.interface';
import type { IStorageRepo } from './interfaces/storage.interface';
import type { ITitleRepo } from './interfaces/title-repo.interface';
import * as sqliteAchievementRepo from './sqlite/achievement-repo';
import * as sqliteActivityPrefRepo from './sqlite/activity-pref-repo';
import * as sqliteActivityRepo from './sqlite/activity-repo';
import * as sqliteAuthRepo from './sqlite/auth-repo';
import * as sqliteAvatarRepo from './sqlite/avatar-repo';
import * as sqliteBirthdayRepo from './sqlite/birthday-repo';
import * as sqliteCareerRepo from './sqlite/career-repo';
import * as sqliteChecklistRepo from './sqlite/checklist-repo';
import * as sqliteChildRepo from './sqlite/child-repo';
import * as sqliteDailyMissionRepo from './sqlite/daily-mission-repo';
import * as sqliteEvaluationRepo from './sqlite/evaluation-repo';
import * as sqliteImageRepo from './sqlite/image-repo';
import * as sqliteLoginBonusRepo from './sqlite/login-bonus-repo';
import * as sqlitePointRepo from './sqlite/point-repo';
import * as sqliteSettingsRepo from './sqlite/settings-repo';
import * as sqliteSpecialRewardRepo from './sqlite/special-reward-repo';
import * as sqliteStatusRepo from './sqlite/status-repo';
import * as sqliteStorageRepo from './sqlite/storage-repo';
import * as sqliteTitleRepo from './sqlite/title-repo';

export interface Repositories {
	auth: IAuthRepo;
	achievement: IAchievementRepo;
	activity: IActivityRepo;
	activityPref: IActivityPrefRepo;
	avatar: IAvatarRepo;
	birthday: IBirthdayRepo;
	career: ICareerRepo;
	checklist: IChecklistRepo;
	child: IChildRepo;
	dailyMission: IDailyMissionRepo;
	evaluation: IEvaluationRepo;
	image: IImageRepo;
	loginBonus: ILoginBonusRepo;
	point: IPointRepo;
	settings: ISettingsRepo;
	specialReward: ISpecialRewardRepo;
	status: IStatusRepo;
	storage: IStorageRepo;
	title: ITitleRepo;
}

let _repos: Repositories | null = null;

export function getRepos(): Repositories {
	if (_repos) return _repos;

	const dataSource = process.env.DATA_SOURCE ?? 'sqlite';
	if (dataSource === 'dynamodb') {
		const repos: Repositories = {
			auth: dynamoAuthRepo,
			achievement: dynamoAchievementRepo,
			activity: dynamoActivityRepo,
			activityPref: dynamoActivityPrefRepo,
			avatar: dynamoAvatarRepo,
			birthday: dynamoBirthdayRepo,
			career: dynamoCareerRepo,
			checklist: dynamoChecklistRepo,
			child: dynamoChildRepo,
			dailyMission: dynamoDailyMissionRepo,
			evaluation: dynamoEvaluationRepo,
			image: dynamoImageRepo,
			loginBonus: dynamoLoginBonusRepo,
			point: dynamoPointRepo,
			settings: dynamoSettingsRepo,
			specialReward: dynamoSpecialRewardRepo,
			status: dynamoStatusRepo,
			storage: dynamoStorageRepo,
			title: dynamoTitleRepo,
		};
		_repos = repos;
		return repos;
	}

	const repos: Repositories = {
		auth: sqliteAuthRepo,
		achievement: sqliteAchievementRepo,
		activity: sqliteActivityRepo,
		activityPref: sqliteActivityPrefRepo,
		avatar: sqliteAvatarRepo,
		birthday: sqliteBirthdayRepo,
		career: sqliteCareerRepo,
		checklist: sqliteChecklistRepo,
		child: sqliteChildRepo,
		dailyMission: sqliteDailyMissionRepo,
		evaluation: sqliteEvaluationRepo,
		image: sqliteImageRepo,
		loginBonus: sqliteLoginBonusRepo,
		point: sqlitePointRepo,
		settings: sqliteSettingsRepo,
		specialReward: sqliteSpecialRewardRepo,
		status: sqliteStatusRepo,
		storage: sqliteStorageRepo,
		title: sqliteTitleRepo,
	};
	_repos = repos;

	return repos;
}
