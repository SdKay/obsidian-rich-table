import { App, Modal } from 'obsidian';
import { CHANGELOG } from './changelog/generated';
import { t } from './i18n';

/**
 * Whether an upgrade/downgrade just happened AND there's an actual prior
 * version to summarize since — a brand-new install (seenVersion undefined)
 * has nothing to show a changelog "since", so it only silently records the
 * current version as the baseline. Pure so the version-comparison itself
 * doesn't need a Plugin/Modal shim to unit test.
 */
export function shouldShowChangelog(seenVersion: string | undefined, currentVersion: string): boolean {
	return seenVersion !== undefined && seenVersion !== currentVersion;
}

/** Full release history, newest first — see esbuild.config.mjs's
 *  generateChangelogMeta for how CHANGELOG is derived from git tags. */
export class ChangelogModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bt-changelog-modal');
		contentEl.createEl('h2', { text: t('changelogTitle') });

		for (const entry of CHANGELOG) {
			const section = contentEl.createDiv({ cls: 'bt-changelog-entry' });
			section.createEl('h3', { text: `${entry.version} — ${entry.date}` });
			const ul = section.createEl('ul');
			for (const change of entry.changes) ul.createEl('li', { text: change });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
