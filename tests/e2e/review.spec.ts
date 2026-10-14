import { expect, test } from '@playwright/test';

test('a prescription without lab values can be corrected and saved', async ({page,request}) => {
  await request.post('/api/demo/reset');
  const state = await (await request.get('/api/bootstrap')).json();
  const prescription = state.records.find((record: { medications: unknown[]; observations: unknown[] }) => record.medications.length && !record.observations.length);
  await page.goto('/');
  await page.locator('.main-nav button', {hasText:'My health records'}).click();
  await page.getByRole('heading',{name:prescription.title,exact:true}).click();
  await page.getByRole('button',{name:'Correct details',exact:true}).click();
  const field = page.getByLabel('Medicine 1 dosage', {exact:true});
  await expect(field).toBeVisible();
  const original = await field.inputValue();
  await field.fill('Confirm with prescriber');
  await page.getByRole('button',{name:'Save corrections',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Confirm with prescriber');
  const updated = await (await request.get(`/api/records/${prescription.id}`)).json();
  expect(updated.medications[0].dosage).toBe('Confirm with prescriber');
  expect(updated.medications[0].sourceText).toBe(prescription.medications[0].sourceText);
  expect(updated.reviewStatus).toBe('pending');
  expect(original).not.toBe('Confirm with prescriber');
  await request.post('/api/demo/reset');
});

test('handwriting mode is opt-in and keeps processing consent separate',async({page})=>{
  await page.goto('/');
  await page.locator('button',{hasText:'Add your next record'}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles('public/samples/aarav-blood-panel.png');
  const handwriting=dialog.getByRole('checkbox',{name:/Handwritten prescription/});
  await handwriting.check();
  await expect(dialog).toContainText(/two OCR passes/i);
  await expect(dialog.getByRole('button',{name:'Read my record'})).toBeDisabled();
  await dialog.getByRole('checkbox',{name:/I agree to send/}).check();
  await expect(dialog.getByRole('button',{name:'Read my record'})).toBeEnabled();
});

test('OCR disagreements are visible and block review until acknowledged',async({page,request})=>{
  const state=await(await request.get('/api/bootstrap')).json();
  const record=state.records[0]; record.reviewStatus='pending';
  record.provenance.ocr={mode:'verified',status:'disagreement',disagreementCount:1,verificationModel:'test-vision',preprocessing:['grayscale contrast'],pages:[{page:1,firstPass:'Metformin 500 mg',secondPass:'Metformin 850 mg',consensus:'Metformin [unclear] mg',disagreementCount:1}]};
  record.provenance.warnings=['Two OCR passes disagree. Check the original prescription.'];
  await page.route('**/api/bootstrap',route=>route.fulfill({json:state}));
  await page.goto('/');
  await page.locator('.main-nav button',{hasText:'My health records'}).click();
  await page.getByRole('heading',{name:record.title,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toContainText(/OCR needs your attention/i);
  const review=dialog.getByRole('button',{name:'I’ve reviewed the details'});
  await expect(review).toBeDisabled();
  await dialog.getByRole('checkbox',{name:/compared the unclear text/}).check();
  await expect(review).toBeEnabled();
  await dialog.getByRole('button',{name:'Source & AI details'}).click();
  await expect(dialog).toContainText('Metformin 500 mg');
  await expect(dialog).toContainText('Metformin 850 mg');
});
test('agreeing Hindi OCR with unreadable text still exposes the required review checkbox',async({page,request})=>{
  const state=await(await request.get('/api/bootstrap')).json();
  const record=state.records[0];record.reviewStatus='pending';
  record.provenance.ocr={mode:'verified',status:'agreement',disagreementCount:0,preprocessing:[],pages:[{page:1,firstPass:'दवा अस्पष्ट',secondPass:'दवा अस्पष्ट',consensus:'दवा अस्पष्ट',disagreementCount:0}]};
  await page.route('**/api/bootstrap',route=>route.fulfill({json:state}));
  await page.goto('/');
  await page.locator('.main-nav button',{hasText:'My health records'}).click();
  await page.getByRole('heading',{name:record.title,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox',{name:/compared the unclear text/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'I’ve reviewed the details'})).toBeDisabled();
});
