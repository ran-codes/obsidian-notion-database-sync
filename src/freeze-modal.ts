import { App, Modal, Notice, Setting, TFile } from "obsidian";

export interface FreezeModalResult {
	notionInput: string;
	outputFolder: string;
}

export interface FrozenDatabase {
	databaseId: string;
	title: string;
	folderPath: string;
	entryCount: number;
}

export class FreezeModal extends Modal {
	private notionInput = "";
	private outputFolder: string;
	private onFreeze: (result: FreezeModalResult) => void;
	private onResync: (db: FrozenDatabase) => void;

	constructor(
		app: App,
		defaultFolder: string,
		onFreeze: (result: FreezeModalResult) => void,
		onResync: (db: FrozenDatabase) => void
	) {
		super(app);
		this.outputFolder = defaultFolder;
		this.onFreeze = onFreeze;
		this.onResync = onResync;
	}

	onOpen(): void {
		const { contentEl } = this;

		// --- Freeze section ---
		contentEl.createEl("h2", { text: "Sync Notion content" });

		new Setting(contentEl)
			.setName("Page or database ID")
			.setDesc(
				"Paste a Notion page/database ID, UUID, or full URL."
			)
			.addText((text) =>
				text
					.setPlaceholder("https://notion.so/... or abc123...")
					.onChange((value) => {
						this.notionInput = value.trim();
					})
					.then((t) => {
						t.inputEl.addClass("notion-sync-input-wide");
					})
			);

		new Setting(contentEl)
			.setName("Output folder")
			.setDesc("Vault folder to save frozen content.")
			.addText((text) =>
				text
					.setValue(this.outputFolder)
					.onChange((value) => {
						this.outputFolder = value.trim();
					})
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Sync")
				.setCta()
				.onClick(() => {
					if (!this.notionInput) return;
					this.close();
					this.onFreeze({
						notionInput: this.notionInput,
						outputFolder: this.outputFolder,
					});
				})
		);

		// --- Frozen databases section ---
		const databases = this.scanFrozenDatabases();
		if (databases.length > 0) {
			contentEl.createEl("hr");
			contentEl.createEl("h3", { text: "Synced databases" });

			for (const db of databases) {
				new Setting(contentEl)
					.setName(db.title)
					.setDesc(
						`${db.folderPath}  \u00b7  ${db.entryCount} ${db.entryCount === 1 ? "entry" : "entries"}`
					)
					.addButton((btn) =>
						btn.setButtonText("View").onClick(() => {
							this.close();
							this.openBaseFile(db);
						})
					)
					.addButton((btn) =>
						btn.setButtonText("Re-sync").onClick(() => {
							this.close();
							this.onResync(db);
						})
					);
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private openBaseFile(db: FrozenDatabase): void {
		// Find .base file in the database folder
		const folder = this.app.vault.getAbstractFileByPath(db.folderPath);
		if (!folder) {
			new Notice(`Notion Sync: Folder not found: ${db.folderPath}`);
			return;
		}

		// Look for any .base file in the folder
		const baseFile = this.app.vault.getFiles().find(
			(f) => f.extension === "base" && f.parent?.path === db.folderPath
		);

		if (baseFile) {
			this.app.workspace.getLeaf("tab").openFile(baseFile);
		} else {
			new Notice(`Notion Sync: No .base file found in ${db.folderPath}`);
		}
	}

	private scanFrozenDatabases(): FrozenDatabase[] {
		const dbMap = new Map<string, FrozenDatabase>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			const dbId = cache?.frontmatter?.["notion-database-id"];
			if (!dbId) continue;

			const existing = dbMap.get(dbId);
			if (existing) {
				existing.entryCount++;
			} else {
				const folderPath = file.parent?.path || "";
				dbMap.set(dbId, {
					databaseId: dbId,
					title: folderName(folderPath),
					folderPath,
					entryCount: 1,
				});
			}
		}

		return Array.from(dbMap.values()).sort((a, b) =>
			a.title.localeCompare(b.title)
		);
	}
}

function folderName(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx >= 0 ? path.slice(idx + 1) : path || "Untitled";
}
