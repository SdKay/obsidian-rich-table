import { test, expect } from '../common/test-base';
import { buildXlsxFixtureBytes } from '../common/build-xlsx-fixture';

/** Links in cells of the .xlsx file view open as they do in a note: Obsidian does not route them for this view. */
const PATH = 'data/book.xlsx';
const one = () => buildXlsxFixtureBytes({ sheets: [{ name: 'S', grid: [['H', 'Other'], ['cell text', 'plain']] }] });

test.describe('links in the xlsx file view', () => {
	test('clicking a wikilink opens the note, resolved from the workbook\'s own path', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', 'Meeting notes#Agenda', 'Meeting notes');
		await page.locator(link).click();
		expect(await view.linkOpenings()).toEqual([{ kind: 'internal', href: 'Meeting notes#Agenda', sourcePath: PATH, where: false }]);
	});

	test('Ctrl+click opens a new tab, Ctrl+Alt a split, Ctrl+Alt+Shift a window, middle click a tab', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', 'Note');
		await page.locator(link).click({ modifiers: ['Control'] });
		await page.locator(link).click({ modifiers: ['Control', 'Alt'] });
		await page.locator(link).click({ modifiers: ['Control', 'Alt', 'Shift'] });
		await page.locator(link).click({ button: 'middle' });
		const where = (await view.linkOpenings()).map(o => o.where);
		expect(where).toEqual(['tab', 'split', 'window', 'tab']);
	});

	test('clicking an external link opens its address in a new window', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('external', 'https://example.com/a?b=1');
		await page.locator(link).click();
		expect(await view.linkOpenings()).toEqual([{ kind: 'external', href: 'https://example.com/a?b=1' }]);
	});

	test('a click that is not on a link opens nothing', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		await view.addLink('internal', 'Note');
		await page.locator('.bt-td', { hasText: 'plain' }).click();
		expect(await view.linkOpenings()).toEqual([]);
	});

	test('a right click does not open the link', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', 'Note');
		await page.locator(link).click({ button: 'right' });
		expect(await view.linkOpenings()).toEqual([]);
	});

	test('a link element without a target is ignored', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', null);
		await page.locator(link).click();
		expect(await view.linkOpenings()).toEqual([]);
	});

	test('clicking a link opens it and leaves the search highlight in place', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH, { searchHost: 'panel', initialQuery: { query: 'cell' } });
		expect(await view.hits()).toEqual(['cell']);
		const link = await view.addLink('internal', 'Note');
		await page.locator(link).click();
		expect(await view.hits()).toEqual(['cell']);
		expect((await view.linkOpenings()).map(o => o.href)).toEqual(['Note']);
	});

	test('after the view is closed a click on a former link opens nothing', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', 'Note');
		await view.unloadView();
		await page.locator(link).click();
		expect(await view.linkOpenings()).toEqual([]);
	});

	test('the click is consumed, so the browser does not also follow the link', async ({ page, renderXlsxFile }) => {
		const view = await renderXlsxFile({ [PATH]: await one() }, PATH);
		const link = await view.addLink('internal', 'Note');
		const prevented = await page.evaluate((sel) => {
			const a = document.querySelector(sel) as HTMLAnchorElement;
			a.setAttribute('href', 'Note');
			let defaultPrevented = false;
			// Observes after the view's own handler: bubbling to document comes last.
			document.addEventListener('click', (e) => { defaultPrevented = e.defaultPrevented; }, { once: true });
			a.click();
			return defaultPrevented;
		}, link);
		expect(prevented).toBe(true);
	});

	test('a link that sits outside the view is not taken', async ({ page, renderXlsxFile }) => {
		await renderXlsxFile({ [PATH]: await one() }, PATH);
		const found = await page.evaluate(() => {
			const R = (window as any).RichTableReal;
			const outside = document.createElement('a');
			outside.className = 'internal-link';
			outside.setAttribute('data-href', 'Elsewhere');
			outside.textContent = 'x';
			document.body.appendChild(outside);
			const container = document.createElement('div');
			document.body.appendChild(container);
			const r = R.linkAt(outside, container);
			outside.remove(); container.remove();
			return r;
		});
		expect(found).toBe(null);
	});
});
