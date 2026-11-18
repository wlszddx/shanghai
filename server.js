const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const TEST_MODE = process.argv.includes('--test-data') || process.env.EXPO_TEST_DATA === '1';
const DEMO_MODE = ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase());
const DATA_FILE = process.env.LEADS_FILE || path.join(ROOT, 'data', 'leads.json');
const PREFERENCES_FILE = process.env.PREFERENCES_FILE || path.join(path.dirname(DATA_FILE), 'preferences.json');
const PROJECTS_FILE = process.env.PROJECTS_FILE || path.join(path.dirname(DATA_FILE), 'projects.json');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'uci-bank-marketing', 'bank-full.csv');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function parseCsvLine(line) {
  const fields = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ';' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  fields.push(value);
  return fields;
}

function loadFixture(testMode = TEST_MODE) {
  if (!testMode) return null;
  const lines = fs.readFileSync(FIXTURE, 'utf8').trimEnd().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const counts = { rows: 0, positive: 0, negative: 0, jobs: {} };
  const sample = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const raw = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
    counts.rows++;
    if (raw.y === 'yes') counts.positive++;
    else if (raw.y === 'no') counts.negative++;
    counts.jobs[raw.job] = (counts.jobs[raw.job] || 0) + 1;
    if (sample.length < 3) sample.push({
      id: `uci-${i}`, source: 'uci-bank-marketing', outcome: raw.y,
      name: `UCI #${i}`, company: 'Bank Marketing dataset', role: raw.job,
      status: raw.y === 'yes' ? 'done' : 'new', tone: ['mint', 'amber', 'blue'][sample.length],
      avatar: '#', time: `原始行 ${i}`, tags: ['公开测试数据'], raw
    });
  }
  return { sample, stats: counts };
}

function readLeads(dataFile = DATA_FILE) {
  try {
    const value = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return Array.isArray(value) ? value.filter(item => item && item.source === 'manual') : [];
  } catch { return []; }
}

function sanitizeLeads(value) {
  if (!Array.isArray(value)) throw new Error('leads must be an array');
  return value.filter(item => item && typeof item === 'object' && item.source === 'manual' && !item.raw && !String(item.id || '').startsWith('uci-')).map(item => ({
    id: String(item.id || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 100),
    source: 'manual',
    name: String(item.name || '').slice(0, 120), company: String(item.company || '').slice(0, 160),
    role: String(item.role || '').slice(0, 120), avatar: String(item.avatar || '').slice(0, 8),
    tone: ['mint', 'amber', 'blue', 'lilac'].includes(item.tone) ? item.tone : 'mint',
    status: ['new', 'follow', 'done'].includes(item.status) ? item.status : 'new',
    time: String(item.time || '').slice(0, 80), tags: Array.isArray(item.tags) ? item.tags.slice(0, 10).map(x => String(x).slice(0, 60)) : [],
    note: String(item.note || '').slice(0, 12000), summary: String(item.summary || '').slice(0, 1000),
    recommend: String(item.recommend || '').slice(0, 2000), factors: Array.isArray(item.factors) ? item.factors.slice(0, 10).map(x => String(x).slice(0, 100)) : [],
    assessment: sanitizeAssessment(item.assessment),
    projectMatches: Array.isArray(item.projectMatches) ? item.projectMatches.slice(0, 50).map(match => ({
      projectId: String(match?.projectId || '').slice(0, 100), projectName: String(match?.projectName || '').slice(0, 120),
      fit: ['suitable', 'uncertain', 'unsuitable'].includes(match?.fit) ? match.fit : 'uncertain',
      summary: String(match?.summary || '').slice(0, 500), evidence: Array.isArray(match?.evidence) ? match.evidence.slice(0, 10).map(x => String(x).slice(0, 500)) : [],
      nextStep: String(match?.nextStep || '').slice(0, 500)
    })) : [],
    transcriptSegments: Array.isArray(item.transcriptSegments) ? item.transcriptSegments.slice(0, 500).map(segment => ({
      startMs: Math.max(0, Number(segment?.startMs) || 0), endMs: Math.max(0, Number(segment?.endMs) || 0),
      recordedAt: String(segment?.recordedAt || '').slice(0, 50), text: String(segment?.text || '').slice(0, 2000)
    })) : [],
    history: Array.isArray(item.history) ? item.history.slice(0, 100).map(row => [String(row?.[0] || '').slice(0, 80), String(row?.[1] || '').slice(0, 300)]) : [],
    synced: Boolean(item.synced)
  })).filter(item => item.name);
}

