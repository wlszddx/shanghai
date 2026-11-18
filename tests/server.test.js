const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { createServer } = require('../server');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'tests', 'fixtures', 'uci-bank-marketing', 'bank-full.csv');

function request(server, method, url, body, requestHeaders = {}) {
  return new Promise((resolve, reject) => {
    let status = 200, headers = {}, content = '';
    const response = new Writable({ write(chunk, encoding, callback) { content += chunk.toString(); callback(); } });
    response.writeHead = (code, value) => { status = code; headers = value; };
    response.on('finish', () => resolve({ status, headers, content, json: () => JSON.parse(content) }));
    response.on('error', reject);
    const req = { method, url, headers: requestHeaders, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); } };
    try { server.emit('request', req, response); } catch (error) { reject(error); }
  });
}

test('fixture is real UCI data with expected source counts and unmodified header', () => {
  const lines = fs.readFileSync(fixture, 'utf8').trimEnd().split(/\r?\n/);
  assert.equal(lines.length - 1, 45211);
  assert.equal(lines[0], '"age";"job";"marital";"education";"default";"balance";"housing";"loan";"contact";"day";"month";"duration";"campaign";"pdays";"previous";"poutcome";"y"');
  const yes = lines.slice(1).filter(line => line.endsWith(';"yes"')).length;
  const no = lines.slice(1).filter(line => line.endsWith(';"no"')).length;
  assert.deepEqual({ yes, no }, { yes: 5289, no: 39922 });
});

test('default business mode does not load or expose the test fixture', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const server = createServer({ testMode: false, dataFile: path.join(dir, 'leads.json') });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual((await request(server, 'GET', '/api/config')).json(), { testMode: false, demoMode: false, llmEnabled: false, sttEnabled: false });
  assert.deepEqual((await request(server, 'GET', '/api/leads')).json(), { leads: [] });
  assert.equal((await request(server, 'GET', '/api/test-data')).status, 404);
  assert.equal((await request(server, 'GET', '/api/test-data.csv')).status, 404);
});

test('test mode exposes fixture separately and never persists test records as leads', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const dataFile = path.join(dir, 'leads.json');
  const server = createServer({ testMode: true, dataFile });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual((await request(server, 'GET', '/api/config')).json(), { testMode: true, demoMode: false, llmEnabled: false, sttEnabled: false });
  const testDataResponse = await request(server, 'GET', '/api/test-data');
  const data = testDataResponse.json();
  assert.equal(data.stats.rows, 45211);
  assert.equal(data.stats.positive, 5289);
  assert.equal(data.stats.negative, 39922);
  assert.equal(data.sample.length, 3);
  assert.equal(data.sample[0].raw.age, '58');
  const csv = await request(server, 'GET', '/api/test-data.csv');
  assert.equal(csv.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(csv.content.trimEnd().split(/\r?\n/).length - 1, 45211);

  const write = await request(server, 'PUT', '/api/leads', { leads: [data.sample[0], { id: 'fake-uci-1', name: 'Fake test lead', source: 'anything' }, { id: 'manual-1', name: 'User lead', note: '真实交流记录', source: 'manual' }] });
  assert.equal(write.status, 200);
  const stored = (await request(server, 'GET', '/api/leads')).json();
  assert.equal(stored.leads.length, 1);
  assert.equal(stored.leads[0].source, 'manual');
  assert.equal(stored.leads[0].name, 'User lead');
  assert.equal(JSON.stringify(stored).includes('Bank Marketing'), false);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).length, 1);
});

test('demo mode never persists leads or projects and keeps test data disabled', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-demo-'));
  const dataFile = path.join(dir, 'leads.json');
  const server = createServer({ demoMode: true, dataFile });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const config = (await request(server, 'GET', '/api/config')).json();
  assert.equal(config.demoMode, true);
  assert.equal(config.testMode, false);

  const leads = [{ id: 'manual-1', name: '演示线索', note: '示例谈话', source: 'manual' }];
  assert.equal((await request(server, 'PUT', '/api/leads', { leads })).status, 200);
  assert.deepEqual((await request(server, 'GET', '/api/leads')).json(), { leads: [] });
  assert.equal(fs.existsSync(dataFile), false);

  const projects = [{ id: 'p1', name: '项目甲', mustHave: ['近期需求'] }];
  assert.equal((await request(server, 'PUT', '/api/projects', { projects })).status, 200);
  assert.deepEqual((await request(server, 'GET', '/api/projects')).json(), { projects: [] });
  assert.equal(fs.existsSync(path.join(dir, 'projects.json')), false);
  assert.equal((await request(server, 'GET', '/api/test-data')).status, 404);
});

