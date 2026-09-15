const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'workflows', 'loop-engineering');
const logic = require(path.join(dir, 'logic.cjs'));
const fixtures = require(path.join(dir, 'fixtures.cjs'));
const prelude = Object.values(logic).map(f => f.toString()).join('\n');
const fixturePrelude = Object.values(fixtures).map(f => f.toString()).join('\n');
const writerSystem = `你是接口测试用例编写者。依据输入的接口、验收标准和反馈生成完整方案。
仅输出 JSON 对象，不要 Markdown、不要解释：
{"cases":[{"id":"TC01","title":"...","category":"normal","ruleIds":["R1"],"preconditions":"...","emailAlreadyRegistered":false,"request":{"email":"new@example.com","password":"abcdefgh"},"steps":["..."],"expectedResult":{"outcome":"accepted","description":"..."}}]}
category 只能为 normal、abnormal、boundary、combination。
expectedResult.outcome 只能为 accepted 或 rejected。
每条用例都要有上述所有字段，password 必须是实际字符串，不得用“20位密码”等占位说明。
密码边界测试使用合法且未注册的邮箱，隔离密码长度变量。
至少覆盖 7、8、20、21 位密码、合法注册、非法邮箱、重复注册、多条件组合。
不编造 HTTP 状态码或错误码。按反馈修订，保留原本正确的用例。`;
const reviewerSystem = `你是独立测试评审者。只评审，不编写替代方案。
核对接口原始规则、验收条件和当前测试方案。关注邮箱格式、重复注册、前置条件、请求数据与预期的一致性，以及业务覆盖遗漏。
不要因 Writer 自称完成而通过。仅输出 JSON：
{"verdict":"pass","issues":[]}
verdict 只能是 pass、fail、blocked。fail 时 issues 必须给出具体可修复问题：[{"id":"RULE_R3","message":"缺少已注册邮箱再次注册的拒绝场景。"}]。
可修复的方案缺陷使用 fail。只有缺少必要接口定义、无法评审时使用 blocked。
未定义具体 HTTP 状态码并不是问题，不要要求 Writer 编造它们。`;
function makeWorkflow(synthetic) {
  const nodes = [], connections = {};
  const add = (name, type, typeVersion, parameters, position, extra = {}) => {
    nodes.push({ id: randomUUID(), name, type, typeVersion, parameters, position, ...extra });
  };
  const code = (name, body, position, shared = true) => add(name, 'n8n-nodes-base.code', 2,
    { mode: 'runOnceForAllItems', jsCode: (shared ? prelude + '\n' : '') + body }, position);
  const edge = (from, to, index = 0, type = 'main') => {
    connections[from] ??= {}; connections[from][type] ??= [];
    while (connections[from][type].length <= index) connections[from][type].push([]);
    connections[from][type][index].push({ node: to, type, index: 0 });
  };
  const condition = (name, expression, expected, position) => add(name, 'n8n-nodes-base.if', 2.2, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: randomUUID(), leftValue: expression, rightValue: expected, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {},
  }, position);
  const agent = (name, prompt, system, pos, fixtureBody) => {
    if (synthetic) code(name, fixtureBody, pos, false);
    else {
      add(name, '@n8n/n8n-nodes-langchain.agent', 3.1,
        { promptType: 'define', text: prompt, options: { systemMessage: system, maxIterations: 3 } }, pos,
        { onError: 'continueRegularOutput' });
      edge('DeepSeek Chat Model', name, 0, 'ai_languageModel');
    }
  };
  add('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {}, [0, 0]);
  code('Demo Input', `// 此处修改输入。固定样本版支持 retry_then_pass / pass_first / always_fail / invalid_json / missing_input。
const testMode = 'retry_then_pass';
const maxRounds = 3;
const api = { method: 'POST', path: '/register', rules: [
  {id:'R1', description:'email 必须符合邮箱格式。'},
  {id:'R2', description:'password 长度为 8～20 个字符。'},
  {id:'R3', description:'已注册的 email 不允许重复注册。'}
] };
return [{json:{api:${synthetic ? "testMode === 'missing_input' ? null : api" : 'api'},maxRounds,testMode,evidenceType:'${synthetic ? 'synthetic_control_test' : 'live_model'}'}}];`, [220, 0], false);
  code('Init State', 'return [{json: initialState($input.first().json)}];', [440, 0]);
  condition('Input Ready?', '={{ $json.status }}', 'running', [660, 0]);
  agent('Requirement Agent', '={{ JSON.stringify($json.api) }}', '你是需求分析师。提取接口信息与 R1/R2/R3，保留编号，不增加业务规则。简短输出。', [880, 0],
    "return [{json:{output:'固定样本需求：R1 邮箱格式；R2 密码8～20；R3 不得重复注册。'}}];");
  code('Store Requirements', `const s = JSON.parse(JSON.stringify($('Init State').first().json));
const out = $input.first().json;
s.preLoop.requirements = typeof out.output === 'string' ? out.output : null;
if (!s.preLoop.requirements) { s.status='blocked'; s.exitReason='requirements_unavailable'; }
return [{json:s}];`, [1100, 0], false);
  agent('Analysis Agent', '={{ JSON.stringify({api:$json.api,requirements:$json.preLoop.requirements}) }}', '你是测试分析师。为 R1/R2/R3 列出正常、异常、边界、组合测试点，不编造业务规则。密码边界为7、8、20、21。简短输出。', [1320, 0],
    "return [{json:{output:'固定样本分析：正常、非法邮箱、重复注册、密码7/8/20/21、组合异常。'}}];");
  code('Store Analysis', `const s = JSON.parse(JSON.stringify($('Store Requirements').first().json));
const out = $input.first().json;
s.preLoop.analyses = typeof out.output === 'string' && out.output.trim() ? [out.output] : [];
if (s.status === 'blocked' || !s.preLoop.analyses.length) {
 s.status='blocked'; s.nextAction='stop'; s.exitReason='preloop_unavailable';
 s.feedback={result:'blocked',passed:false,blocked:true,issues:[{id:'PRELOOP',message:'需求或分析 Agent 没有有效输出。'}],nextAction:'stop'};
}
return [{json:s}];`, [1540, 0], false);
  condition('Analysis Ready?', '={{ $json.status }}', 'running', [1760, 0]);
  code('Context Builder', 'return [{json:buildContext($input.first().json)}];', [1980, 0]);
  agent('Writer Agent', '={{ $json.context.taskPrompt }}', writerSystem, [2200, 0],
    fixturePrelude + '\nreturn [{json:{output:fixtureWriter($input.first().json)}}];');
  code('Parse Writer Output', `// 单个 State Item；每轮此节点与 Context Builder 恰好执行一次。
const state = $('Context Builder').all(0, $runIndex)[0].json;
return [{json:parseWriter(state, $input.first().json.output)}];`, [2420, 0]);
  condition('Writer JSON Valid?', '={{ $json.parseError ? "invalid" : "valid" }}', 'valid', [2640, 0]);
  agent('Reviewer Agent', '={{ JSON.stringify({api:$json.api,acceptanceCriteria:$json.acceptanceCriteria,currentResult:$json.currentResult}) }}', reviewerSystem, [2860, -100],
    "return [{json:{output:JSON.stringify({verdict:'pass',issues:[]})}}];");
  code('Feedback Verifier', `const state = $('Parse Writer Output').all(0, $runIndex)[0].json;
return [{json:verify(state, $input.first().json.output)}];`, [3080, 0]);
  condition('Passed?', '={{ $json.status }}', 'success', [3300, 0]);
  condition('Retry?', '={{ $json.nextAction }}', 'retry', [3520, 160]);
  code('Advance Round', 'return [{json:advanceRound($input.first().json)}];', [3080, 370]);
  code('End Success', 'return $input.all();', [3740, -140], false);
  code('End Stop', 'return $input.all();', [3740, 210], false);
  code('End Blocked Input', 'return $input.all();', [880, 300], false);
  if (!synthetic) add('DeepSeek Chat Model', '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 1,
    { model: 'deepseek-flash', options: { temperature: 0 } }, [1980, -340],
    { notes: '选择你已有的 DeepSeek 凭据。此文件不包含凭据。', notesInFlow: true });
  const chain = ['Manual Trigger','Demo Input','Init State','Input Ready?','Requirement Agent','Store Requirements','Analysis Agent','Store Analysis','Analysis Ready?','Context Builder','Writer Agent','Parse Writer Output','Writer JSON Valid?','Reviewer Agent','Feedback Verifier','Passed?','End Success'];
  for (let i=0;i<chain.length-1;i++) edge(chain[i],chain[i+1]);
  edge('Input Ready?', 'End Blocked Input', 1);
  edge('Analysis Ready?', 'End Stop', 1);
  edge('Writer JSON Valid?', 'Feedback Verifier', 1);
  edge('Passed?', 'Retry?', 1);
  edge('Retry?', 'Advance Round'); edge('Retry?', 'End Stop', 1); edge('Advance Round', 'Context Builder');
  add('Read Me', 'n8n-nodes-base.stickyNote', 1, {
    content: synthetic
      ? '## 固定样本控制测试\n不调用模型。Writer/Reviewer 是 Code 样本节点，不代表 Agent 实测。\n在 Demo Input 修改 testMode。默认故意缺少 B21，第二轮补齐，仅验证路由。'
      : '## 真实模型反馈循环\n选择 DeepSeek 凭据，然后从 Manual Trigger 完整执行。\n首轮通过属于正常情况。历史在最终 State 的 historySummary。\n不要单步执行循环体；节点按同一次执行的轮次读取 State。',
    height: 220, width: 610,
  }, [0, -320]);
  return { name: synthetic ? '03A-Loop控制测试-固定样本' : '03B-Loop Engineering-真实模型', nodes, connections,
    settings: { executionOrder: 'v1', saveManualExecutions: true }, active: false, pinData: {}, tags: [] };
}
fs.mkdirSync(dir, { recursive: true });
for (const [file, synthetic] of [['03A-control-check.json',true],['03B-live-model.json',false]]) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(makeWorkflow(synthetic), null, 2) + '\n');
  console.log('Generated ' + file);
}

