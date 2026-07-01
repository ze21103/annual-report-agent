/**
 * 工作流引擎 - 多步骤年报提取流水线
 */
const Workflow = {
    abortController: null,
    isRunning: false,
    results: {},

    /**
     * 执行完整工作流
     * @param {Object} options
     * @param {string} options.text - 年报文本
     * @param {string} options.apiKey - API Key
     * @param {string} options.model - 模型名称
     * @param {Object} options.callbacks - 各步骤回调
     */
    async run({ text, apiKey, model, callbacks }) {
        this.abortController = new AbortController();
        this.isRunning = true;
        this.results = {};

        const { onStepStart, onStepDone, onStepError, onStreamToken, onAllDone } = callbacks;

        try {
            // 步骤1：文档预处理
            onStepStart('preprocess');
            this.results.preprocess = await this._runStep({
                role: 'preprocess',
                text: this._truncateForStep(text, 4000),
                apiKey, model,
                onToken: (t) => onStreamToken('preprocess', t)
            });
            onStepDone('preprocess', this.results.preprocess);

            // 步骤2：资产负债表提取
            onStepStart('balance');
            this.results.balance = await this._runStep({
                role: 'balance',
                text: this._truncateForStep(text, 6000),
                apiKey, model,
                onToken: (t) => onStreamToken('balance', t)
            });
            onStepDone('balance', this.results.balance);

            // 步骤3：管理层变动提取
            onStepStart('management');
            this.results.management = await this._runStep({
                role: 'management',
                text: this._truncateForStep(text, 5000),
                apiKey, model,
                onToken: (t) => onStreamToken('management', t)
            });
            onStepDone('management', this.results.management);

            // 步骤4：附注提取
            onStepStart('notes');
            this.results.notes = await this._runStep({
                role: 'notes',
                text: this._truncateForStep(text, 5000),
                apiKey, model,
                onToken: (t) => onStreamToken('notes', t)
            });
            onStepDone('notes', this.results.notes);

            // 合并结果
            const finalResult = this._mergeResults();
            if (onAllDone) onAllDone(finalResult);
            return finalResult;

        } catch (error) {
            if (error.name === 'AbortError') {
                return null;
            }
            throw error;
        } finally {
            this.isRunning = false;
        }
    },

    /**
     * 停止工作流
     */
    stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isRunning = false;
    },

    /**
     * 执行单个步骤
     */
    async _runStep({ role, text, apiKey, model, onToken }) {
        const systemPrompt = LLMClient.buildSystemPrompt(role);
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `请从以下企业年报文本中提取信息：\n\n${text}` }
        ];

        const rawContent = await LLMClient.chat({
            apiKey,
            model,
            messages,
            onToken,
            signal: this.abortController.signal
        });

        // 尝试解析JSON
        return this._parseJSON(rawContent);
    },

    /**
     * 解析LLM返回的JSON
     */
    _parseJSON(text) {
        // 尝试直接解析
        try {
            return JSON.parse(text);
        } catch (e) {}

        // 尝试提取```json ... ```中的内容
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch (e) {}
        }

        // 尝试找到第一个{和最后一个}
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            try {
                return JSON.parse(text.substring(firstBrace, lastBrace + 1));
            } catch (e) {}
        }

        // 返回原始文本
        return { raw_text: text };
    },

    /**
     * 截断文本以适应步骤
     */
    _truncateForStep(text, maxChars) {
        if (text.length <= maxChars) return text;
        return text.substring(0, maxChars) + '\n\n[...文本已截断，共' + text.length + '字符...]';
    },

    /**
     * 合并所有步骤结果
     */
    _mergeResults() {
        return {
            metadata: this.results.preprocess || {},
            balance_sheet: this.results.balance?.balance_sheet || this.results.balance || {},
            management_changes: this.results.management?.management_changes || [],
            notes: this.results.notes || {},
            _raw: this.results
        };
    },

    /**
     * 获取总览数据
     */
    getOverview(result) {
        const meta = result.metadata || {};
        const bs = result.balance_sheet || {};
        const assets = bs.assets || {};
        const liabilities = bs.liabilities || {};
        const mgmt = result.management_changes || [];

        return {
            company: meta.company_name || '-',
            year: meta.report_year || '-',
            totalAssets: assets.total_assets?.ending_balance ?? '-',
            totalLiabilities: liabilities.total_liabilities?.ending_balance ?? '-',
            totalEquity: (bs.equity?.total_equity?.ending_balance) ?? '-',
            mgmtChangeCount: Array.isArray(mgmt) ? mgmt.length : 0
        };
    },

    /**
     * 获取资产负债表表格数据
     */
    getBalanceSheetRows(result) {
        const bs = result.balance_sheet || {};
        const rows = [];

        const addSection = (items, sectionName) => {
            if (!Array.isArray(items)) return;
            rows.push({ isSection: true, label: sectionName });
            for (const item of items) {
                rows.push({
                    item: item.item || item.name || '-',
                    ending: item.ending_balance ?? item.ending ?? '-',
                    beginning: item.beginning_balance ?? item.beginning ?? '-'
                });
            }
        };

        if (bs.assets) {
            addSection(bs.assets.current_assets, '流动资产');
            addSection(bs.assets.non_current_assets, '非流动资产');
            if (bs.assets.total_assets) {
                rows.push({ isTotal: true, label: '资产总计', ...bs.assets.total_assets });
            }
        }

        if (bs.liabilities) {
            addSection(bs.liabilities.current_liabilities, '流动负债');
            addSection(bs.liabilities.non_current_liabilities, '非流动负债');
            if (bs.liabilities.total_liabilities) {
                rows.push({ isTotal: true, label: '负债合计', ...bs.liabilities.total_liabilities });
            }
        }

        if (bs.equity) {
            addSection(bs.equity.items, '所有者权益');
            if (bs.equity.total_equity) {
                rows.push({ isTotal: true, label: '所有者权益合计', ...bs.equity.total_equity });
            }
        }

        return rows;
    },

    /**
     * 格式化数值
     */
    formatNumber(val) {
        if (val === null || val === undefined || val === '-') return '-';
        const num = Number(val);
        if (isNaN(num)) return String(val);
        if (Math.abs(num) >= 1e8) return (num / 1e8).toFixed(2) + ' 亿';
        if (Math.abs(num) >= 1e4) return (num / 1e4).toFixed(2) + ' 万';
        return num.toLocaleString('zh-CN');
    }
};