test('demo mode rate limits model calls per client', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-limit-'));
  let calls = 0;
  const server = createServer({
    demoMode: true, dataFile: path.join(dir, 'leads.json'),
    rateLimits: { aiPerHour: 2, sttPerHour: 1, aiGlobalPerDay: 10 },
    llmConfig: {
      baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
      fetch: async () => {
        calls++;
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
          summary: '有明确需求。', projects: [{ projectId: 'p1', fit: 'suitable', summary: '有需求', evidence: ['有需求'], nextStep: '安排跟进。' }]
        }) } }] }) };
      }
    }
  });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const payload = { text: '对方说有需求。', projects: [{ id: 'p1', name: '项目甲', mustHave: ['有需求'] }] };
  assert.equal((await request(server, 'POST', '/api/agent/classify', payload)).status, 200);
  assert.equal((await request(server, 'POST', '/api/agent/classify', payload)).status, 200);
  const limited = await request(server, 'POST', '/api/agent/classify', payload);
  assert.equal(limited.status, 429);
  assert.match(limited.json().error, /过于频繁/);
  assert.ok(limited.headers['Retry-After']);
  assert.equal(calls, 2);
});

test('user-defined criteria persist and analysis requires a configured model API', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const server = createServer({ testMode: false, dataFile: path.join(dir, 'leads.json') });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const preferences = { targetCustomer: '展会主办方', mustHave: ['线索管理需求', '下季度采购'], niceToHave: ['预算已审批'], disqualifiers: ['暂不采购'] };
  const saved = await request(server, 'PUT', '/api/preferences', { preferences });
  assert.deepEqual(saved.json().preferences, preferences);
  assert.deepEqual((await request(server, 'GET', '/api/preferences')).json().preferences, preferences);
  const response = await request(server, 'POST', '/api/agent/analyze', { text: '实际谈话内容', preferences });
  assert.equal(response.status, 503);
  assert.match(response.json().error, /LLM_API_KEY/);
});

test('LLM analysis distinguishes negation and only keeps verbatim evidence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const server = createServer({
    testMode: false, dataFile: path.join(dir, 'leads.json'),
    llmConfig: {
      baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
      fetch: async (url, options) => {
        assert.equal(url, 'https://example.test/v1/chat/completions');
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
          summary: '对方明确表示目前没有该需求。',
          criteriaResults: [
            { category: '必选条件', criterion: '线索管理需求', status: 'contradicted', evidence: '我们目前没有线索管理需求', reasoning: '明确否定当前需求。' },
            { category: '必选条件', criterion: '下季度采购', status: 'confirmed', evidence: '对方计划下季度采购', reasoning: '原文没有这句话。' }
          ], signals: [], nextQuestions: ['未来是否会考虑此类工具？']
        }) } }] }) };
      }
    }
  });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const response = await request(server, 'POST', '/api/agent/analyze', {
    text: '我们目前没有线索管理需求。', preferences: { mustHave: ['线索管理需求', '下季度采购'] }
  });
  const result = response.json();
  assert.equal(result.mode, 'llm');
  assert.equal(result.assessment.criteriaResults[0].status, 'contradicted');
  assert.equal(result.assessment.criteriaResults[0].evidence, '我们目前没有线索管理需求');
  assert.equal(result.assessment.criteriaResults[1].status, 'unclear');
  assert.equal(result.assessment.criteriaResults[1].evidence, '');
});

test('LLM configuration status is exposed without revealing its secret', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const server = createServer({ dataFile: path.join(dir, 'leads.json'), llmConfig: { apiKey: 'secret-value', model: 'demo', baseUrl: 'https://example.test/v1', fetch: async () => {} } });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const config = (await request(server, 'GET', '/api/config')).json();
  assert.deepEqual(Object.keys(config).sort(), ['demoMode', 'llmEnabled', 'sttEnabled', 'testMode']);
  assert.equal(config.llmEnabled, true);
  assert.equal(JSON.stringify(config).includes('secret-value'), false);
  assert.equal(JSON.stringify(config).includes('example.test'), false);
});

test('model API cannot be configured through the user-facing endpoint', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-test-'));
  const server = createServer({ dataFile: path.join(dir, 'leads.json') });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const response = await request(server, 'PUT', '/api/llm-config', { apiKey: 'private-test-key', model: 'sales-model' });
  assert.equal(response.status, 404);
  assert.deepEqual((await request(server, 'GET', '/api/config')).json(), { testMode: false, demoMode: false, llmEnabled: false, sttEnabled: false });
});

test('projects persist per data directory and project classification keeps only verbatim evidence', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-projects-'));
  const server = createServer({ testMode: false, dataFile: path.join(dir, 'leads.json'), llmConfig: {
    baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model', timeoutMs: 1000,
    fetch: async (_url, options) => {
      const sent = JSON.parse(options.body);
      const project = sent.messages[1].content;
      assert.match(project, /项目甲/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        summary: '明确表达现阶段没有采购需求。', projects: [
          { projectId: 'p1', fit: 'suitable', summary: '有意向', evidence: ['我们正在考虑下季度采购'], nextStep: '确认预算。' },
          { projectId: 'p2', fit: 'unsuitable', summary: '目前无采购需求', evidence: ['没有采购需求'], nextStep: '暂缓跟进。' }
        ]
      }) } }] }) };
    }
  } });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const projects = [
    { id: 'p1', name: '项目甲', targetCustomer: '企业客户', mustHave: ['近期采购'], niceToHave: [], disqualifiers: [] },
    { id: 'p2', name: '项目乙', targetCustomer: '企业客户', mustHave: [], niceToHave: [], disqualifiers: ['没有采购需求'] }
  ];
  assert.deepEqual((await request(server, 'PUT', '/api/projects', { projects })).json().projects, projects);
  assert.deepEqual((await request(server, 'GET', '/api/projects')).json().projects, projects);
  const classified = await request(server, 'POST', '/api/agent/classify', { text: '对方说：“我们目前没有采购需求。”', projects });
  assert.equal(classified.status, 200);
  const matches = classified.json().projectMatches;
  assert.equal(matches.length, 2);
  assert.equal(matches[0].fit, 'uncertain');
  assert.deepEqual(matches[0].evidence, []);
  assert.equal(matches[1].fit, 'unsuitable');
  assert.deepEqual(matches[1].evidence, ['没有采购需求']);
});

