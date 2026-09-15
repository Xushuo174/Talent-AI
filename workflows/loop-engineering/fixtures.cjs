// Synthetic samples for routing checks. These are not model outputs.
function fixtureCases() {
  const make = (id, password, category, ruleIds, email = 'new@example.com', registered = false) => ({
    id, title: `${id}: ${category}`, category, ruleIds,
    preconditions: registered ? '该邮箱已经注册。' : '该邮箱未注册。',
    emailAlreadyRegistered: registered,
    request: { email, password }, steps: ['按请求数据调用 POST /register。', '检查注册结果。'],
    expectedResult: {
      outcome: registered || !email.includes('@') || password.length < 8 || password.length > 20 ? 'rejected' : 'accepted',
      description: '根据邮箱格式、密码长度和重复注册规则检查是否接受注册。',
    },
  });
  return { cases: [
    ...[7, 8, 20, 21].map(n => make('B' + n, 'a'.repeat(n), 'boundary', ['R2'])),
    make('N1', 'abcdefghij', 'normal', ['R1', 'R2', 'R3']),
    make('A1', 'abcdefghij', 'abnormal', ['R1'], 'invalid-email'),
    make('A2', 'abcdefghij', 'abnormal', ['R3'], 'old@example.com', true),
    make('C1', 'abc', 'combination', ['R1', 'R2'], 'invalid-email'),
  ] };
}
function fixtureWriter(state) {
  if (state.testMode === 'invalid_json') return 'This is not JSON.';
  const result = fixtureCases();
  if (state.testMode === 'always_fail' || (state.testMode === 'retry_then_pass' && state.round === 1)) {
    result.cases = result.cases.filter(c => c.id !== 'B21');
  }
  return JSON.stringify(result);
}
module.exports = { fixtureCases, fixtureWriter };
