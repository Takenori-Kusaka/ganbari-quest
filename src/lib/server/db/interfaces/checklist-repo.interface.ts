import type {
	ChecklistLog,
	ChecklistOverride,
	ChecklistTemplate,
	ChecklistTemplateItem,
	InsertChecklistOverrideInput,
	InsertChecklistTemplateInput,
	InsertChecklistTemplateItemInput,
	UpdateChecklistTemplateInput,
	UpsertChecklistLogInput,
} from '../types';

export interface IChecklistRepo {
	// Templates
	findTemplatesByChild(
		childId: number,
		tenantId: string,
		includeInactive?: boolean,
	): Promise<ChecklistTemplate[]>;
	findTemplateById(id: number, tenantId: string): Promise<ChecklistTemplate | undefined>;
	insertTemplate(input: InsertChecklistTemplateInput, tenantId: string): Promise<ChecklistTemplate>;
	updateTemplate(
		id: number,
		input: UpdateChecklistTemplateInput,
		tenantId: string,
	): Promise<ChecklistTemplate | undefined>;
	deleteTemplate(id: number, tenantId: string): Promise<void>;

	// Template items
	findTemplateItems(templateId: number, tenantId: string): Promise<ChecklistTemplateItem[]>;
	insertTemplateItem(
		input: InsertChecklistTemplateItemInput,
		tenantId: string,
	): Promise<ChecklistTemplateItem>;
	deleteTemplateItem(id: number, tenantId: string): Promise<void>;

	// Logs
	findTodayLog(
		childId: number,
		templateId: number,
		date: string,
		tenantId: string,
	): Promise<ChecklistLog | undefined>;
	upsertLog(input: UpsertChecklistLogInput, tenantId: string): Promise<ChecklistLog>;

	// Overrides
	findOverrides(childId: number, date: string, tenantId: string): Promise<ChecklistOverride[]>;
	insertOverride(input: InsertChecklistOverrideInput, tenantId: string): Promise<ChecklistOverride>;
	deleteOverride(id: number, tenantId: string): Promise<void>;

	// Tenant bulk deletion
	deleteByTenantId(tenantId: string): Promise<void>;
}
