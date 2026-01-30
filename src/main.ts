import { addIcon, Notice, Plugin, TFile } from "obsidian";
import { NotionFreezeSettings, DEFAULT_SETTINGS, DatabaseFreezeResult } from "./types";
import { NotionFreezeSettingTab } from "./settings";
import { FreezeModal, FrozenDatabase } from "./freeze-modal";
import {
	createNotionClient,
	normalizeNotionId,
	detectNotionObject,
} from "./notion-client";
import { freezePage } from "./page-freezer";
import { freezeDatabase } from "./database-freezer";

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
			name: "Sync Notion page or database",
			callback: () => this.openFreezeModal(),
		});

		this.addCommand({
			id: "resync-notion",
			name: "Re-sync this page",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const notionId = cache?.frontmatter?.["notion-id"];
				if (!notionId) return false;
				if (!checking) {
					this.executeRefreeze(file);
				}
				return true;
			},
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
				"Notion Sync: Please set your API key in Settings → Notion Database Sync."
			);
			return;
		}

		new FreezeModal(
			this.app,
			this.settings.defaultOutputFolder,
			(result) => this.executeFreeze(result.notionInput, result.outputFolder),
			(db) => this.executeResyncDatabase(db)
		).open();
	}

	private async executeFreeze(
		input: string,
		outputFolder: string
	): Promise<void> {
		try {
			const notionId = normalizeNotionId(input);
			const client = createNotionClient(this.settings.apiKey);

			new Notice("Notion Sync: Detecting content type...");

			const detection = await detectNotionObject(client, notionId);

			if (detection.type === "page") {
				new Notice("Notion Sync: Syncing page...");
				const result = await freezePage(this.app, {
					client,
					notionId,
					outputFolder,
				});
				new Notice(
					`Notion Sync: Page "${result.title}" ${result.status}.`
				);
			} else {
				const notice = new Notice("Notion Sync: Syncing database...", 0);
				const result = await freezeDatabase(
					this.app,
					{ client, notionId, outputFolder },
					(current, total, title) => {
						notice.setMessage(
							`Notion Sync: "${title}" ${current} / ${total} entries`
						);
					}
				);
				notice.hide();
				new Notice(
					formatDatabaseResult(result.title, result, "done")
				);
			}
		} catch (err) {
			console.error("Notion Sync error:", err);
			new Notice(
				`Notion Sync error: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	private async executeResyncDatabase(db: FrozenDatabase): Promise<void> {
		try {
			const notice = new Notice(`Notion Sync: Re-syncing "${db.title}"...`, 0);
			const client = createNotionClient(this.settings.apiKey);
			const result = await freezeDatabase(
				this.app,
				{
					client,
					notionId: db.databaseId,
					outputFolder: getParentPath(db.folderPath),
				},
				(current, total, title) => {
					notice.setMessage(
						`Notion Sync: "${title}" ${current} / ${total} entries`
					);
				}
			);
			notice.hide();
			new Notice(
				formatDatabaseResult(result.title, result, "re-synced")
			);
		} catch (err) {
			console.error("Notion Sync resync error:", err);
			new Notice(
				`Notion Sync error: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	private async executeRefreeze(file: TFile): Promise<void> {
		if (!this.settings.apiKey) {
			new Notice(
				"Notion Sync: Please set your API key in Settings → Notion Database Sync."
			);
			return;
		}

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			const notionId = cache?.frontmatter?.["notion-id"];
			const databaseId = cache?.frontmatter?.["notion-database-id"];

			if (!notionId) {
				new Notice("Notion Sync: No notion-id found in frontmatter.");
				return;
			}

			const client = createNotionClient(this.settings.apiKey);

			if (databaseId) {
				// Re-sync entire database
				const notice = new Notice("Notion Sync: Re-syncing database...", 0);
				const parentFolder = file.parent?.path || this.settings.defaultOutputFolder;
				const result = await freezeDatabase(
					this.app,
					{
						client,
						notionId: databaseId,
						// Use the parent of the parent folder (since database entries are in DatabaseTitle/)
						outputFolder: getParentPath(parentFolder),
					},
					(current, total, title) => {
						notice.setMessage(
							`Notion Sync: "${title}" ${current} / ${total} entries`
						);
					}
				);
				notice.hide();
				new Notice(
					formatDatabaseResult(result.title, result, "re-synced")
				);
			} else {
				// Re-sync single page
				new Notice("Notion Sync: Re-syncing page...");
				const parentFolder = file.parent?.path || this.settings.defaultOutputFolder;
				const result = await freezePage(this.app, {
					client,
					notionId,
					outputFolder: parentFolder,
				});
				new Notice(
					`Notion Sync: Page "${result.title}" ${result.status}.`
				);
			}
		} catch (err) {
			console.error("Notion Sync error:", err);
			new Notice(
				`Notion Sync error: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
}

function getParentPath(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx > 0 ? path.slice(0, idx) : "";
}

function formatDatabaseResult(
	title: string,
	result: DatabaseFreezeResult,
	verb: string
): string {
	let msg =
		`Notion Sync: "${title}" ${verb}. ` +
		`${result.created} created, ${result.updated} updated, ` +
		`${result.skipped} skipped, ${result.deleted} deleted`;
	if (result.failed > 0) {
		msg += `, ${result.failed} failed`;
	}
	msg += ".";
	if (result.errors.length > 0) {
		msg += "\nErrors:\n" + result.errors.join("\n");
	}
	return msg;
}
