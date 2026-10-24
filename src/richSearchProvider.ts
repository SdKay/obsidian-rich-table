import { extractXlsx, XLSX_EXTENSIONS, XLSX_EXTRACT_VERSION } from './xlsxExtract';
import type { RichSearchProvider } from './richSearchApi';

export interface RichSearchProviderHost {
	/**
	 * Whether this plugin's own file view is the one registered for `.xlsx`. Asked each time, because
	 * the registration can be refused (another plugin owns the extension) or toggled in settings.
	 */
	viewRegistered: () => boolean;
}

/**
 * The object rich-table publishes as `plugin.richSearch` so Rich Search can read the text of
 * workbooks. Kept free of the plugin class so it can be tested on its own.
 */
export function createRichSearchProvider(host: RichSearchProviderHost): RichSearchProvider {
	return {
		apiVersion: 1,
		extensions: XLSX_EXTENSIONS,
		extractVersion: XLSX_EXTRACT_VERSION,
		extract: file => extractXlsx(file.content),
		viewRegistered: ext => ext === 'xlsx' && host.viewRegistered(),
	};
}
