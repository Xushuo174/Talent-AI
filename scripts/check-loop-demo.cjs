// Executes exported Code scripts and follows exported IF connections with fixed samples.
// This checks local logic and graph routing, not the n8n runtime or model provider.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../workflows/loop-engineering');
const workflow = JSON.parse(fs.readFileSync(path.join(dir, '03A-control-check.json'), 'utf8'));
const logic = require(path.join(dir, 'logic.cjs'));
const { fixtureCases } = require(path.join(dir, 'fixtures.cjs'));
const clone = value => JSON.parse(JSON.stringify(value));
function run(mode, maxRounds = 3) {
  const records = {};
  let name = 'Manual Trigger', items = [{json:{}}], terminal, count = 0;
  while (name) {
    assert.ok(++count < 150, 'Unexpected unbounded loop');
    const node = workflow.nodes.find(n => n.name === name);
    const runIndex = records[name]?.length ?? 0;
    let branch = 0;
    if (node.type === 'n8n-nodes-base.code') {
      const sandbox = { $runIndex: runIndex, $input: {first:()=>clone(items[0]),all:()=>clone(items)},
        $: label => ({first:()=>clone(records[label][0][0]),all:(_branch,index)=>clone(records[label][index])}) };
      items = clone(vm.runInNewContext('(function(){\n'+node.parameters.jsCode+'\n})()', sandbox, {timeout:1000}));
      if (name === 'Demo Input') {
        items[0].json.testMode = mode;
        items[0].json.maxRounds = maxRounds;
        if (mode === 'missing_input') items[0].json.api = null;
      }
    } else if (node.type === 'n8n-nodes-base.if') {
      const c = node.parameters.conditions.conditions[0];
      const expression = c.leftValue.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
      const value = vm.runInNewContext(expression, {$json:items[0].json}, {timeout:1000});
      branch = value === c.rightValue ? 0 : 1;
    }
    (records[name] ??= []).push(clone(items));
    terminal = name;
    const next = workflow.connections[name]?.main?.[branch] ?? [];
    assert.ok(next.length <= 1, 'Control test expects one main path at a time');
    name = next[0]?.node;
  }
  return {state:items[0].json, records, terminal};
}
for (const [mode, expectedStatus, rounds, terminal] of [
  ['pass_first','success',1,'End Success'],
  ['retry_then_pass','success',2,'End Success'],
  ['always_fail','failed',3,'End Stop'],
  ['invalid_json','blocked',1,'End Stop'],
  ['missing_input','blocked',1,'End Blocked Input'],
]) {
  const result = run(mode);
  assert.equal(result.state.status,expectedStatus);
  assert.equal(result.state.round,rounds);
  assert.equal(result.terminal,terminal);
  assert.equal(result.records['Init State'].length,1);
  if (mode !== 'missing_input') {
    assert.equal(result.records['Requirement Agent'].length,1);
    assert.equal(result.records['Analysis Agent'].length,1);
    assert.equal(result.state.historySummary.length,rounds);
  }
  if (mode === 'retry_then_pass') {
    const context = result.records['Context Builder'][1][0].json;
    assert.ok(context.context.mustFix.some(i=>i.id==='PASSWORD_BOUNDARY_21'));
    assert.equal(context.currentResult.cases.length,7);
    assert.equal(result.state.currentResult.cases.length,8);
    assert.equal(result.records['Init State'][0][0].json.preLoop.requirements,null);
  }
  console.log(mode + ': ' + expectedStatus + ', round=' + rounds);
}
assert.equal(run('always_fail',1).state.round,1);
assert.equal(run('always_fail',1).state.status,'failed');
const input = {api:{method:'POST',path:'/register',rules:['R1','R2','R3'].map(id=>({id,description:id}))},maxRounds:3};
let state = logic.parseWriter(logic.buildContext(logic.initialState(input)),fixtureCases());
assert.equal(logic.verify(state,{verdict:'fail',issues:[{id:'SEMANTIC',message:'语义缺失'}]}).nextAction,'retry');
assert.equal(logic.verify(state,{verdict:'pass',issues:[{id:'INCONSISTENT',message:'仍有问题'}]}).status,'running');
assert.equal(logic.verify(state,'bad json').status,'blocked');
assert.equal(logic.verify(state,{verdict:'blocked',issues:[]}).status,'blocked');
const duplicate = fixtureCases(); duplicate.cases[1].id=duplicate.cases[0].id;
assert.ok(logic.validateResult(duplicate).some(i=>i.id.startsWith('CASE_ID')));
const placeholder = fixtureCases(); placeholder.cases[3].request.password='21位密码';
assert.ok(logic.validateResult(placeholder).some(i=>i.id==='PASSWORD_BOUNDARY_21'));
const unknownShape = logic.parseWriter(logic.buildContext(logic.initialState(input)),{done:true});
assert.equal(logic.verify(unknownShape,{verdict:'pass',issues:[]}).nextAction,'retry');
for (const file of ['03A-control-check.json','03B-live-model.json']) {
  const w=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  const names=new Set(w.nodes.map(n=>n.name));
  for (const [source,types] of Object.entries(w.connections)) {
    assert.ok(names.has(source));
    for(const branches of Object.values(types)) for(const links of branches) for(const link of links) assert.ok(names.has(link.node));
  }
  assert.equal(w.settings.executionOrder,'v1');
  assert.ok(w.nodes.every(n=>!n.credentials));
}
console.log('PASS: exported scripts, loop routes, state handoff, reviewer gating and JSON validation.');
console.log('NOT VERIFIED HERE: n8n import, native runtime back-edge, DeepSeek live calls.');