function normalizeProjects(value) {
  const lines = input => (Array.isArray(input) ? input : String(input || '').split(/\r?\n/))
    .map(item => String(item).trim()).filter(Boolean).slice(0, 20).map(item => item.slice(0, 160));
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const name = String(item.name || '').trim().slice(0, 120);
    if (!name) return [];
    return [{
      id: String(item.id || `project-${index + 1}`).slice(0, 100), name,
      targetCustomer: String(item.targetCustomer || '').trim().slice(0, 1200),
      mustHave: lines(item.mustHave), niceToHave: lines(item.niceToHave), disqualifiers: lines(item.disqualifiers)
    }];
  });
}

function normalizePreferences(value = {}) {
  const lines = input => (Array.isArray(input) ? input : String(input || '').split(/\r?\n/))
    .map(item => String(item).trim()).filter(Boolean).slice(0, 20).map(item => item.slice(0, 100));
  return {
    targetCustomer: String(value.targetCustomer || '').trim().slice(0, 1200),
    mustHave: lines(value.mustHave), niceToHave: lines(value.niceToHave),
    disqualifiers: lines(value.disqualifiers)
  };
}

function sanitizeAssessment(value) {
  if (!value || typeof value !== 'object') return null;
  const strings = key => Array.isArray(value[key]) ? value[key].slice(0, 20).map(item => String(item).slice(0, 100)) : [];
  return {
    matchedMust: strings('matchedMust'), unknownMust: strings('unknownMust'),
    matchedNice: strings('matchedNice'), matchedDisqualifiers: strings('matchedDisqualifiers'),
    signals: Array.isArray(value.signals) ? value.signals.slice(0, 20).map(signal => ({ label: String(signal?.label || '').slice(0, 40), evidence: String(signal?.evidence || '').slice(0, 100) })) : [],
    targetCustomer: String(value.targetCustomer || '').slice(0, 1200)
  };
}