// Real model repair of an explicitly supplied, incomplete user draft.
// Round 0 is baseline review. Rounds 1..maxRounds are actual Writer attempts.
const repair = makeWorkflow(false);
repair.name = '03C-真实初稿审查与修订';
const findNode = name => repair.nodes.find(n => n.name === name);
const inputDraft = fixtures.fixtureCases();
inputDraft.cases = inputDraft.cases.filter(c => c.id !== 'B21');
findNode('Demo Input').parameters.jsCode += `\n`;
findNode('Demo Input').parameters.jsCode = findNode('Demo Input').parameters.jsCode.replace(
  "maxRounds,testMode,evidenceType:'live_model'",
  `maxRounds,testMode,evidenceType:'live_model_user_draft',initialDraft:${JSON.stringify(inputDraft)}`,
);
const prepareDraft = {
  id:randomUUID(),name:'Load User Draft',type:'n8n-nodes-base.code',typeVersion:2,position:[1930,-530],
  parameters:{mode:'runOnceForAllItems',jsCode:prelude+`\nconst s=JSON.parse(JSON.stringify($input.first().json));
s.round=0;
s.currentResult=$('Demo Input').first().json.initialDraft;
s.inputOrigin='Explicit synthetic user draft for a real model repair task; not a Writer output.';
return [{json:s}];`},
};
const draftReviewer = JSON.parse(JSON.stringify(findNode('Reviewer Agent')));
draftReviewer.id=randomUUID();draftReviewer.name='Review User Draft';draftReviewer.position=[2160,-530];
const draftVerifier = {
  id:randomUUID(),name:'Verify User Draft',type:'n8n-nodes-base.code',typeVersion:2,position:[2390,-530],
  parameters:{mode:'runOnceForAllItems',jsCode:prelude+`\nconst s=$('Load User Draft').first().json;
return [{json:verify(s,$input.first().json.output)}];`},
};
const draftPassed=JSON.parse(JSON.stringify(findNode('Passed?')));
draftPassed.id=randomUUID();draftPassed.name='Draft Passed?';draftPassed.position=[2630,-530];
const draftRetry=JSON.parse(JSON.stringify(findNode('Retry?')));
draftRetry.id=randomUUID();draftRetry.name='Draft Repairable?';draftRetry.position=[2860,-530];
repair.nodes.push(prepareDraft,draftReviewer,draftVerifier,draftPassed,draftRetry);
const link = name => ({node:name,type:'main',index:0});
repair.connections['Analysis Ready?'].main[0]=[link('Load User Draft')];
repair.connections['Load User Draft']={main:[[link('Review User Draft')]]};
repair.connections['Review User Draft']={main:[[link('Verify User Draft')]]};
repair.connections['Verify User Draft']={main:[[link('Draft Passed?')]]};
repair.connections['Draft Passed?']={main:[[link('End Success')],[link('Draft Repairable?')]]};
repair.connections['Draft Repairable?']={main:[[link('Advance Round')],[link('End Stop')]]};
repair.connections['DeepSeek Chat Model'].ai_languageModel[0].push({node:'Review User Draft',type:'ai_languageModel',index:0});
findNode('Read Me').parameters.content='## 真实模型修订明确有缺陷的用户初稿\nDemo Input.initialDraft 是人工构造的输入，缺少21位密码边界，不是模型产物。\n第0轮审查初稿；第1～3轮由真实Writer修订并重新评审。\n修复一次即通过时，Context Builder只执行一次，但存在审查→反馈→修改→再审查的闭环。\n选择DeepSeek凭据，从Manual Trigger完整执行。';
fs.writeFileSync(path.join(dir,'03C-review-and-repair.json'),JSON.stringify(repair,null,2)+'\n');
console.log('Generated 03C-review-and-repair.json');
