import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactCatalog, renderSelectedFacts } from '../server/chat.mjs';

test('repeated source facts are stated once while retaining both source citations',()=>{
  const facts=[{id:'F1',recordId:'a',title:'A',date:'2026-10-14',text:'HbA1c is 6.1%.'},{id:'F2',recordId:'b',title:'B',date:'2026-10-14',text:'HbA1c is 6.1%.'}];
  const result=renderSelectedFacts({factIds:['F1','F2']},facts,'en');
  assert.equal(result.answer.split('HbA1c is 6.1%.').length-1,1);
  assert.deepEqual(result.citations.map(c=>c.recordId),['a','b']);
});
test('old stored family-history and negated diseases are not offered as patient diagnosis facts',()=>{
  const source='Family history: mother has diabetes. No evidence of pneumonia.';
  const record={id:'old',title:'Old note',date:null,summary:{en:'Clinical note',hi:'नोट'},observations:[],medications:[],sourceText:source,diagnoses:[{name:'diabetes',sourceText:'Family history: mother has diabetes.'},{name:'pneumonia',sourceText:'No evidence of pneumonia.'}]};
  assert.equal(buildFactCatalog([record],'en').filter(f=>f.kind==='diagnosis').length,0);
});