function parseModelJson(content) {
  const cleaned = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function analyzeWithModel(text, rawPreferences, config) {
  const preferences = normalizePreferences(rawPreferences);
  const criteria = [
    ...preferences.mustHave.map(criterion => ({ category: '必选条件', criterion })),
    ...preferences.niceToHave.map(criterion => ({ category: '加分条件', criterion })),
    ...preferences.disqualifiers.map(criterion => ({ category: '排除项', criterion }))
  ];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);
  let response;
  try {
    response = await config.fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: config.maxTokens || 1200, messages: [
        { role: 'system', content: '你是销售谈话证据整理助手。只能依据用户提供的逐字谈话判断，不推测未说出的信息，不给线索打分或决定是否跟进。对每条标准分别输出状态：confirmed（明确正向支持）、contradicted（明确反向/否定）、unclear（提到但含糊或上下文不足）、not_mentioned（未提到）。特别注意否定、转折、假设、引用他人观点、时间范围和说话人归属。每个 evidence 必须是谈话原文中连续、逐字一致的片段；没有直接证据则留空并降低状态。输出严格 JSON，不要 markdown。格式：{"summary":"简短中性概述","criteriaResults":[{"category":"必选条件|加分条件|排除项","criterion":"原条件","status":"confirmed|contradicted|unclear|not_mentioned","evidence":"原文连续片段或空字符串","reasoning":"简短解释"}],"signals":[{"label":"需求|预算|决策角色|时间|其他","evidence":"原文连续片段"}],"nextQuestions":["用于核实尚不明确条件的开放式问题"]}。所有状态仅供用户复核。' },
        { role: 'user', content: JSON.stringify({ targetCustomer: preferences.targetCustomer, criteria, conversation: text }) }
      ] })
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content;
  const result = parseModelJson(raw);
  const allowed = new Set(['confirmed', 'contradicted', 'unclear', 'not_mentioned']);
  const criteriaResults = criteria.map(item => {
    const found = Array.isArray(result.criteriaResults) && result.criteriaResults.find(row => row?.category === item.category && row?.criterion === item.criterion);
    let status = allowed.has(found?.status) ? found.status : 'unclear';
    const evidence = typeof found?.evidence === 'string' && found.evidence.length <= 500 && text.includes(found.evidence) ? found.evidence : '';
    if (status !== 'not_mentioned' && !evidence) status = 'unclear';
    if (status === 'not_mentioned') return { ...item, status, evidence: '', reasoning: '谈话中没有找到直接依据。' };
    return { ...item, status, evidence, reasoning: String(found?.reasoning || '').slice(0, 500) };
  });
  const signals = Array.isArray(result.signals) ? result.signals.slice(0, 12).flatMap(signal =>
    typeof signal?.evidence === 'string' && signal.evidence && signal.evidence.length <= 500 && text.includes(signal.evidence)
      ? [{ label: String(signal.label || '谈话信号').slice(0, 40), evidence: signal.evidence }] : []) : [];
  const nextQuestions = Array.isArray(result.nextQuestions) ? result.nextQuestions.slice(0, 8).map(question => String(question).slice(0, 300)) : [];
  const summary = String(result.summary || '谈话依据已整理，请逐项核实。').slice(0, 500);
  const recommend = nextQuestions.length ? `可按需确认：${nextQuestions.join('；')} 最终是否跟进由你决定。` : '请核对原话和上下文，再由你结合业务需求决定是否跟进。';
  const pick = (category, status) => criteriaResults.filter(row => row.category === category && row.status === status).map(row => row.criterion);
  return { mode: 'llm', summary, recommend, assessment: {
    matchedMust: pick('必选条件', 'confirmed'), unknownMust: [...pick('必选条件', 'unclear'), ...pick('必选条件', 'not_mentioned')],
    matchedNice: pick('加分条件', 'confirmed'), matchedDisqualifiers: pick('排除项', 'confirmed'),
    signals, criteriaResults, targetCustomer: preferences.targetCustomer
  } };
}

async function analyzeProjectsWithModel(text, rawProjects, config) {
  const projects = normalizeProjects(rawProjects);
  if (!projects.length) throw new Error('请先创建至少一个项目并设置筛选标准。');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);
  let response;
  try {
    response = await config.fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: config.maxTokens || 1200, messages: [
        { role: 'system', content: '你是展会销售线索匹配助手。将一段真实谈话分别对照每个项目的目标客户、必选条件、加分条件和排除项，判断是否适合该项目。不要强行归入某个项目；可同时匹配多个项目。fit 只能是 suitable（有明确证据支持且无明确排除项）、uncertain（信息不足或有矛盾）、unsuitable（有明确证据不符合或命中排除项）。不能因未提及而判为不合适。每条 evidence 必须是谈话原文连续逐字一致的片段。提供简短理由和下一步建议。输出严格 JSON：{"summary":"整体摘要","contact":{"name":"","company":"","role":""},"projects":[{"projectId":"项目ID","fit":"suitable|uncertain|unsuitable","summary":"匹配理由","evidence":["原文片段"],"nextStep":"建议"}],"followUp":"跟进消息草稿"}。contact 只填写谈话中被明确说出的访客姓名、公司、职位；未提及或不确定一律空字符串，禁止猜测。followUp 是一段可直接发给客户的跟进消息，只基于谈话中明确出现的信息，120 字以内；不要编造价格、承诺、时间或对方未提过的内容；信息不足时写成一句自然的确认问题。followUp 必须与匹配结论一致：有 suitable 项目时提出一个具体、低门槛的下一步；只有 uncertain 时只问一个最能补齐关键条件的问题；全部 unsuitable 时礼貌收尾、不强行邀约。只输出一段话，不要标题、署名、括号占位符或“以下是”等说明，不知道姓名就用“您好”。每个输入项目都必须输出一条结果，不要输出输入以外的项目。' },
        { role: 'user', content: JSON.stringify({ projects, conversation: text }) }
      ] })
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const payload = await response.json();
  const result = parseModelJson(payload?.choices?.[0]?.message?.content);
  const rawMatches = Array.isArray(result.projects) ? result.projects : [];
  const projectMatches = projects.map(project => {
    const found = rawMatches.find(row => row?.projectId === project.id);
    let fit = ['suitable', 'uncertain', 'unsuitable'].includes(found?.fit) ? found.fit : 'uncertain';
    const evidence = Array.isArray(found?.evidence) ? found.evidence.slice(0, 10).filter(value => typeof value === 'string' && value && value.length <= 500 && text.includes(value)) : [];
    if (fit !== 'uncertain' && !evidence.length) fit = 'uncertain';
    return { projectId: project.id, projectName: project.name, fit, summary: String(found?.summary || '谈话依据不足，请核实。').slice(0, 500), evidence, nextStep: String(found?.nextStep || '补充确认关键信息。').slice(0, 500) };
  });
  return { mode: 'llm', summary: String(result.summary || '谈话已整理。').slice(0, 500), projectMatches, followUp: String(result.followUp || '').trim().slice(0, 300), contact: {
    name: String(result.contact?.name || '').trim().slice(0, 60),
    company: String(result.contact?.company || '').trim().slice(0, 160),
    role: String(result.contact?.role || '').trim().slice(0, 60)
  } };
}

