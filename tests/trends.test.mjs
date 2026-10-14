import test from 'node:test';
import assert from 'node:assert/strict';
import { hba1cTrend } from '../shared/trends.ts';

const record=(date,values,unit='%')=>({date,observations:values.map(value=>({name:'HbA1c',value,unit}))});
test('health trend excludes unknown dates, different units, and ambiguous repeated results',()=>{
  assert.deepEqual(hba1cTrend([record(null,[6.1]),record('2026-01-01',[42],'mmol/mol'),record('2026-02-01',[6.1,6.3])]),[]);
});
test('health trend deduplicates identical same-day uploads and suppresses conflicting same-day values',()=>{
  assert.deepEqual(hba1cTrend([record('2026-03-01',[6.2]),record('2026-03-01',[6.2]),record('2026-04-01',[6.3]),record('2026-04-01',[6.7])]),[{date:'2026-03-01',value:6.2}]);
});
