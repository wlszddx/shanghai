(() => {
  let storageKey = 'expo-copilot-user-leads-v3';
  const demoLeadsKey = 'expo-copilot-demo-leads-v1';
  const demoProjectsKey = 'expo-copilot-demo-projects-v1';
  const $ = selector => document.querySelector(selector);
  const list = $('#lead-list'), detail = $('#detail-panel');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let leads = [], testRecords = [], datasetStats = null, projects = [], testMode = false, demoMode = false, llmEnabled = false, sttEnabled = false, activeId = null, filter = 'all', view = 'inbox', toastTimer;

  const loadCachedLeads = () => {
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(cached)) leads = cached.filter(lead => lead.source !== 'uci-bank-marketing');
    } catch {}
  };
  const readDemoProjects = () => {
    try { const value = JSON.parse(localStorage.getItem(demoProjectsKey)); return Array.isArray(value) ? value : []; } catch { return []; }
  };
  const demoProjectSeed = {
    id: 'demo-project-1', name: '示例项目：产线自动化改造',
    targetCustomer: '正在评估产线自动化或视觉检测改造的制造企业',
    mustHave: ['明确提到自动化或产线改造需求', '有近期采购或试点计划'],
    niceToHave: ['已有预算', '决策人参与沟通'], disqualifiers: ['明确表示暂无采购计划']
  };
  const demoLeadSeed = {
    id: 'demo-lead-1', source: 'manual', name: '示例访客 · 张工', company: '示例制造企业（非真实客户）',
    role: '生产负责人', avatar: '示', tone: 'mint', status: 'new', time: '示例数据',
    tags: ['示例数据'], note: '（以下为示例谈话，不是真实客户记录）\n张工：我们这条产线目前人工检测效率比较低，正在看视觉检测和自动化改造方案。预算还在审批，计划明年一季度先做一条试点线，目前没有采购过类似设备。',
    summary: '', recommend: '', factors: [], assessment: null, projectMatches: [], transcriptSegments: [],
    history: [['示例数据', '仅用于演示，可随时重置']]
  };
  const persist = () => {
    const userLeads = leads.filter(lead => lead.source === 'manual');
    localStorage.setItem(storageKey, JSON.stringify(userLeads));
    if (demoMode) return;
    fetch('/api/leads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: userLeads }) }).catch(() => toast('线索暂未同步到本地服务'));
  };
  const toast = message => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2500); };
  const manualLeads = () => leads.filter(lead => lead.source === 'manual');
  const allLeads = () => testMode ? [...manualLeads(), ...testRecords] : manualLeads();
  const isTest = lead => lead.source === 'uci-bank-marketing';
  const resultLabel = lead => isTest(lead) ? (lead.outcome === 'yes' ? '标签 yes' : '标签 no') : (lead.status === 'done' ? '已跟进' : lead.status === 'follow' ? '待跟进' : '待分析');
  const resultClass = lead => isTest(lead) ? (lead.outcome === 'yes' ? 'status-done' : 'status-new') : `status-${lead.status || 'new'}`;
  const visibleLeads = () => allLeads().filter(lead => filter === 'all' ? (testMode ? isTest(lead) : !isTest(lead)) : filter === 'positive' ? isTest(lead) && lead.outcome === 'yes' : filter === 'negative' ? isTest(lead) && lead.outcome === 'no' : !isTest(lead));

  function setMetrics() {
    const users = manualLeads(), positive = users.filter(lead => lead.status === 'done').length;
    const total = testMode ? datasetStats?.rows || 0 : users.length;
    const hot = testMode ? datasetStats?.positive || 0 : positive;
    const negative = testMode ? datasetStats?.negative || 0 : users.filter(lead => lead.status !== 'done').length;
    const rate = total ? (hot / total * 100).toFixed(1) : '—';
    $('#metric-total').textContent = total.toLocaleString('zh-CN'); $('#metric-hot').textContent = hot.toLocaleString('zh-CN');
    $('#metric-negative').textContent = negative.toLocaleString('zh-CN'); $('#metric-rate').textContent = total ? `${rate}%` : '—';
    $('#metric-total-label').textContent = testMode ? '公开测试记录' : '我的线索';
    $('#metric-hot-label').textContent = testMode ? '历史标签 yes' : '已完成跟进';
    $('#metric-negative-label').textContent = testMode ? '历史标签 no' : '待跟进线索';
    $('#metric-rate-label').textContent = testMode ? '测试集 yes 比例' : '当前记录完成比例';
    $('#metric-rate-note').textContent = total ? (testMode ? 'UCI 测试集标签分布' : '按我的跟进状态统计') : '录入线索后显示';
    $('#filter-all-count').textContent = testMode ? testRecords.length : users.length;
    $('#filter-positive-count').textContent = testRecords.filter(lead => lead.outcome === 'yes').length;
    $('#filter-negative-count').textContent = testRecords.filter(lead => lead.outcome === 'no').length;
    $('#filter-manual-count').textContent = users.length; $('#nav-count').textContent = testMode ? testRecords.length : users.length;
    if (demoMode) {
      $('.event-card strong').textContent = '公开演示模式';
      $('.event-card small').textContent = '数据只保存在你的浏览器';
    } else {
      $('.event-card strong').textContent = testMode ? '隔离测试数据' : '业务工作区';
      $('.event-card small').textContent = testMode ? 'UCI 数据仅供测试' : '只保存你录入的展会线索';
    }
  }

  function renderList() {
    const rows = visibleLeads();
    $('#list-count').textContent = rows.length;
    list.innerHTML = rows.length ? rows.map(lead => `<article class="lead-row ${lead.id === activeId ? 'selected' : ''}" data-id="${esc(lead.id)}"><div class="lead-avatar avatar-${esc(lead.tone || 'mint')}">${esc(lead.avatar || lead.name?.[0] || '#')}</div><div class="lead-copy"><div class="lead-name-line"><span class="lead-name">${esc(lead.name)}</span><span class="lead-status ${resultClass(lead)}">${resultLabel(lead)}</span></div><div class="lead-company">${esc(lead.company || '未提供机构')} · ${esc(lead.role || '访客')}</div><div class="lead-subline"><div class="lead-tags">${(lead.tags || []).slice(0, 2).map(tag => `<span class="lead-tag">${esc(tag)}</span>`).join('')}</div><span class="lead-time">${esc(lead.time || '')}</span></div></div></article>`).join('') : `<div class="empty-note">${filter === 'manual' || !testMode ? '还没有自己的线索。点击“录入新线索”开始，所有数据由你提供。' : '当前没有符合条件的测试记录。'}</div>`;
    list.querySelectorAll('.lead-row').forEach(row => row.addEventListener('click', () => { activeId = row.dataset.id; if (view !== 'inbox') setView('inbox'); else render(); }));
  }

  function renderDetail() {
    detail.className = 'detail-panel';
    const lead = allLeads().find(item => item.id === activeId);
    if (!lead) { detail.innerHTML = `<div class="empty-note">${manualLeads().length ? '从左侧选择一条线索查看详情。' : '从“录入新线索”开始，添加你在展会中实际收集到的信息。'}</div>`; return; }
    if (isTest(lead)) {
      const fields = [['年龄', 'age'], ['职业', 'job'], ['婚姻状态', 'marital'], ['教育程度', 'education'], ['账户余额', 'balance'], ['联系月份', 'month'], ['联系次数', 'campaign'], ['目标标签 y', 'y']];
      detail.innerHTML = `<div class="detail-top"><div class="detail-person"><div class="lead-avatar avatar-mint">#</div><div><div class="detail-name">${esc(lead.name)} <span class="lead-status ${resultClass(lead)}">测试标签 ${esc(lead.outcome)}</span></div><div class="detail-company">UCI Bank Marketing · ${esc(lead.time)}</div></div></div></div><div class="lead-score-card"><div class="score-explain"><strong>只读测试记录</strong><div class="score-chips"><span class="score-chip">独立测试数据</span><span class="score-chip">不会保存为业务线索</span></div></div></div><div class="detail-section"><div class="section-label"><strong>原始字段</strong><span>未补造姓名、机构或对话</span></div><div class="raw-grid">${fields.map(([label, key]) => `<div class="raw-field"><span>${label}</span><strong>${esc(lead.raw?.[key] ?? '')}</strong></div>`).join('')}</div></div><div class="source-warning">葡萄牙银行电话营销历史数据，仅用于界面与数据处理测试，不是展会线索，不能用于验证展会销售效果。</div><div class="detail-bottom"><span>来源：UCI · CC BY 4.0</span><a class="text-action" href="https://archive.ics.uci.edu/dataset/222/bank%2Bmarketing" target="_blank" rel="noreferrer">查看来源 ↗</a></div>`;
      return;
    }
    const assessment = lead.assessment || {};
    const group = (title, values, emptyText) => `<div class="assessment-group"><strong>${title}</strong>${values?.length ? `<ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : `<p>${emptyText}</p>`}</div>`;
  const statusLabel = { confirmed: '谈话明确支持', contradicted: '谈话明确否定', unclear: '提到但不明确', not_mentioned: '谈话未提及', 待核实: '词句出现，需核实', 未提及: '词句未出现' };
    const criteriaRows = (assessment.criteriaResults || []).map(row => `<li><strong>${esc(row.category)} · ${esc(row.criterion)}</strong><span class="criterion-status">${esc(statusLabel[row.status] || '需核实')}</span>${row.evidence ? `<blockquote>“${esc(row.evidence)}”</blockquote>` : ''}<p>${esc(row.reasoning || '')}</p></li>`).join('');
    const signalList = (assessment.signals || []).map(signal => `${signal.label}： “${signal.evidence}”`);
    const transcriptTimeline = (lead.transcriptSegments || []).map(segment => `<div class="timeline-item"><strong>${esc(new Date(segment.recordedAt || lead.time || Date.now()).toLocaleString('zh-CN'))} · ${Math.floor(segment.startMs / 60000)}:${String(Math.floor(segment.startMs / 1000) % 60).padStart(2, '0')}</strong><span>${segment.speaker === undefined ? '' : `说话人${segment.speaker + 1}：`}${esc(segment.text)}</span></div>`).join('');
    const projectRows = (lead.projectMatches || []).map(match => `<article class="project-match fit-${esc(match.fit)}"><div class="project-match-top"><strong>${esc(match.projectName)}</strong><span>${match.fit === 'suitable' ? '匹配' : match.fit === 'unsuitable' ? '不匹配' : '待核实'}</span></div><p>${esc(match.summary)}</p>${match.evidence?.length ? `<blockquote>${match.evidence.map(item => `“${esc(item)}”`).join(' · ')}</blockquote>` : ''}<small>下一步：${esc(match.nextStep)}</small></article>`).join('');
    const agentChain = lead.projectMatches?.length ? `<div class="agent-chain"><span>✦ Agent 执行链路</span><ol><li class="done">谈话录入</li><li class="done">信息提取</li><li class="done">项目匹配</li><li class="${lead.followUp ? 'done' : ''}">跟进草稿</li></ol></div>` : '';
    const followUpBlock = lead.followUp ? `<div class="detail-section"><div class="section-label"><strong>跟进消息草稿</strong><span>Agent 起草，请核对后自行发送</span></div><div class="followup-draft"><p>${esc(lead.followUp)}</p><button class="small-action" id="copy-followup">⎘ <span>复制消息</span></button></div></div>` : '';
    detail.innerHTML = `<div class="detail-top"><div class="detail-person"><div class="lead-avatar avatar-${esc(lead.tone || 'mint')}">${esc(lead.avatar || lead.name?.[0])}</div><div><div class="detail-name">${esc(lead.name)} <span class="lead-status ${resultClass(lead)}">${resultLabel(lead)}</span></div><div class="detail-company">${esc(lead.company || '未提供机构')} · ${esc(lead.role || '访客')}</div></div></div><div class="detail-actions"><button class="small-action" id="copy-note">⎘ <span>复制摘要</span></button><button class="small-action primary-small" id="edit-lead">✎ <span>编辑</span></button></div></div><div class="lead-score-card"><div class="score-explain"><strong>${esc(lead.summary || '录入交流记录后，Agent 会自动整理需求和下一步建议')}</strong><div class="score-chips"><span class="score-chip">辅助参考</span><span class="score-chip">最终决定由你做</span></div></div></div>${agentChain}${projectRows ? `<div class="detail-section"><div class="section-label"><strong>项目匹配结果</strong><span>按各项目标准分别判断</span></div><div class="project-matches">${projectRows}</div></div>` : `<div class="detail-section"><div class="section-label"><strong>项目匹配</strong><button class="text-action" id="edit-criteria-link">${projects.length ? '查看项目标准 →' : '先设置项目标准 →'}</button></div><p>${projects.length ? '录入谈话后自动匹配到各项目。' : '先创建项目并设置标准，录入谈话后自动匹配。'}</p></div>`}<div class="detail-section"><div class="section-label"><strong>实际交流记录</strong><span>由你录入</span></div><div class="visitor-quote"><p>${esc(lead.note || '还没有录入交流内容。')}</p></div></div>${transcriptTimeline ? `<div class="detail-section"><div class="section-label"><strong>录音时间点</strong><span>${lead.transcriptSegments.length} 段</span></div><div class="timeline">${transcriptTimeline}</div></div>` : ''}<div class="detail-section"><div class="section-label"><strong>下一步建议</strong><span>辅助提示，最终决定由你做</span></div><div class="recommendation"><div class="recommend-icon">✦</div><div class="recommend-copy"><strong>${esc(lead.summary || '等待分析')}</strong><p>${esc(lead.recommend || (lead.note ? '正在整理这段交流…' : '录入交流记录后自动分析。'))}</p></div></div></div>${followUpBlock}<div class="detail-section"><div class="section-label"><strong>记录动态</strong><span>${(lead.history || []).length} 条</span></div><div class="timeline">${(lead.history || []).slice(0, 3).map(row => `<div class="timeline-item"><strong>${esc(row[1])}</strong><span>${esc(row[0])}</span></div>`).join('')}</div></div><div class="detail-bottom"><span>${demoMode ? '仅保存在你的浏览器' : '保存在业务数据中'}</span><button class="followup-button" id="complete-followup">${lead.status === 'done' ? '✓ 已完成跟进' : '✓ 标记已跟进'}</button></div><div class="agent-composer"><div class="composer-head"><span class="sparkle">✦</span> 跟进 Agent <span style="color:#9daaa3">· ${llmEnabled ? '保存时自动分析；谈话与项目标准发送给服务商配置的模型' : '模型服务未配置，当前无法分析'}</span></div><div class="composer-footer"><span>${lead.note ? '修改交流记录后保存会重新匹配。' : '录入交流记录后自动匹配。'}</span><button class="send-button" id="reanalyze-lead" aria-label="重新分析" ${lead.note && projects.length ? '' : 'disabled'}>↻</button></div></div>`;
    $('#complete-followup').onclick = () => { lead.status = 'done'; lead.history.unshift(['刚刚', '用户标记为已跟进']); persist(); render(); };
    $('#reanalyze-lead').onclick = () => analyze(lead, lead.note);
    const criteriaLink = $('#edit-criteria-link'); if (criteriaLink) criteriaLink.onclick = () => setView('criteria');
    $('#copy-note').onclick = () => copyText(`${lead.name} · ${lead.company || '未提供机构'}\n需求：${lead.note || '未记录'}\n建议：${lead.recommend || '待分析'}`);
    const copyFollowUp = $('#copy-followup'); if (copyFollowUp) copyFollowUp.onclick = () => copyText(lead.followUp);
    $('#edit-lead').onclick = () => openEdit(lead);
  }

  function renderPipeline() {
    if (!testMode) { detail.className = 'pipeline-view'; detail.innerHTML = '<div class="panel-heading"><div><h2>测试数据已关闭</h2><p>默认业务模式不加载公开测试数据。使用 npm run dev:test 才会启用隔离测试集。</p></div></div>'; return; }
    detail.className = 'pipeline-view';
    detail.innerHTML = `<div class="panel-heading"><div><h2>隔离测试数据</h2><p>仅用于测试功能，不会进入业务线索或用户统计。</p></div><a class="text-action" href="/api/test-data.csv" download>下载原始 CSV →</a></div><div class="dataset-summary"><div><strong>${datasetStats.rows.toLocaleString('zh-CN')}</strong><span>原始记录</span></div><div><strong>${datasetStats.positive.toLocaleString('zh-CN')}</strong><span>y = yes</span></div><div><strong>${datasetStats.negative.toLocaleString('zh-CN')}</strong><span>y = no</span></div><div><strong>CC BY 4.0</strong><span>测试数据许可</span></div></div><div class="dataset-note"><strong>数据边界</strong><p>UCI Bank Marketing 是葡萄牙银行历史电话营销数据，不是展会 B2B 线索。它只能检查界面、筛选与数据处理流程，不能证明 Agent 的展会对话理解或销售转化能力。</p><a href="https://archive.ics.uci.edu/dataset/222/bank%2Bmarketing" target="_blank" rel="noreferrer">UCI 官方来源 ↗</a></div>`;
  }

  function renderInsights() {
    detail.className = 'insight-layout';
    if (testMode) detail.innerHTML = `<div class="insight-box"><h3>测试集标签分布</h3><div class="insight-stat">${(datasetStats.positive / datasetStats.rows * 100).toFixed(1)}<span style="font-size:11px;color:#83918a">% y = yes</span></div><p>仅表示公开测试 CSV 的历史标签比例，不代表展会转化率。</p><div class="channel-row"><span>yes</span><div class="channel-track"><i style="width:${datasetStats.positive / datasetStats.rows * 100}%"></i></div><b>${datasetStats.positive}</b></div><div class="channel-row"><span>no</span><div class="channel-track"><i style="width:${datasetStats.negative / datasetStats.rows * 100}%"></i></div><b>${datasetStats.negative}</b></div></div>`;
    else { const users = manualLeads(), done = users.filter(lead => lead.status === 'done').length; detail.innerHTML = `<div class="insight-box"><h3>我的跟进记录</h3><div class="insight-stat">${users.length}<span style="font-size:11px;color:#83918a"> 条线索</span></div><p>统计只使用你录入的本机业务线索，不包含公开测试数据。</p><div class="channel-row"><span>已跟进</span><div class="channel-track"><i style="width:${users.length ? done / users.length * 100 : 0}%"></i></div><b>${done}</b></div><div class="channel-row"><span>待跟进</span><div class="channel-track"><i style="width:${users.length ? (users.length - done) / users.length * 100 : 0}%"></i></div><b>${users.length - done}</b></div></div>`; }
  }

  function projectCard(project, index) {
    const field = (key, title, placeholder, rows) => `<label>${title}<textarea rows="${rows}" data-project-field="${key}" data-project-index="${index}" placeholder="${placeholder}">${esc(Array.isArray(project[key]) ? project[key].join('\n') : project[key] || '')}</textarea></label>`;
    return `<section class="project-editor"><div class="project-editor-head"><label>项目名称<input data-project-field="name" data-project-index="${index}" value="${esc(project.name || '')}" placeholder="输入项目名称" /></label><button type="button" class="text-action remove-project" data-project-index="${index}">删除项目</button></div>${field('targetCustomer', '目标客户 / 项目说明', '说明这个项目适合什么客户', 2)}<div class="form-grid">${field('mustHave', '必选条件（每行一条）', '项目必须满足的条件', 3)}${field('niceToHave', '加分条件（每行一条）', '值得优先跟进的信号', 3)}</div>${field('disqualifiers', '明确排除项（每行一条）', '出现这些情况应判为不匹配', 2)}</section>`;
  }

  function renderCriteria() {
    detail.className = 'pipeline-view criteria-view';
    detail.innerHTML = `<div class="panel-heading"><div><h2>项目与筛选标准</h2><p>先设置你要推进的项目。每段谈话保存后，Agent 会按每个项目分别判断匹配程度并给出原话依据。</p></div></div><form id="projects-form" class="criteria-form"><div class="criteria-draft"><label>用一段话描述你的业务<textarea id="criteria-brief" rows="2" placeholder="例如：我们卖视觉检测设备，客户是正在评估产线改造的制造企业，预算还在审批，计划明年一季度试点"></textarea></label><button class="secondary-button" type="button" id="draft-project">AI 起草项目标准 →</button><small>AI 只根据这段描述起草，生成后请核对并修改。</small></div><div id="project-editors">${projects.map(projectCard).join('')}</div><div class="criteria-actions"><button class="secondary-button" type="button" id="add-project">＋ 添加项目</button><button class="primary-button" type="submit">保存项目与标准</button></div><div class="criteria-caveat">${demoMode ? '公开演示：项目和线索只保存在你的浏览器，不会写入服务器。模型分析和语音转写会发送到部署方配置的服务商，并受频率限制。' : '“匹配 / 待核实 / 不匹配”依据录入的项目标准和原话生成。未提及不会被当成不匹配。你可以核对证据并决定是否跟进。谈话内容和标准会发送给服务商配置的模型。'}${demoMode ? ' <button type="button" class="text-action" id="reset-demo">重置演示数据</button>' : ''}</div></form>`;
    $('#draft-project').onclick = async () => {
      const brief = $('#criteria-brief').value.trim();
      if (!brief) { toast('先用一段话描述你的业务'); return; }
      const button = $('#draft-project'); button.disabled = true; button.textContent = '正在起草…';
      try {
        const response = await fetch('/api/agent/projects-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || '起草失败');
        projects.push(result.project);
        if (demoMode) localStorage.setItem(demoProjectsKey, JSON.stringify(projects));
        else {
          const saved = await fetch('/api/projects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects }) });
          if (!saved.ok) throw new Error('起草结果保存失败，请重试');
          projects = (await saved.json()).projects;
        }
        toast('已生成项目标准，请核对后再保存');
        renderCriteria();
      } catch (error) {
        toast(error.message || '起草失败，请稍后重试');
        if (document.contains(button)) { button.disabled = false; button.textContent = 'AI 起草项目标准 →'; }
      }
    };
    $('#add-project').onclick = () => { projects.push({ id: `project-${Date.now()}`, name: '', targetCustomer: '', mustHave: [], niceToHave: [], disqualifiers: [] }); renderCriteria(); };
    const resetDemo = $('#reset-demo'); if (resetDemo) resetDemo.onclick = () => { localStorage.removeItem(demoLeadsKey); localStorage.removeItem(demoProjectsKey); location.reload(); };
    document.querySelectorAll('.remove-project').forEach(button => button.onclick = () => { projects.splice(Number(button.dataset.projectIndex), 1); renderCriteria(); });
    $('#projects-form').addEventListener('submit', async event => {
      event.preventDefault();
      const next = [...document.querySelectorAll('[data-project-field]')].reduce((list, input) => {
        const index = Number(input.dataset.projectIndex), key = input.dataset.projectField;
        list[index] ||= { id: projects[index]?.id || `project-${Date.now()}` };
        list[index][key] = ['mustHave', 'niceToHave', 'disqualifiers'].includes(key) ? input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean) : input.value.trim();
        return list;
      }, []).filter(project => project?.name);
      if (!next.length) { toast('请至少填写一个项目名称'); return; }
      if (demoMode) { projects = next; localStorage.setItem(demoProjectsKey, JSON.stringify(projects)); toast('项目标准已保存到浏览器'); renderCriteria(); return; }
      try { const response = await fetch('/api/projects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: next }) }); if (!response.ok) throw new Error(); projects = (await response.json()).projects; toast('项目标准已保存'); renderCriteria(); }
      catch { toast('保存失败，请确认服务连接正常'); }
    });
  }

  function render() { setMetrics(); renderList(); if (view === 'pipeline') renderPipeline(); else if (view === 'insights') renderInsights(); else if (view === 'criteria') renderCriteria(); else renderDetail(); }
  function setView(next) { view = next; document.querySelectorAll('.nav-item[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === next)); $('#breadcrumb-current').textContent = next === 'pipeline' ? '测试数据' : next === 'insights' ? '我的统计' : next === 'criteria' ? '项目与标准' : '线索工作台'; $('#page-title').textContent = next === 'pipeline' ? '隔离测试数据' : next === 'insights' ? '我的跟进概况' : next === 'criteria' ? '项目与标准' : '展会线索跟进'; $('#page-subtitle').textContent = next === 'pipeline' ? '只有显式测试模式会读取公开数据。' : next === 'insights' ? '统计只基于你录入的业务线索。' : next === 'criteria' ? '先定义项目，再让 Agent 自动归类真实谈话。' : '录入或录音转写一次，自动匹配各个项目。'; $('.workspace-card').style.gridTemplateColumns = next === 'inbox' ? '' : '1fr'; $('.leads-panel').style.display = next === 'inbox' ? '' : 'none'; $('#new-lead').hidden = next !== 'inbox'; $('#quick-record').hidden = next !== 'inbox' || !sttEnabled; render(); }
  function openEdit(lead) { const form = $('#lead-form'); form.reset(); form.dataset.transcriptSegments = JSON.stringify(lead.transcriptSegments || []); form.elements.name.value = lead.name; form.elements.company.value = lead.company || ''; form.elements.role.value = lead.role || ''; form.elements.note.value = lead.note || ''; $('#lead-dialog').dataset.editId = lead.id; $('#save-lead').textContent = '保存修改 →'; $('#start-record').disabled = !sttEnabled; $('#record-status').textContent = sttEnabled ? '可继续补录谈话；保存后重新匹配' : '语音转写尚未配置，可直接编辑谈话记录'; $('#stop-record').hidden = true; $('#start-record').hidden = false; $('#lead-dialog').showModal(); }
  function addLead(data) { const lead = { id: `manual-${Date.now()}`, ...data, projectMatches: [], transcriptSegments: data.transcriptSegments || [], avatar: data.name.slice(0, 1), tone: ['mint', 'amber', 'blue', 'lilac'][manualLeads().length % 4], status: 'new', time: new Date().toLocaleString('zh-CN'), tags: ['用户录入'], source: 'manual', summary: '', recommend: '', assessment: null, history: [['刚刚', '用户录入线索']] }; leads.unshift(lead); activeId = lead.id; filter = 'manual'; document.querySelectorAll('.filter-tab').forEach(button => button.classList.toggle('selected', button.dataset.filter === filter)); persist(); setView('inbox'); return lead; }
  async function analyze(lead, transcript = lead.note) { const text = String(transcript || '').trim(); if (!text) return; if (!projects.length) { toast('请先创建项目并设置筛选标准'); setView('criteria'); return; } toast('正在匹配各项目…'); try { const response = await fetch('/api/agent/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, projects }) }); if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || '分析暂不可用'); } const result = await response.json(); lead.note = text; lead.projectMatches = result.projectMatches || []; lead.followUp = result.followUp || ''; const contact = result.contact || {}; for (const key of ['company', 'role']) { const value = String(contact[key] || '').trim(); if (!lead[key] && value) lead[key] = value.slice(0, key === 'company' ? 160 : 60); } if (lead.name === '未命名访客' && contact.name) { lead.name = contact.name; lead.avatar = lead.name.slice(0, 1); } lead.summary = result.summary; if (lead.status === 'new') lead.status = 'follow'; lead.recommend = lead.projectMatches.filter(item => item.fit !== 'unsuitable').map(item => `${item.projectName}：${item.nextStep}`).join('\n') || '当前没有匹配项目，可核对谈话与标准后再决定。'; lead.history.unshift(['刚刚', 'Agent 已按项目标准完成匹配']); persist(); render(); toast('匹配完成：请查看项目结果和原话依据'); } catch (error) { render(); toast(error.message || '分析暂不可用，请稍后重试'); } }
  function copyText(value) {
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove(); toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(() => toast('已复制到剪贴板'), fallback);
    else fallback();
  }

  let recorder = null, recordingChunks = [], recordingStartedAt = 0, recordingTimestamp = '';
  let voiceTimer = null, voiceContext = null;
  function stopVoiceMonitor() {
    if (voiceTimer) { clearInterval(voiceTimer); voiceTimer = null; }
    if (voiceContext) { voiceContext.close().catch(() => {}); voiceContext = null; }
  }
  function monitorVoice(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    voiceContext = new AudioContextClass();
    const analyser = voiceContext.createAnalyser();
    analyser.fftSize = 1024;
    voiceContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const speechLevel = 0.015, silenceMs = 5000, maxMs = 120000, noSpeechMs = 12000;
    const status = $('#record-status');
    const startedAt = Date.now();
    let speechFrames = 0, silenceStartedAt = 0, shownSecond = -1;
    voiceTimer = setInterval(() => {
      if (!recorder || recorder.state !== 'recording') { stopVoiceMonitor(); return; }
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      const now = Date.now();
      const elapsed = Math.floor((now - startedAt) / 1000);
      if (elapsed !== shownSecond) {
        shownSecond = elapsed;
        status.textContent = `录音中 ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')} · 停顿约 5 秒自动结束`;
      }
      if (Math.sqrt(energy / samples.length) >= speechLevel) { speechFrames++; silenceStartedAt = 0; }
      else if (speechFrames >= 3) {
        if (!silenceStartedAt) silenceStartedAt = now;
        if (now - silenceStartedAt >= silenceMs) { status.textContent = '检测到停顿，正在结束录音…'; recorder.stop(); return; }
      }
      if (speechFrames < 3 && now - startedAt >= noSpeechMs) { status.textContent = '没有检测到语音，已自动结束'; recorder.stop(); return; }
      if (now - startedAt >= maxMs) { status.textContent = '已达到 2 分钟上限，正在结束录音…'; recorder.stop(); }
    }, 100);
  }
  async function startRecording() {
    if (!sttEnabled || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('当前浏览器无法录音，请检查 HTTPS 或 localhost 权限'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream); recordingChunks = []; recordingStartedAt = Date.now(); recordingTimestamp = new Date(recordingStartedAt).toISOString();
      recorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
      recorder.onstop = async () => {
        stopVoiceMonitor();
        stream.getTracks().forEach(track => track.stop());
        const status = $('#record-status'); status.textContent = '正在转写录音…';
        try {
          const blob = new Blob(recordingChunks, { type: recorder.mimeType || 'audio/webm' });
          const form = new FormData(); form.append('audio', blob, `expo-${recordingTimestamp.replace(/[:.]/g, '-')}.webm`);
          const response = await fetch('/api/transcribe', { method: 'POST', body: form });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || '转写失败');
          const note = $('#lead-form').elements.note; const existing = note.value.trim();
          const transcript = String(result.text || '').trim();
          if (transcript) note.value = [existing, transcript].filter(Boolean).join('\n');
          const editId = $('#lead-dialog').dataset.editId; const currentLead = manualLeads().find(item => item.id === editId);
          const savedSegments = JSON.parse($('#lead-form').dataset.transcriptSegments || JSON.stringify(currentLead?.transcriptSegments || []));
          const segments = (result.segments || []).map(segment => ({ startMs: Math.max(0, Number(segment.startMs) || 0), endMs: Math.max(0, Number(segment.endMs) || 0), recordedAt: recordingTimestamp, text: String(segment.text || ''), ...(Number.isInteger(segment.speaker) ? { speaker: segment.speaker } : {}) }));
          $('#lead-form').dataset.transcriptSegments = JSON.stringify([...savedSegments, ...segments]);
          status.textContent = transcript ? `转写完成，已记录 ${segments.length} 段时间戳` : '未识别到语音，请手动补充谈话内容';
          if (transcript && !$('#lead-form').elements.name.value.trim()) $('#lead-form').elements.name.focus();
        } catch (error) { status.textContent = error.message || '转写失败'; }
        $('#stop-record').hidden = true; $('#start-record').hidden = false;
      };
      recorder.start(); monitorVoice(stream); $('#record-status').textContent = '录音中…停顿约 5 秒会自动结束'; $('#start-record').hidden = true; $('#stop-record').hidden = false;
    } catch { $('#record-status').textContent = '无法访问麦克风，请检查浏览器权限'; }
  }
  $('#start-record').onclick = startRecording;
  $('#quick-record').onclick = () => { $('#new-lead').click(); startRecording(); };
  $('#stop-record').onclick = () => { if (recorder?.state === 'recording') recorder.stop(); };
  const cancelGuard = event => { if (recorder?.state === 'recording') { event.preventDefault(); toast('正在录音，请先停止或等待自动结束'); } };
  document.querySelectorAll('#lead-dialog button[value="cancel"]').forEach(button => button.addEventListener('click', cancelGuard));
  $('#lead-dialog').addEventListener('cancel', cancelGuard);
  const sampleTranscript = ['说话人1：您好，我们是做视觉检测设备的，想了解下你们产线的情况。', '说话人2：现在产线上人工检测效率比较低，正在看视觉检测改造方案，预算还在审批，计划明年一季度先做一条试点线。', '说话人1：这次决策人也有参与吗？', '说话人2：我和生产总监一起来的，他下午会过来。'];
  $('#load-sample').onclick = () => {
    const form = $('#lead-form'), existing = form.elements.note.value.trim();
    form.elements.note.value = [existing, sampleTranscript.join('\n')].filter(Boolean).join('\n');
    const saved = JSON.parse(form.dataset.transcriptSegments || '[]'), now = new Date().toISOString();
    form.dataset.transcriptSegments = JSON.stringify([...saved, ...sampleTranscript.map((text, index) => ({ startMs: index * 5000, endMs: index * 5000 + 4200, recordedAt: now, text }))]);
    if (!form.elements.name.value.trim()) form.elements.name.value = '示例访客';
    $('#record-status').textContent = '已载入示例对话，可直接保存并分析';
  };
  $('#new-lead').onclick = () => { const form = $('#lead-form'); form.reset(); delete form.dataset.transcriptSegments; $('#lead-dialog').dataset.editId = ''; $('#save-lead').textContent = '保存并分析 →'; $('#start-record').disabled = !sttEnabled; $('#record-status').textContent = sttEnabled ? '可录音并转写，保存后自动匹配项目' : '语音转写尚未配置，可直接输入谈话记录'; $('#stop-record').hidden = true; $('#start-record').hidden = false; $('#lead-dialog').showModal(); };
  $('#add-lead-row').onclick = () => $('#new-lead').click();
  $('#lead-form').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget, nameInput = form.elements.name.value.trim(); const data = { name: nameInput || '未命名访客', company: form.elements.company.value.trim(), role: form.elements.role.value.trim(), note: form.elements.note.value.trim(), transcriptSegments: JSON.parse(form.dataset.transcriptSegments || '[]') }; if (!nameInput && !data.note) { toast('请先录入谈话内容或填写姓名'); return; } const id = $('#lead-dialog').dataset.editId; let lead; if (id) { lead = manualLeads().find(item => item.id === id); if (lead) { const transcriptChanged = lead.note !== data.note; Object.assign(lead, data); lead.avatar = data.name.slice(0, 1); if (transcriptChanged) { lead.projectMatches = []; lead.assessment = null; lead.summary = ''; lead.recommend = ''; } persist(); render(); toast('线索已保存'); } } else lead = addLead(data); $('#lead-dialog').close(); if (lead?.note) analyze(lead, lead.note); });
  document.querySelectorAll('.filter-tab').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('.filter-tab').forEach(item => item.classList.toggle('selected', item === button)); renderList(); if (!visibleLeads().some(lead => lead.id === activeId)) { activeId = visibleLeads()[0]?.id || null; renderDetail(); } });
  document.querySelectorAll('.nav-item[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view));
  $('#view-all').onclick = () => setView(testMode ? 'pipeline' : 'criteria'); $('.help-button').onclick = () => toast('先在“项目与标准”创建项目，再录入或录音转写谈话'); $('.icon-button').onclick = () => toast(demoMode ? '演示数据只保存在你的浏览器' : '线索保存在服务端业务数据中');

  async function init() {
    try {
      const config = await fetch('/api/config').then(response => response.json());
      testMode = config.testMode === true; demoMode = config.demoMode === true;
      llmEnabled = config.llmEnabled === true; sttEnabled = config.sttEnabled === true;
    } catch { toast('服务暂不可用，已显示本机缓存的数据'); }
    storageKey = demoMode ? demoLeadsKey : storageKey;
    loadCachedLeads();
    if (demoMode) {
      projects = readDemoProjects();
      if (!projects.length) { projects = [demoProjectSeed]; localStorage.setItem(demoProjectsKey, JSON.stringify(projects)); }
      if (!leads.length) { leads = [demoLeadSeed]; persist(); }
    } else {
      try {
        if (testMode) { const data = await fetch('/api/test-data').then(response => response.json()); testRecords = data.sample || []; datasetStats = data.stats || null; }
        const saved = await fetch('/api/leads').then(response => response.json()); if (Array.isArray(saved.leads)) leads = saved.leads.filter(lead => lead.source === 'manual');
        const savedProjects = await fetch('/api/projects').then(response => response.json()); if (Array.isArray(savedProjects.projects)) projects = savedProjects.projects;
      } catch { toast('服务暂不可用，已显示本机缓存的业务线索'); }
    }
    if (demoMode) {
      $('.workspace-switch strong').textContent = '公开演示'; $('.workspace-switch small').textContent = '数据只保存在你的浏览器';
      $('.event-date').innerHTML = '<span class="calendar-icon">◉</span>展小助公开演示<span class="date-live">DEMO</span>';
      $('.eyebrow').innerHTML = '<span class="live-pulse"></span>PUBLIC DEMO <span class="eyebrow-divider">/</span> 浏览器本机数据';
      $('.footer-note').innerHTML = '<span class="secure-icon">◈</span> 演示数据只保存在你的浏览器 <span class="footer-sep">·</span> 不会写入服务器 <span class="footer-right">可随时重置 <span>✓</span></span>';
      $('#load-sample').hidden = false;
    } else {
      $('.workspace-switch strong').textContent = testMode ? '测试工作区' : '我的工作区'; $('.workspace-switch small').textContent = testMode ? '测试数据与业务线索隔离' : '本机业务数据';
      $('.event-date').innerHTML = `<span class="calendar-icon">◉</span>${testMode ? '隔离测试模式' : '我的展会线索'}<span class="date-live">${testMode ? 'TEST' : '本机'}</span>`;
      $('.eyebrow').innerHTML = `<span class="live-pulse"></span>${testMode ? 'ISOLATED TEST MODE' : 'EXPO LEAD WORKSPACE'} <span class="eyebrow-divider">/</span> ${testMode ? '测试数据隔离' : '业务线索'}`;
      $('.footer-note').innerHTML = '<span class="secure-icon">◈</span> 线索保存在本机 <span class="footer-sep">·</span> 测试数据不会进入业务线索 <span class="footer-right">用户提供的数据 <span>✓</span></span>';
    }
    $('#new-lead').innerHTML = '<span>＋</span> 录入新线索'; $('#quick-record').hidden = !sttEnabled; $('#add-lead-row').innerHTML = '<span>＋</span> 录入一条自己的线索';
    $('.filter-tab[data-filter="all"]').innerHTML = `${testMode ? '测试数据' : '全部线索'} <span id="filter-all-count">0</span>`;
    $('.filter-tab[data-filter="positive"]').hidden = !testMode; $('.filter-tab[data-filter="negative"]').hidden = !testMode;
    $('.filter-tab[data-filter="manual"]').innerHTML = `${testMode ? '我的线索' : '用户录入'} <span id="filter-manual-count">0</span>`;
    $('.filter-tab[data-filter="manual"]').hidden = !testMode;
    document.querySelector('[data-view="pipeline"]').hidden = !testMode;
    document.querySelector('[data-view="insights"]').innerHTML = '<span class="nav-icon">⌁</span>我的统计';
    const users = manualLeads(); activeId = users[0]?.id || (testMode ? testRecords[0]?.id : null); filter = 'all'; render(); if (!projects.length && !testMode) setView('criteria');
  }
  init();
})();