async function draftProjectWithModel(brief, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 30000);
  let response;
  try {
    response = await config.fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0.2, max_tokens: 700, messages: [
        { role: 'system', content: '你是会展销售线索管理助手。根据用户对业务的简短描述，起草一个用于展会现场谈话归类的项目筛选标准。输出严格 JSON：{"name":"项目名称","targetCustomer":"目标客户，一句话","mustHave":["必选条件"],"niceToHave":["加分条件"],"disqualifiers":["排除项"]}。条件必须具体、可从谈话中直接判断，避免「有意向」这类空泛表述；只使用描述中出现的业务信息，不要新增描述中没有的客户特征、审批层级或时间要求；描述中的常规做法不要升级为必选条件；不要编造用户没有提到的行业细节；全部用中文；每类 1-5 条。' },
        { role: 'user', content: brief }
      ] })
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
  const payload = await response.json();
  const result = parseModelJson(payload?.choices?.[0]?.message?.content);
  const [project] = normalizeProjects([{ ...result, id: `project-${Date.now()}` }]);
  if (!project) throw new Error('生成结果缺少项目名称，请补充业务描述后重试。');
  return project;
}

function sendJson(res, code, value, extraHeaders = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(value));
}

async function bodyMultipartFile(req, maxBytes = 26_000_000) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(req.headers['content-type'] || '');
  if (!boundary) throw new Error('multipart boundary missing');
  const marker = Buffer.from(`--${(boundary[1] || boundary[2]).trim()}`);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new Error('audio file too large'); chunks.push(chunk); }
  const body = Buffer.concat(chunks);
  let part = body.indexOf(marker);
  while (part >= 0) {
    const headersStart = part + marker.length + 2;
    const headersEnd = body.indexOf(Buffer.from('\r\n\r\n'), headersStart);
    if (headersEnd < 0) break;
    const headers = body.toString('utf8', headersStart, headersEnd);
    const next = body.indexOf(marker, headersEnd + 4);
    if (next < 0) break;
    if (/name="audio"/.test(headers) && /filename="([^"]*)"/.test(headers)) {
      const filename = /filename="([^"]*)"/.exec(headers)?.[1] || 'recording.webm';
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || 'application/octet-stream';
      return { buffer: body.subarray(headersEnd + 4, next - 2), filename, type };
    }
    part = next;
  }
  throw new Error('audio file missing');
}

function transcodeToWav(buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let size = 0;
    ffmpeg.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 100_000_000) { ffmpeg.kill(); reject(new Error('audio file too large')); return; }
      chunks.push(chunk);
    });
    ffmpeg.on('error', error => reject(error.code === 'ENOENT' ? new Error('服务器缺少音频格式转换组件 ffmpeg。') : error));
    ffmpeg.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('录音格式转换失败，请重试或使用其他浏览器。')));
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(buffer);
  });
}

