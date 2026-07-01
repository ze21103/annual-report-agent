/**
 * UI交互模块 - 对话式界面
 */
const UI = {
    init() {
        this._initSidebar();
        this._initInput();
        this._initFileUpload();
    },

    _initSidebar() {
        document.getElementById('openSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('open');
        });
        document.getElementById('closeSidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('open');
        });
        document.getElementById('modelSelect').addEventListener('change', (e) => {
            document.getElementById('modelBadge').textContent = e.target.value;
        });
    },

    _initInput() {
        const textarea = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendBtn');

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
            sendBtn.disabled = !textarea.value.trim() && !this.selectedFile;
        });

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) sendBtn.click();
            }
        });

        sendBtn.addEventListener('click', () => {
            if (App.onSend) App.onSend();
        });
    },

    _initFileUpload() {
        const attachBtn = document.getElementById('attachBtn');
        const fileInput = document.getElementById('fileInput');

        attachBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) {
                this.setFile(fileInput.files[0]);
            }
        });

        document.getElementById('removeUpload').addEventListener('click', () => {
            this.clearFile();
        });
    },

    setFile(file) {
        this.selectedFile = file;
        document.getElementById('uploadPreview').style.display = 'flex';
        document.getElementById('uploadFileName').textContent = `📎 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('sendBtn').disabled = false;
    },

    clearFile() {
        this.selectedFile = null;
        document.getElementById('uploadPreview').style.display = 'none';
        document.getElementById('fileInput').value = '';
        this._updateSendBtn();
    },

    _updateSendBtn() {
        const hasText = document.getElementById('chatInput').value.trim().length > 0;
        const hasFile = !!this.selectedFile;
        document.getElementById('sendBtn').disabled = !(hasText || hasFile);
    },

    getInputText() {
        return document.getElementById('chatInput').value.trim();
    },

    clearInput() {
        document.getElementById('chatInput').value = '';
        document.getElementById('chatInput').style.height = 'auto';
        this.clearFile();
    },

    // ========== 消息渲染 ==========

    addUserMessage(text) {
        const container = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message user-message';
        div.innerHTML = `
            <div class="message-avatar">U</div>
            <div class="message-content"><p>${this._escapeHtml(text)}</p></div>
        `;
        container.appendChild(div);
        this.scrollToBottom();
    },

    addAgentMessage(html) {
        const container = document.getElementById('chatMessages');
        const div = document.createElement('div');
        div.className = 'message agent-message';
        div.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">${html}</div>
        `;
        container.appendChild(div);
        this.scrollToBottom();
        return div;
    },

    addTypingIndicator() {
        return this.addAgentMessage(`
            <div class="typing-dots">
                <span></span><span></span><span></span>
            </div>
        `);
    },

    removeTypingIndicator(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    },

    // ========== 工作流卡片 ==========

    createWorkflowCard() {
        const steps = [
            { id: 'preprocess', label: '文档预处理' },
            { id: 'balance', label: '资产负债表提取' },
            { id: 'management', label: '管理层变动提取' },
            { id: 'notes', label: '附注信息提取' }
        ];

        let stepsHtml = steps.map(s => `
            <div class="step-mini" data-step="${s.id}">
                <div class="step-mini-dot"></div>
                <div class="step-mini-label">${s.label}</div>
            </div>
        `).join('');

        const html = `
            <div class="workflow-card">
                <div class="workflow-card-header">
                    <span>工作流执行</span>
                    <span class="workflow-status">准备中...</span>
                </div>
                <div class="workflow-steps-mini">${stepsHtml}</div>
                <div class="stream-output" id="streamOutput"></div>
            </div>
        `;

        return this.addAgentMessage(html);
    },

    updateWorkflowStep(msgEl, stepId, status) {
        if (!msgEl) return;
        const step = msgEl.querySelector(`.step-mini[data-step="${stepId}"]`);
        if (!step) return;

        step.classList.remove('active', 'done', 'error');
        step.classList.add(status);
    },

    updateWorkflowStatus(msgEl, text) {
        if (!msgEl) return;
        const status = msgEl.querySelector('.workflow-status');
        if (status) status.textContent = text;
    },

    appendStream(msgEl, text) {
        if (!msgEl) return;
        const output = msgEl.querySelector('.stream-output');
        if (output) {
            output.textContent += text;
            output.scrollTop = output.scrollHeight;
        }
    },

    // ========== 结果卡片 ==========

    createResultCard(result) {
        const overview = Workflow.getOverview(result);
        const balanceRows = Workflow.getBalanceSheetRows(result);
        const mgmt = result.management_changes || [];
        const notes = result.notes || {};

        let balanceBody = '';
        for (const row of balanceRows) {
            if (row.isSection) {
                balanceBody += `<tr><td colspan="3" style="font-weight:700;color:var(--info);background:var(--bg)">${row.label}</td></tr>`;
            } else if (row.isTotal) {
                balanceBody += `<tr style="font-weight:700"><td>${row.label || row.item}</td><td>${Workflow.formatNumber(row.ending_balance ?? row.ending)}</td><td>${Workflow.formatNumber(row.beginning_balance ?? row.beginning)}</td></tr>`;
            } else {
                balanceBody += `<tr><td>${row.item}</td><td>${Workflow.formatNumber(row.ending)}</td><td>${Workflow.formatNumber(row.beginning)}</td></tr>`;
            }
        }

        let mgmtBody = '';
        if (Array.isArray(mgmt) && mgmt.length > 0) {
            mgmtBody = mgmt.map(m => `
                <tr><td>${m.name || '-'}</td><td>${m.position || '-'}</td><td>${m.change_type || '-'}</td><td>${m.description || '-'}</td></tr>
            `).join('');
        } else {
            mgmtBody = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">未发现管理层变动</td></tr>';
        }

        let notesHtml = '';
        if (notes.important_notes && Array.isArray(notes.important_notes)) {
            notesHtml = notes.important_notes.map(n => `
                <div class="note-item ${n.impact || 'low'}">
                    <div class="note-item-title">${n.category || ''} - ${n.title || ''}</div>
                    <div class="note-item-content">${n.content || ''}</div>
                </div>
            `).join('');
        }
        if (!notesHtml) notesHtml = '<p style="color:var(--text-dim)">未提取到附注信息</p>';

        const html = `
            <div class="result-card">
                <div class="result-card-header">
                    <span>提取结果</span>
                    <div class="json-actions">
                        <button class="btn btn-sm btn-outline" onclick="App.copyJSON()">复制JSON</button>
                        <button class="btn btn-sm btn-outline" onclick="App.downloadJSON()">下载JSON</button>
                        <button class="btn btn-sm btn-outline" onclick="App.downloadCSV()">下载CSV</button>
                    </div>
                </div>
                <div class="result-tabs-mini">
                    <button class="result-tab-mini active" onclick="UI.switchResultTab(this, 'overview')">总览</button>
                    <button class="result-tab-mini" onclick="UI.switchResultTab(this, 'balance')">资产负债表</button>
                    <button class="result-tab-mini" onclick="UI.switchResultTab(this, 'management')">管理层变动</button>
                    <button class="result-tab-mini" onclick="UI.switchResultTab(this, 'notes')">附注</button>
                    <button class="result-tab-mini" onclick="UI.switchResultTab(this, 'json')">JSON</button>
                </div>
                <div class="result-panel-content">
                    <div class="result-tab-content active" data-tab="overview">
                        <div class="overview-grid">
                            <div class="overview-item">
                                <div class="overview-item-label">公司名称</div>
                                <div class="overview-item-value">${overview.company}</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-item-label">报告年份</div>
                                <div class="overview-item-value">${overview.year}</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-item-label">总资产</div>
                                <div class="overview-item-value">${Workflow.formatNumber(overview.totalAssets)}</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-item-label">总负债</div>
                                <div class="overview-item-value">${Workflow.formatNumber(overview.totalLiabilities)}</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-item-label">净资产</div>
                                <div class="overview-item-value">${Workflow.formatNumber(overview.totalEquity)}</div>
                            </div>
                            <div class="overview-item">
                                <div class="overview-item-label">管理层变动</div>
                                <div class="overview-item-value">${overview.mgmtChangeCount} 人</div>
                            </div>
                        </div>
                    </div>
                    <div class="result-tab-content" data-tab="balance" style="display:none">
                        <table class="result-table">
                            <thead><tr><th>科目</th><th>期末余额</th><th>期初余额</th></tr></thead>
                            <tbody>${balanceBody}</tbody>
                        </table>
                    </div>
                    <div class="result-tab-content" data-tab="management" style="display:none">
                        <table class="result-table">
                            <thead><tr><th>姓名</th><th>职位</th><th>变动类型</th><th>说明</th></tr></thead>
                            <tbody>${mgmtBody}</tbody>
                        </table>
                    </div>
                    <div class="result-tab-content" data-tab="notes" style="display:none">
                        ${notesHtml}
                    </div>
                    <div class="result-tab-content" data-tab="json" style="display:none">
                        <pre class="json-output" id="jsonOutputInline">${JSON.stringify(result, null, 2)}</pre>
                    </div>
                </div>
            </div>
        `;

        return this.addAgentMessage(html);
    },

    switchResultTab(btn, tabName) {
        const card = btn.closest('.result-card');
        card.querySelectorAll('.result-tab-mini').forEach(t => t.classList.remove('active'));
        card.querySelectorAll('.result-tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('active');
        card.querySelector(`.result-tab-content[data-tab="${tabName}"]`).style.display = 'block';
    },

    scrollToBottom() {
        const container = document.getElementById('chatMessages');
        container.scrollTop = container.scrollHeight;
    },

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