test('transcription endpoint forwards audio to configured provider and returns timed segments', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-stt-'));
  const server = createServer({ dataFile: path.join(dir, 'leads.json'), sttConfig: {
    baseUrl: 'https://speech.example/v1', apiKey: 'speech-secret', model: 'speech-model', timeoutMs: 1000,
    fetch: async (url, options) => {
      assert.equal(url, 'https://speech.example/v1/audio/transcriptions');
      assert.equal(options.headers.Authorization, 'Bearer speech-secret');
      assert.equal(options.body.get('model'), 'speech-model');
      assert.equal(options.body.get('response_format'), 'verbose_json');
      assert.equal((await options.body.get('file').text()), 'audio-bytes');
      return { ok: true, json: async () => ({ text: '有采购计划。', segments: [{ start: 1.25, end: 2.5, text: '有采购计划。' }] }) };
    }
  } });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const boundary = 'test-boundary';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\naudio-bytes\r\n--${boundary}--\r\n`);
  const response = await request(server, 'POST', '/api/transcribe', body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(response.status, 200, JSON.stringify(response.json()));
  assert.deepEqual(response.json(), { text: '有采购计划。', segments: [{ startMs: 1250, endMs: 2500, text: '有采购计划。' }] });
});

test('Tencent ASR accepts browser audio, signs the request, converts returned timestamps and keeps credentials private', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-copilot-tencent-asr-'));
  let called = false;
  const server = createServer({ dataFile: path.join(dir, 'leads.json'), sttConfig: {
    provider: 'tencent', appId: 'app-123', secretId: 'secret-id', secretKey: 'secret-key', model: '16k_zh_en', timeoutMs: 1000,
    transcode: async bytes => { assert.equal(bytes.toString(), 'browser-webm'); return Buffer.from('wav-audio'); },
    fetch: async (url, options) => {
      called = true;
      const parsed = new URL(url);
      assert.equal(parsed.hostname, 'asr.cloud.tencent.com');
      assert.equal(parsed.pathname, '/asr/flash/v1/app-123');
      assert.equal(parsed.searchParams.get('secretid'), 'secret-id');
      assert.equal(parsed.searchParams.get('engine_type'), '16k_zh_en');
      assert.equal(parsed.searchParams.get('voice_format'), 'wav');
      assert.equal(parsed.searchParams.get('speaker_diarization'), '1');
      assert.equal(parsed.searchParams.has('speaker_number'), false);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      assert.equal(options.body.toString(), 'wav-audio');
      const sorted = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
      const canonical = `POSTasr.cloud.tencent.com${parsed.pathname}?${new URLSearchParams(sorted).toString()}`;
      const expectedSignature = crypto.createHmac('sha1', 'secret-key').update(canonical).digest('base64');
      assert.equal(options.headers.Authorization, expectedSignature);
      return { ok: true, json: async () => ({ code: 0, flash_result: [{ text: '正在寻找供应商。我们是做包装设备的。下季度有采购计划。', sentence_list: [
        { text: '正在寻找供应商。', start_time: 450, end_time: 1620, speaker_id: 0 },
        { text: '我们是做包装设备的。', start_time: 1700, end_time: 3200, speaker_id: 1 },
        { text: '下季度有采购计划。', start_time: 3300, end_time: 4500, speaker_id: 0 }
      ] }] }) };
    }
  } });
  t.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const config = (await request(server, 'GET', '/api/config')).json();
  assert.equal(config.sttEnabled, true);
  assert.equal(JSON.stringify(config).includes('secret-key'), false);

  const boundary = 'tencent-boundary';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="recording.webm"\r\nContent-Type: audio/webm\r\n\r\nbrowser-webm\r\n--${boundary}--\r\n`);
  const response = await request(server, 'POST', '/api/transcribe', body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(response.status, 200, JSON.stringify(response.json()));
  assert.equal(called, true);
  assert.deepEqual(response.json(), { text: '说话人1：正在寻找供应商。\n说话人2：我们是做包装设备的。\n说话人1：下季度有采购计划。', segments: [
    { startMs: 450, endMs: 1620, text: '正在寻找供应商。', speaker: 0 },
    { startMs: 1700, endMs: 3200, text: '我们是做包装设备的。', speaker: 1 },
    { startMs: 3300, endMs: 4500, text: '下季度有采购计划。', speaker: 0 }
  ] });
});