function tencentSignature(secretKey, host, pathName, params) {
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(sorted).toString();
  const source = `POST${host}${pathName}?${query}`;
  return crypto.createHmac('sha1', secretKey).update(source).digest('base64');
}

function transcribeWithTencent(audio, config) {
  const host = 'asr.cloud.tencent.com';
  const pathName = `/asr/flash/v1/${encodeURIComponent(config.appId)}`;
  const params = new URLSearchParams({
    convert_num_mode: '1', engine_type: config.model || '16k_zh_en', filter_dirty: '0', filter_modal: '0',
    filter_punc: '0', first_channel_only: '1', hotword_id: '', secretid: config.secretId,
    speaker_diarization: config.speakerDiarization ? '1' : '0', timestamp: String(Math.floor(Date.now() / 1000)), voice_format: 'wav', word_info: '1'
  });
  const authorization = tencentSignature(config.secretKey, host, pathName, params);
  return config.fetch(`https://${host}${pathName}?${params.toString()}`, {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/octet-stream', 'Content-Length': String(audio.length) },
    body: audio, signal: config.signal
  });
}

function normalizeTencentResult(result) {
  const channels = Array.isArray(result.flash_result) ? result.flash_result : [];
  const sentences = channels.flatMap(channel => Array.isArray(channel.sentence_list) ? channel.sentence_list : []);
  const segments = sentences.map(sentence => {
    const speaker = Number(sentence.speaker_id);
    return {
      startMs: Math.max(0, Number(sentence.start_time) || 0), endMs: Math.max(0, Number(sentence.end_time) || 0),
      text: String(sentence.text || '').trim(),
      ...(Number.isInteger(speaker) ? { speaker } : {})
    };
  }).filter(segment => segment.text).slice(0, 1000);
  const lines = segments.reduce((list, segment) => {
    const last = list[list.length - 1];
    if (last && last.speaker === segment.speaker) last.text += segment.text;
    else list.push({ speaker: segment.speaker, text: segment.text });
    return list;
  }, []);
  const text = segments.some(segment => segment.speaker !== undefined)
    ? lines.map(line => `${line.speaker === undefined ? '' : `说话人${line.speaker + 1}：`}${line.text}`).join('\n')
    : channels.map(channel => String(channel.text || '')).filter(Boolean).join('\n').trim();
  return { text, segments };
}

