import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for cloud data to load and the table to render.
    await expect(page.locator('#rows tr[data-row]').first()).toBeVisible();
});

test('dashboard renders stats, company table and heatmap', async ({ page }) => {
    // Stats + sample data present.
    await expect(page.locator('#stats .stat').first()).toBeVisible();
    await expect(page.locator('#rows tr[data-row]')).toHaveCount(6);
    await expect(page.locator('#view-title')).toContainText('全部投递');

    // Heatmap: current calendar year, navigation, labels and square cells.
    await expect(page.locator('#heatmap-year')).toHaveText(String(new Date().getFullYear()));
    await expect(page.locator('#heatmap .heat-cell').first()).toBeVisible();
    await expect(page.locator('#heat-months span').first()).toContainText('月');
    await expect(page.locator('#heat-weekdays span').first()).toHaveText('一');
    await expect(page.locator('#heatmap-summary')).toContainText('份投递');
});

test('heatmap year navigation switches the displayed year', async ({ page }) => {
    const year = new Date().getFullYear();
    await page.locator('#heat-prev').click();
    await expect(page.locator('#heatmap-year')).toHaveText(String(year - 1));
    await expect(page.locator('#heatmap-summary')).toContainText(`${year - 1} 年共`);
    await page.locator('#heat-next').click();
    await expect(page.locator('#heatmap-year')).toHaveText(String(year));
});

test('add a company inline and it persists in the table', async ({ page }) => {
    const before = await page.locator('#rows tr[data-row]').count();
    await page.locator('#add').click();
    const nameInput = page.locator('#rows tr[data-row]').first().locator('[data-field="name"]');
    await nameInput.fill('E2E 测试公司');
    await nameInput.press('Tab'); // blur to commit value
    await expect(nameInput).toHaveValue('E2E 测试公司');
    await expect(page.locator('#rows tr[data-row]')).toHaveCount(before + 1);
});

test('search filters companies', async ({ page }) => {
    const total = await page.locator('#rows tr[data-row]').count();
    await page.locator('#q').fill('星河');
    await expect(page.locator('#rows tr[data-row]')).toHaveCount(1);
    await expect(page.locator('#rows tr[data-row]').first().locator('[data-field="name"]')).toHaveValue('星河机器人');
    await page.locator('#q').fill('');
    await expect(page.locator('#rows tr[data-row]')).toHaveCount(total);
});

test('interview reviews page shows timeline and hotword chips', async ({ page }) => {
    await page.locator('[data-page="reviews"]').click();
    await expect(page.locator('#reviews-page')).toBeVisible();
    await expect(page.locator('#reviews-page')).toContainText('面试复盘与历程');
    await expect(page.locator('.review-item')).toHaveCount(2);
    await expect(page.locator('#reviews-page')).toContainText('复盘总览与高频考点');
    await expect(page.locator('.kw-chip').first()).toBeVisible();
});

test('dark theme toggle changes the html data-theme attribute', async ({ page }) => {
    const before = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme').click();
    const after = await page.locator('html').getAttribute('data-theme');
    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
});
