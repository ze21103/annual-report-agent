/**
 * UI交互模块
 */
const UI = {
    /**
     * 初始化所有UI事件
     */
    init() {
        this._initTabs();
        this._initResultTabs();
        this._initUpload();
    },

    /**
     * Tab切换
     */
    _initTabs() {
        document.querySelectorAll('.tab-bar .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const parent = tab.closest('.panel') || tab.closest('section');
                parent.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
                parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = parent.querySelector(`#tab-${tab.dataset.tab}`);
                if (target) target.classList.add('active');
            });
        });
    },

    /**
     * 结果Tab切换
     */
    _initResultTabs() {
        document.querySelectorAll('.result-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.result-tabs .tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.result-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.querySelector(`#result-${tab.dataset.result}`);
                if (target) target.classList.add('active');
            });
        });
    },

    /**
     * 文件上传
     */
    _initUpload() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        const selectFileBtn = document.getElementById('selectFileBtn');

        selectFileBtn.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('click', (e) => {
            if (e.target === dropZone || e.target.classList.contains('upload-icon') || e.target.tagName === 'P') {
                fileInput.click();
            }
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type === 'application/pdf') {
                this._setFile(file);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files[0]) {
                this._setFile(fileInput.files[0]);
            }
        });

        document.getElementById('removeFileBtn').addEventListener('click', () => {
            this._clearFile();
        });
    },

    _setFile(file) {
        this.selectedFile = file;
        document.getElementById('fileInfo').style.display = 'flex';
        document.getElementById('fileName').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('startBtn').disabled = false;
    },

    _clearFile() {
        this.selectedFile = null;
        document.getElementById('fileInfo').style.display = 'none';
        document.getElementById('fileName').textContent = '';
        document.getElementById('fileInput').value = '';
        this._updateStartBtn();
    },

    _updateStartBtn() {
        const hasFile = !!this.selectedFile;
        const hasText = document.getElementById('textInput').value.trim().length > 0;
        const hasApiKey = document.getElementById('apiKey').value.trim().length > 0;
        document.getElementById('startBtn').disabled = !(hasFile || hasText) || !hasApiKey;
    },

    /**
     * 更新工作流步骤状态
     */
    setStepStatus(step, status, message) {
        const el = document.querySelector(`.step[data-step="${step}"]`);
        if (!el) return;

        el.classList.remove('active', 'done', 'error');
        el.classList.add(status);

        const statusEl = el.querySelector('.step-status');
        const messages = {
            active: '处理中...',
            done: '✓ 完成',
            error: '✗ 失败'
        };
        statusEl.textContent = message || messages[status] || status;
    },

    /**
     * 追加LLM流式输出
     */
    appendStream(text) {
        const output = document.getElementById('llmStreamOutput');
        output.textContent += text;
        output.scrollTop = output.scrollHeight;
    },

    /**
     * 清空LLM输出
     */
    clearStream() {
        document.getElementById('llmStreamOutput').textContent = '';
    },

    /**
     * 显示/隐藏面板
     */
    showPanel(id) {
        document.getElementById(id).style.display = 'block';
    },

    hidePanel(id) {
        document.getElementById(id).style.display = 'none';
    },

    /**
     * 渲染总览
     */
    renderOverview(overview) {
        document.getElementById('overviewCompany').textContent = overview.company;
        document.getElementById('overviewYear').textContent = overview.year;
        document.getElementById('overviewTotalAssets').textContent = Workflow.formatNumber(overview.totalAssets);
        document.getElementById('overviewTotalLiabilities').textContent = Workflow.formatNumber(overview.totalLiabilities);
        document.getElementById('overviewNetAssets').textContent = Workflow.formatNumber(overview.totalEquity);
        document.getElementById('overviewMgmtChanges').textContent = overview.mgmtChangeCount + ' 人';
    },

    /**
     * 渲染资产负债表
     */
    renderBalanceSheet(rows) {
        const tbody = document.querySelector('#balanceTable tbody');
        tbody.innerHTML = '';

        for (const row of rows) {
            const tr = document.createElement('tr');

            if (row.isSection) {
                tr.innerHTML = `<td colspan="3" style="font-weight:700;color:var(--info);background:var(--bg-input)">${row.label}</td>`;
            } else if (row.isTotal) {
                tr.innerHTML = `
                    <td style="font-weight:700">${row.label || row.item}</td>
                    <td style="font-weight:700">${Workflow.formatNumber(row.ending_balance ?? row.ending)}</td>
                    <td style="font-weight:700">${Workflow.formatNumber(row.beginning_balance ?? row.beginning)}</td>`;
            } else {
                tr.innerHTML = `
                    <td>${row.item}</td>
                    <td>${Workflow.formatNumber(row.ending)}</td>
                    <td>${Workflow.formatNumber(row.beginning)}</td>`;
            }

            tbody.appendChild(tr);
        }
    },

    /**
     * 渲染管理层变动
     */
    renderManagement(changes) {
        const tbody = document.querySelector('#managementTable tbody');
        tbody.innerHTML = '';

        if (!Array.isArray(changes) || changes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">未发现管理层变动信息</td></tr>';
            return;
        }

        for (const c of changes) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${c.name || '-'}</td>
                <td>${c.position || '-'}</td>
                <td><span class="badge">${c.change_type || '-'}</span></td>
                <td>${c.description || '-'}</td>`;
            tbody.appendChild(tr);
        }
    },

    /**
     * 渲染附注信息
     */
    renderNotes(notes) {
        const container = document.getElementById('notesContent');
        let html = '';

        if (notes.important_notes && Array.isArray(notes.important_notes)) {
            for (const note of notes.important_notes) {
                const impactColor = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--success)' };
                html += `
                    <div style="margin-bottom:16px;padding:12px;background:var(--bg-input);border-radius:8px;border-left:3px solid ${impactColor[note.impact] || 'var(--border)'}">
                        <div style="font-weight:600;margin-bottom:4px">${note.category} - ${note.title}</div>
                        <div style="color:var(--text-dim);font-size:14px">${note.content}</div>
                    </div>`;
            }
        }

        const sections = [
            { key: 'related_parties', label: '关联交易' },
            { key: 'contingent_liabilities', label: '或有事项' },
            { key: 'subsequent_events', label: '日后事项' }
        ];

        for (const s of sections) {
            const data = notes[s.key];
            if (data) {
                html += `<h3>${s.label}</h3><p>${data.summary || '无'}</p>`;
            }
        }

        if (!html) {
            html = '<p style="color:var(--text-dim)">未提取到附注信息</p>';
        }

        container.innerHTML = html;
    },

    /**
     * 渲染JSON
     */
    renderJSON(result) {
        document.getElementById('jsonOutput').textContent = JSON.stringify(result, null, 2);
    },

    /**
     * 格式化数值显示
     */
    formatDisplay(val) {
        return Workflow.formatNumber(val);
    }
};