async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) throw new Error('request too large'); }
  return JSON.parse(raw || '{}');
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function createWindowLimiter(limit, windowMs) {
  const buckets = new Map();
  return {
    hit(key) {
      if (!limit) return { allowed: true, remaining: Infinity, retryAfter: 0 };
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count++;
      if (buckets.size > 5000) {
        for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
      }
      const allowed = bucket.count <= limit;
      return { allowed, remaining: Math.max(0, limit - bucket.count), retryAfter: allowed ? 0 : Math.ceil((bucket.resetAt - now) / 1000) };
    }
  };
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const real = String(req.headers?.['x-real-ip'] || '').trim();
    if (real) return real.slice(0, 64);
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1].slice(0, 64);
  }
  return String(req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

function createServer(options = {}) {
  const demoMode = options.demoMode ?? DEMO_MODE;
  const testMode = !demoMode && (options.testMode ?? TEST_MODE);
  const dataFile = options.dataFile || DATA_FILE;
  const preferencesFile = options.preferencesFile || (options.dataFile ? path.join(path.dirname(dataFile), 'preferences.json') : PREFERENCES_FILE);
  const projectsFile = options.projectsFile || (options.dataFile ? path.join(path.dirname(dataFile), 'projects.json') : PROJECTS_FILE);
  const llmConfig = options.llmConfig || {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '', model: process.env.LLM_MODEL || '',
    fetch: options.fetch || globalThis.fetch, timeoutMs: 30000,
    maxTokens: positiveInt(process.env.LLM_MAX_TOKENS, 1200)
  };
  const sttConfig = options.sttConfig || {
    provider: process.env.STT_PROVIDER || (process.env.TENCENTCLOUD_APP_ID ? 'tencent' : 'openai'),
    baseUrl: process.env.STT_BASE_URL || '', apiKey: process.env.STT_API_KEY || '',
    appId: process.env.TENCENTCLOUD_APP_ID || '', secretId: process.env.TENCENTCLOUD_SECRET_ID || '', secretKey: process.env.TENCENTCLOUD_SECRET_KEY || '',
    model: process.env.STT_MODEL || (process.env.TENCENTCLOUD_APP_ID ? '16k_zh_en' : ''),
    speakerDiarization: process.env.STT_SPEAKER_DIARIZATION !== '0',
    fetch: options.fetch || globalThis.fetch, transcode: options.transcode || transcodeToWav, timeoutMs: 120000
  };
  if (sttConfig.speakerDiarization === undefined) sttConfig.speakerDiarization = process.env.STT_SPEAKER_DIARIZATION !== '0';
  const sttEnabled = () => sttConfig.provider === 'tencent'
    ? Boolean(sttConfig.appId && sttConfig.secretId && sttConfig.secretKey && sttConfig.model && sttConfig.fetch)
    : Boolean(sttConfig.apiKey && sttConfig.model && sttConfig.baseUrl && sttConfig.fetch);
  const trustProxy = options.trustProxy ?? ['1', 'true'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
  const maxTranscriptChars = positiveInt(options.maxTranscriptChars ?? process.env.MAX_TRANSCRIPT_CHARS, 20000);
  const rateLimits = {
    aiPerHour: positiveInt(options.rateLimits?.aiPerHour ?? process.env.AI_RATE_LIMIT_PER_HOUR, 30),
    sttPerHour: positiveInt(options.rateLimits?.sttPerHour ?? process.env.STT_RATE_LIMIT_PER_HOUR, 10),
    aiGlobalPerDay: positiveInt(options.rateLimits?.aiGlobalPerDay ?? process.env.AI_DAILY_LIMIT, 500)
  };
  const aiLimiter = createWindowLimiter(rateLimits.aiPerHour, 3600_000);
  const sttLimiter = createWindowLimiter(rateLimits.sttPerHour, 3600_000);
  const aiGlobalLimiter = createWindowLimiter(rateLimits.aiGlobalPerDay, 86400_000);
  const rejectWithLimit = (res, retryAfter) => sendJson(res, 429, {
    error: '演示请求过于频繁，请稍后再试。', retryAfter
  }, { 'Retry-After': String(retryAfter) });
  const enforceAiLimit = (req, res) => {
    const perIp = aiLimiter.hit(clientIp(req, trustProxy));
    const global = aiGlobalLimiter.hit('global');
    if (perIp.allowed && global.allowed) return true;
    rejectWithLimit(res, Math.max(perIp.retryAfter, global.retryAfter, 1));
    return false;
  };
  const enforceSttLimit = (req, res) => {
    const perIp = sttLimiter.hit(clientIp(req, trustProxy));
    if (perIp.allowed) return true;
    rejectWithLimit(res, Math.max(perIp.retryAfter, 1));
    return false;
  };
  let fixture;
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/config') return sendJson(res, 200, {
        testMode, demoMode, llmEnabled: Boolean(llmConfig.apiKey && llmConfig.model && llmConfig.fetch),
        sttEnabled: sttEnabled()
      });
      if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, mode: demoMode ? 'demo' : testMode ? 'test' : 'business' });
      if (req.method === 'GET' && url.pathname === '/api/leads') return sendJson(res, 200, { leads: demoMode ? [] : readLeads(dataFile) });
      if (req.method === 'GET' && url.pathname === '/api/preferences') {
        if (demoMode) return sendJson(res, 200, { preferences: normalizePreferences({}) });
        let preferences = {};
        try { preferences = JSON.parse(fs.readFileSync(preferencesFile, 'utf8')); } catch {}
        return sendJson(res, 200, { preferences: normalizePreferences(preferences) });
      }
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        if (demoMode) return sendJson(res, 200, { projects: [] });
        let projects = [];
        try { projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8')); } catch {}
        return sendJson(res, 200, { projects: normalizeProjects(projects) });
      }
      if (req.method === 'PUT' && url.pathname === '/api/projects') {
        const data = await bodyJson(req);
        const projects = normalizeProjects(data.projects);
        if (!demoMode) {
          fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
          fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
        }
        return sendJson(res, 200, { projects });
      }
      if (req.method === 'PUT' && url.pathname === '/api/preferences') {
        const data = await bodyJson(req);
        const preferences = normalizePreferences(data.preferences || {});
        if (!demoMode) {
          fs.mkdirSync(path.dirname(preferencesFile), { recursive: true });
          fs.writeFileSync(preferencesFile, JSON.stringify(preferences, null, 2));
        }
        return sendJson(res, 200, { preferences });
      }
      if (req.method === 'PUT' && url.pathname === '/api/leads') {
        const data = await bodyJson(req);
        const leads = sanitizeLeads(data.leads);
        if (!demoMode) {
          fs.mkdirSync(path.dirname(dataFile), { recursive: true });
          fs.writeFileSync(dataFile, JSON.stringify(leads, null, 2));
        }
        return sendJson(res, 200, { leads: demoMode ? [] : leads });
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/analyze') {
        const data = await bodyJson(req);
        if (typeof data.text !== 'string' || !data.text.trim()) return sendJson(res, 400, { error: 'text is required' });
        const text = data.text.trim();
        if (text.length > maxTranscriptChars) return sendJson(res, 413, { error: `谈话内容过长（最多 ${maxTranscriptChars} 字），请分段录入。` });
        if (!llmConfig.apiKey || !llmConfig.model || !llmConfig.fetch) {
          return sendJson(res, 503, { error: '模型 API 未配置，请设置 LLM_API_KEY 和 LLM_MODEL 后重启服务。' });
        }
        if (!enforceAiLimit(req, res)) return;
        try { return sendJson(res, 200, await analyzeWithModel(text, data.preferences || {}, llmConfig)); }
        catch (error) {
          const status = error.name === 'AbortError' ? 504 : 502;
          return sendJson(res, status, { error: status === 504 ? '模型 API 请求超时，请稍后重试。' : '模型 API 分析失败，请检查服务商配置后重试。' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/classify') {
        const data = await bodyJson(req);
        if (typeof data.text !== 'string' || !data.text.trim()) return sendJson(res, 400, { error: 'text is required' });
        const text = data.text.trim();
        if (text.length > maxTranscriptChars) return sendJson(res, 413, { error: `谈话内容过长（最多 ${maxTranscriptChars} 字），请分段录入。` });
        if (!llmConfig.apiKey || !llmConfig.model || !llmConfig.fetch) return sendJson(res, 503, { error: '模型 API 未配置，请设置 LLM_API_KEY 和 LLM_MODEL 后重启服务。' });
        if (!enforceAiLimit(req, res)) return;
        try { return sendJson(res, 200, await analyzeProjectsWithModel(text, data.projects, llmConfig)); }
        catch (error) {
          const status = error.name === 'AbortError' ? 504 : 502;
          return sendJson(res, status, { error: status === 504 ? '模型 API 请求超时，请稍后重试。' : (error.message.includes('创建至少一个项目') ? error.message : '模型 API 分析失败，请检查服务商配置后重试。') });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/projects-draft') {
        const data = await bodyJson(req);
        const brief = typeof data.brief === 'string' ? data.brief.trim() : '';
        if (!brief) return sendJson(res, 400, { error: 'brief is required' });
        if (brief.length > 1200) return sendJson(res, 413, { error: '业务描述过长（最多 1200 字），请精简后重试。' });
        if (!llmConfig.apiKey || !llmConfig.model || !llmConfig.fetch) return sendJson(res, 503, { error: '模型 API 未配置，请设置 LLM_API_KEY 和 LLM_MODEL 后重启服务。' });
        if (!enforceAiLimit(req, res)) return;
        try { return sendJson(res, 200, { project: await draftProjectWithModel(brief, llmConfig) }); }
        catch (error) {
          const status = error.name === 'AbortError' ? 504 : 502;
          return sendJson(res, status, { error: status === 504 ? '模型 API 请求超时，请稍后重试。' : (error.message.includes('生成结果') ? error.message : '模型 API 起草失败，请检查服务商配置后重试。') });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/transcribe') {
        if (!sttEnabled()) return sendJson(res, 503, { error: '语音转写服务尚未配置。' });
        if (!enforceSttLimit(req, res)) return;
        const audio = await bodyMultipartFile(req, 100_000_000);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), sttConfig.timeoutMs || 120000);
        let response;
        try {
          if (sttConfig.provider === 'tencent') {
            const isWav = /audio\/wav|audio\/x-wav/i.test(audio.type) || /\.wav$/i.test(audio.filename);
            const wav = isWav ? audio.buffer : await sttConfig.transcode(audio.buffer);
            response = await transcribeWithTencent(wav, { ...sttConfig, signal: controller.signal });
          } else {
            const form = new FormData();
            form.append('file', new Blob([audio.buffer], { type: audio.type }), audio.filename);
            form.append('model', sttConfig.model);
            form.append('response_format', 'verbose_json');
            response = await sttConfig.fetch(`${sttConfig.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
              method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${sttConfig.apiKey}` }, body: form
            });
          }
        } catch (error) {
          console.error('transcribe request failed:', sttConfig.provider, error.message);
          return sendJson(res, error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? '语音转写请求超时，请稍后重试。' : '语音转写服务暂不可用，请检查服务器依赖与服务配置。' });
        } finally { clearTimeout(timeout); }
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.error('transcribe provider HTTP error:', sttConfig.provider, response.status, detail.slice(0, 500));
          return sendJson(res, 502, { error: '语音转写服务调用失败，请检查后端语音服务配置。' });
        }
        const result = await response.json();
        if (sttConfig.provider === 'tencent') {
          if (Number(result.code) !== 0) {
            console.error('tencent asr error:', result.code, result.message, result.request_id);
            const reasons = {
              4001: '请求参数不正确', 4002: '鉴权失败，请检查密钥', 4003: '服务未开通', 4004: '资源包不可用，请确认资源包覆盖当前识别引擎',
              4005: '账户欠费', 4006: '调用并发超限，请稍后重试', 4007: '音频解码失败，请重新录制', 4011: '录音文件过大', 4012: '没有录到音频'
            };
            const reason = reasons[Number(result.code)] || result.message || '请稍后重试';
            return sendJson(res, 502, { error: `腾讯云语音识别失败：${reason}（${result.code}）` });
          }
          return sendJson(res, 200, normalizeTencentResult(result));
        }
        const segments = Array.isArray(result.segments) ? result.segments.slice(0, 1000).map(segment => ({ startMs: Math.max(0, Number(segment.start || 0) * 1000), endMs: Math.max(0, Number(segment.end || 0) * 1000), text: String(segment.text || '').trim() })).filter(segment => segment.text) : [];
        return sendJson(res, 200, { text: String(result.text || '').trim(), segments });
      }
      if (req.method === 'GET' && url.pathname === '/api/test-data' && testMode) {
        fixture ||= loadFixture(testMode);
        return sendJson(res, 200, fixture);
      }
      if (req.method === 'GET' && url.pathname === '/api/test-data.csv' && testMode) {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bank-full.csv"', 'Cache-Control': 'no-store' });
        return fs.createReadStream(FIXTURE).pipe(res);
      }
      const assetPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const fullPath = path.resolve(ROOT, `.${assetPath}`);
      if (!fullPath.startsWith(ROOT + path.sep) || !['.html', '.js', '.css'].includes(path.extname(fullPath))) return sendJson(res, 404, { error: 'not found' });
      fs.readFile(fullPath, (error, contents) => {
        if (error) return sendJson(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath)], 'Cache-Control': 'no-store' });
        res.end(contents);
      });
    } catch (error) {
      sendJson(res, ['request too large', 'audio file too large'].includes(error.message) ? 413 : 400, { error: error.message });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Expo Copilot (${TEST_MODE ? 'test' : 'business'} mode) listening on http://${host}:${port}`));
}

module.exports = { createServer, TEST_MODE, loadFixture, sanitizeLeads, normalizePreferences, normalizeProjects, analyzeWithModel, analyzeProjectsWithModel, parseCsvLine, tencentSignature, normalizeTencentResult };
