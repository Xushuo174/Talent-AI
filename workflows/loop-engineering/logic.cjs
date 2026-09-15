// Pure functions shared by the workflow Code nodes and local checks.
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function parseObject(value) {
  if (isObject(value)) return value;
  if (typeof value !== 'string') throw new Error('Expected a JSON object or JSON text.');
  const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!isObject(parsed)) throw new Error('Expected a JSON object.');
  return parsed;
}
function initialState(input) {
  const s = {
    goal: '根据接口定义生成可验证的注册接口测试方案',
    api: input.api,
    acceptanceCriteria: [
      '覆盖 R1 邮箱格式、R2 密码长度、R3 重复注册。',
      '密码边界必须包含实际长度为 7、8、20、21 的请求值。',
      '至少 6 条用例，ID 唯一，包含正常、异常、边界和组合场景。',
      '每条用例有前置条件、请求、步骤、预期结果及规则编号。',
      '不得编造未提供的 HTTP 状态码或错误码。',
    ],
    round: 1, maxRounds: input.maxRounds ?? 3,
    preLoop: { requirements: null, analyses: [] },
    currentResult: null, review: null, feedback: null, historySummary: [],
    status: 'running', nextAction: 'execute',
    testMode: input.testMode ?? 'retry_then_pass',
    evidenceType: input.evidenceType ?? 'live_model',
  };
  const validApi = isObject(s.api) && s.api.method === 'POST' && hasText(s.api.path)
    && Array.isArray(s.api.rules) && ['R1', 'R2', 'R3'].every(id => s.api.rules.some(r => r.id === id && hasText(r.description)));
  if (!validApi || !Number.isInteger(s.maxRounds) || s.maxRounds < 1 || s.maxRounds > 5) {
    s.status = 'blocked'; s.nextAction = 'stop';
    s.feedback = { result: 'blocked', passed: false, blocked: true,
      issues: [{ id: 'INPUT_INVALID', message: '接口定义不完整，或 maxRounds 不是 1～5 的整数。' }],
      feedback: '补全接口定义后重新运行。', nextAction: 'stop' };
  }
  return s;
}
function buildContext(state) {
  const s = JSON.parse(JSON.stringify(state));
  s.review = null;
  s.parseError = null;
  s.context = {
    round: s.round,
    mustKeep: ['原始接口定义和业务规则', '上一轮已经正确的用例'],
    mustFix: s.feedback?.issues ?? [],
    acceptanceCriteria: s.acceptanceCriteria,
  };
  s.context.taskPrompt = [
    '生成完整的测试方案 JSON，不要仅返回修改部分。',
    '原始目标：' + s.goal,
    '接口定义：' + JSON.stringify(s.api),
    '验收标准：' + JSON.stringify(s.acceptanceCriteria),
    '稳定需求与分析：' + JSON.stringify(s.preLoop),
    '当前轮次：' + s.round,
    '上一轮完整方案：' + JSON.stringify(s.currentResult),
    '必须修复的问题：' + JSON.stringify(s.context.mustFix),
    '历史摘要：' + JSON.stringify(s.historySummary),
  ].join('\n\n');
  return s;
}
function parseWriter(state, output) {
  const s = JSON.parse(JSON.stringify(state));
  try { s.currentResult = parseObject(output); }
  catch (error) { s.currentResult = null; s.parseError = error.message; }
  return s;
}
function validateResult(result) {
  const issues = [];
  const add = (id, message) => issues.push({ id, message });
  if (!isObject(result) || !Array.isArray(result.cases)) {
    add('CASES_REQUIRED', '返回 {"cases": [...]}，cases 必须为数组。');
    return issues;
  }
  const cases = result.cases;
  if (cases.length < 6) add('CASE_COUNT', '至少需要 6 条测试用例。');
  const ids = new Set();
  for (const [index, c] of cases.entries()) {
    const label = `用例 ${index + 1}`;
    if (!isObject(c)) { add('CASE_OBJECT_' + index, label + '必须是对象。'); continue; }
    if (!hasText(c.id) || ids.has(c.id)) add('CASE_ID_' + index, label + '的 ID 缺失或重复。');
    ids.add(c.id);
    for (const field of ['title', 'preconditions']) {
      if (!hasText(c[field])) add('FIELD_' + index + '_' + field, `${label}缺少 ${field}。`);
    }
    if (!Array.isArray(c.ruleIds) || !c.ruleIds.length || c.ruleIds.some(id => !['R1', 'R2', 'R3'].includes(id))) {
      add('RULE_IDS_' + index, label + '必须标注有效的 ruleIds。');
    }
    if (!Array.isArray(c.steps) || !c.steps.length || !c.steps.every(hasText)) add('STEPS_' + index, label + '缺少非空执行步骤。');
    if (!['normal', 'abnormal', 'boundary', 'combination'].includes(c.category)) add('CATEGORY_' + index, label + '的 category 无效。');
    if (typeof c.emailAlreadyRegistered !== 'boolean') add('EMAIL_STATE_' + index, label + '必须声明 emailAlreadyRegistered。');
    if (!isObject(c.request) || typeof c.request.email !== 'string' || typeof c.request.password !== 'string') {
      add('REQUEST_' + index, label + '的请求必须包含字符串 email 和 password。');
    }
    if (!isObject(c.expectedResult) || !['accepted', 'rejected'].includes(c.expectedResult.outcome) || !hasText(c.expectedResult.description)) {
      add('EXPECTED_' + index, label + '缺少预期 outcome 或说明。');
    }
  }
  for (const ruleId of ['R1', 'R2', 'R3']) {
    if (!cases.some(c => isObject(c) && Array.isArray(c.ruleIds) && c.ruleIds.includes(ruleId))) add('COVER_' + ruleId, `缺少 ${ruleId} 的用例映射。`);
  }
  for (const category of ['normal', 'abnormal', 'boundary', 'combination']) {
    if (!cases.some(c => c?.category === category)) add('COVER_' + category, `缺少 ${category} 场景。`);
  }
  for (const length of [7, 8, 20, 21]) {
    const outcome = length === 8 || length === 20 ? 'accepted' : 'rejected';
    const found = cases.some(c => isObject(c) && c.category === 'boundary'
      && Array.isArray(c.ruleIds) && c.ruleIds.includes('R2')
      && isObject(c.request) && typeof c.request.password === 'string' && c.request.password.length === length
      && typeof c.request.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.request.email)
      && c.emailAlreadyRegistered === false && c.expectedResult?.outcome === outcome);
    if (!found) add('PASSWORD_BOUNDARY_' + length, `增加或修复密码实际长度 ${length} 的边界用例：邮箱合法且未注册，预期 ${outcome}。`);
  }
  return issues;
}
function verify(state, reviewerOutput) {
  const s = JSON.parse(JSON.stringify(state));
  let issues = [];
  let blocked = Boolean(s.parseError || !s.currentResult);
  if (blocked) issues.push({ id: 'WRITER_JSON', message: s.parseError || 'Writer 没有合法输出。' });
  if (!blocked) {
    issues = validateResult(s.currentResult);
    try {
      const review = parseObject(reviewerOutput);
      if (!['pass', 'fail', 'blocked'].includes(review.verdict) || !Array.isArray(review.issues)
        || !review.issues.every(i => isObject(i) && hasText(i.id) && hasText(i.message))) throw new Error('Reviewer 输出结构无效。');
      s.review = review;
      blocked = review.verdict === 'blocked';
      issues.push(...review.issues.map(i => ({ id: 'REVIEW_' + i.id, message: i.message })));
      if (review.verdict !== 'pass' && !review.issues.length) issues.push({ id: 'REVIEW_VERDICT', message: 'Reviewer 判定为 ' + review.verdict + '，请检查语义完整性。' });
    } catch (error) {
      blocked = true;
      issues.push({ id: 'REVIEW_JSON', message: error.message });
    }
  }
  const passed = !blocked && issues.length === 0 && s.review?.verdict === 'pass';
  const result = blocked ? 'blocked' : passed ? 'pass' : 'fail';
  const retry = result === 'fail' && s.round < s.maxRounds;
  s.status = blocked ? 'blocked' : passed ? 'success' : retry ? 'running' : 'failed';
  s.nextAction = retry ? 'retry' : 'stop';
  s.exitReason = retry ? null : blocked ? 'blocked' : passed ? 'passed' : 'maxRounds';
  s.feedback = { result, passed, blocked, issues,
    feedback: issues.length ? issues.map(i => `${i.id}: ${i.message}`).join('\n') : '全部检查通过。',
    nextAction: s.nextAction };
  s.historySummary.push({ round: s.round, result, caseCount: s.currentResult?.cases?.length ?? 0,
    issues: issues.map(i => ({ id: i.id, message: i.message })) });
  return s;
}
function advanceRound(state) {
  if (state.nextAction !== 'retry' || state.round >= state.maxRounds) throw new Error('Retry is not allowed.');
  const s = JSON.parse(JSON.stringify(state));
  s.round += 1;
  return s;
}
module.exports = { isObject, hasText, parseObject, initialState, buildContext, parseWriter, validateResult, verify, advanceRound };
