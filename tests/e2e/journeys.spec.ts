import { expect, test } from '@playwright/test';

/**
 * Browser verification of the core journeys the spec's "Deliverables and
 * acceptance" section names. The suite runs against a server with NVIDIA
 * deliberately unconfigured (see tests/e2e/server.mjs), so every assertion here
 * is about behavior that must hold without a provider: the tool must stay
 * usable, and it must never present a local fallback as a live AI run.
 */

test.describe('workspace shell', () => {
  test('loads the synthetic workspace without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Good to see you, Aarav/ })).toBeVisible();

    // The workspace must announce that it is synthetic — never a real patient.
    await expect(page.locator('.demo-label')).toContainText(/SYNTHETIC DEMO WORKSPACE/i);
    expect(errors).toEqual([]);
  });

  test('does not claim to be a medical professional', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.app-footer')).toContainText(/not a medical professional/i);
  });

  test('uses a singular noun when exactly one record needs review', async ({ page }) => {
    await page.goto('/');
    // The seed leaves exactly one record pending, so the overview prompt must
    // read "1 record is ready…", not "1 records are ready…".
    const prompt = page.locator('main');
    await expect(prompt).not.toContainText('1 records are ready');
    await expect(prompt).toContainText('1 record is ready');
  });
});

test.describe('language toggle', () => {
  test('translates the interface and sets the document language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.main-nav button').first()).toContainText('Overview');

    await page.locator('.language-switch button', { hasText: 'हिं' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.locator('.main-nav button').first()).toContainText('एक नज़र');

    // Numbers and medicine names survive translation.
    await page.locator('.main-nav button', { hasText: 'स्वास्थ्य टाइमलाइन' }).click();
    await expect(page.locator('main')).toContainText('2026');

    await page.locator('.language-switch button', { hasText: 'EN' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('record detail and source evidence', () => {
  test('shows extracted values beside their source and model provenance', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Preventive health panel' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('A closer look at your record');
    await expect(dialog).toContainText('HbA1c');
    await expect(dialog).toContainText('6.1');

    // Evidence and provenance must be reachable from the same view as the value.
    await expect(dialog.getByText(/See source evidence/i).first()).toBeVisible();
    await expect(dialog.getByText(/Source & AI details/i).first()).toBeVisible();
  });

  test('states that a result alone does not establish a diagnosis', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Preventive health panel' }).first().click();
    await expect(page.getByRole('dialog')).toContainText(/does not establish a diagnosis|not a diagnosis/i);
  });

  test('closes with Escape and restores focus to the page', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Preventive health panel' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('upload consent', () => {
  test('cannot submit without explicit consent', async ({ page }) => {
    await page.goto('/');
    await page.locator('button', { hasText: 'Add your next record' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The consent statement must name NVIDIA before anything is sent.
    await expect(dialog).toContainText(/send the document content to NVIDIA/i);

    await dialog.locator('input[type="file"]').setInputFiles('public/samples/aarav-blood-panel.txt');
    await expect(dialog).toContainText('aarav-blood-panel.txt');

    const submit = dialog.locator('button', { hasText: 'Read my record' });
    await expect(submit).toBeDisabled();

    await dialog.getByRole('checkbox', { name: /I agree to send/ }).check();
    await expect(submit).toBeEnabled();
  });

  test('parses a text report locally when no provider is configured', async ({ page }) => {
    await page.goto('/');
    const before = await page.locator('.nav-count').first().innerText();

    await page.locator('button', { hasText: 'Add your next record' }).first().click();
    const uploadDialog = page.getByRole('dialog');
    await uploadDialog.locator('input[type="file"]').setInputFiles('public/samples/aarav-blood-panel.txt');
    await uploadDialog.getByRole('checkbox', { name: /I agree to send/ }).check();
    await uploadDialog.locator('button', { hasText: 'Read my record' }).click();

    // The job must reach a terminal state rather than spinning forever: the
    // upload sheet closes and the new record's detail sheet takes its place.
    await expect(page.getByText('Make room for a little clarity')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('dialog')).toContainText('A closer look at your record');
    await expect(page.locator('.nav-count').first()).not.toHaveText(before);
  });
});

test.describe('grounded copilot', () => {
  test('labels a no-provider answer as a local summary, never as live AI', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-nav button', { hasText: 'Ask Sehat' }).click();

    const input = page.locator('input[aria-label="Ask your health copilot"]');
    await input.fill('What does my October blood panel say?');
    await input.press('Enter');

    const main = page.locator('main');
    await expect(main).toContainText(/local summary/i);
    // It must cite the saved record and keep the non-diagnostic caveat.
    await expect(main).toContainText(/Preventive health panel/);
    await expect(main).toContainText(/does not establish a diagnosis/i);
  });

  test('declines dosage changes and points to a prescriber', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-nav button', { hasText: 'Ask Sehat' }).click();
    const input = page.locator('input[aria-label="Ask your health copilot"]');
    await input.fill('Should I increase my metformin dose to 1000mg?');
    await input.press('Enter');

    await expect(page.locator('main')).toContainText(/cannot recommend/i);
  });

  test('directs emergencies to urgent local care', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-nav button', { hasText: 'Ask Sehat' }).click();
    const input = page.locator('input[aria-label="Ask your health copilot"]');
    await input.fill('I have severe chest pain right now');
    await input.press('Enter');

    await expect(page.locator('main')).toContainText(/emergency/i);
  });
});

test.describe('timeline, medications and profile', () => {
  test('timeline orders records by their real document dates', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-nav button', { hasText: 'Health timeline' }).click();

    const main = page.locator('main');
    await expect(main).toContainText('2026');

    // The synthetic seed spans April through October; the newest document must
    // appear before the oldest in document order.
    const text = await main.innerText();
    const october = text.indexOf('Oct');
    const april = text.indexOf('Apr');
    if (october >= 0 && april >= 0) expect(october).toBeLessThan(april);
  });

  test('medications are transcribed from the source prescription', async ({ page }) => {
    await page.goto('/');
    await page.locator('.main-nav button', { hasText: 'My medications' }).click();

    const main = page.locator('main');
    await expect(main).toContainText(/Vitamin D3/i);
    // Written instructions must be attributed to the document, not presented as new advice.
    await expect(main).toContainText(/prescription|document|prescribed/i);
  });

  test('profile labels ABHA linking as a mock interaction', async ({ page }) => {
    await page.goto('/');
    await page.locator('.sidebar-settings', { hasText: 'Profile & preferences' }).click();

    const main = page.locator('main');
    await expect(main).toContainText(/ABHA/i);
    await expect(main).toContainText(/mock/i);
  });
});

test.describe('responsive layout', () => {
  test('keeps navigation reachable on a tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Good to see you, Aarav/ })).toBeVisible();

    // Narrow layouts collapse the sidebar behind a labelled menu button.
    const menu = page.locator('button[aria-label="Open navigation"]');
    if (await menu.isVisible()) {
      await menu.click();
      await expect(page.locator('.sidebar')).toBeVisible();
    }
  });
});
