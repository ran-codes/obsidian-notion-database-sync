import { addIcon, Notice, Plugin } from "obsidian";
import { NotionFreezeSettings, DEFAULT_SETTINGS, DatabaseSyncResult } from "./types";
import { NotionFreezeSettingTab } from "./settings";
import { FreezeModal, FrozenDatabase } from "./freeze-modal";
import { createNotionClient, normalizeNotionId } from "./notion-client";
import { freshDatabaseImport, refreshDatabase } from "./database-freezer";

export default class NotionFreezePlugin extends Plugin {
	settings: NotionFreezeSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new NotionFreezeSettingTab(this.app, this));

		addIcon(
			"notion-db-sync",
			`<path d="M54 8 A44 44 0 0 1 92 52" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>` +
			`<path fill="currentColor" d="M96 46 92 58 84 48Z"/>` +
			`<path d="M46 92 A44 44 0 0 1 8 48" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>` +
			`<path fill="currentColor" d="M4 54 8 42 16 52Z"/>` +
			`<path fill="currentColor" d="M34 28v44h8V42l16 30h8V28h-8v30L42 28Z"/>`
		);
		this.addRibbonIcon("notion-db-sync", "Sync Notion database", () => {
			this.openFreezeModal();
		});

		this.addCommand({
			id: "sync-notion",
			name: "Sync Notion database",
			callback: () => this.openFreezeModal(),
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private openFreezeModal(): void {
		if (!this.settings.apiKey) {
			new Notice(
				"Notion sync: please set your API key in settings."
			);
			return;
		}

		new FreezeModal(
			this.app,
			this.settings.defaultOutputFolder,
			(result) => { void this.executeFreshImport(result.notionInput, result.outputFolder); },
			(db) => { void this.executeRefresh(db); }
		).open();
	}

	private async executeFreshImport(
		input: string,
		outputFolder: string
	): Promise<void> {
		try {
			const databaseId = normalizeNotionId(input);
			const client = createNotionClient(this.settings.apiKey);

			const notice = new Notice("Querying database from Notion...", 0);
			const result = await freshDatabaseImport(
				this.app,
				client,
				databaseId,
				outputFolder,
				(progress) => {
					switch (progress.phase) {
						case "querying":
							notice.setMessage("Querying database from Notion...");
							break;
						case "importing":
							notice.setMessage(
								`Importing ${progress.current} / ${progress.total} entries...`
							);
							break;
						case "done":
							notice.hide();
							break;
					}
				}
			);
			notice.hide();
			new Notice(formatDatabaseResult(result.title, result, "imported"));
		} catch (err) {
			console.error("Notion sync error:", err);
			new Notice(
				`Notion sync error: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	private async executeRefresh(db: FrozenDatabase): Promise<void> {
		try {
			const client = createNotionClient(this.settings.apiKey);

			const notice = new Notice(`Querying "${db.title}" from Notion...`, 0);
			const result = await refreshDatabase(
				this.app,
				client,
				db,
				(progress) => {
					switch (progress.phase) {
						case "querying":
							notice.setMessage(`Querying "${db.title}" from Notion...`);
							break;
						case "diffing":
							notice.setMessage("Checking against current freeze dates...");
							break;
						case "detected":
							new Notice(
								`Detected ${progress.staleCount} of ${progress.total} entries out of date`,
								5000
							);
							break;
						case "importing":
							notice.setMessage(
								`Refreshing ${progress.current} / ${progress.total} entries...`
							);
							break;
						case "done":
							notice.hide();
							break;
					}
				}
			);
			notice.hide();
			new Notice(formatDatabaseResult(result.title, result, "re-synced"));
		} catch (err) {
			console.error("Notion sync error:", err);
			new Notice(
				`Notion sync error: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
}

function formatDatabaseResult(
	title: string,
	result: DatabaseSyncResult,
	verb: string
): string {
	let msg =
		`Notion sync: "${title}" ${verb}. ` +
		`${result.created} created, ${result.updated} updated, ` +
		`${result.skipped} unchanged, ${result.deleted} deleted`;
	if (result.failed > 0) {
		msg += `, ${result.failed} failed`;
	}
	msg += ".";
	if (result.errors.length > 0) {
		msg += "\nErrors:\n" + result.errors.join("\n");
	}
	return msg;
}
