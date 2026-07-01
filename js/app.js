/**
 * 主应用逻辑 - 对话式智能体
 */
const App = {
    lastResult: null,
    isProcessing: false,

    init() {
        UI.init();
        this._loadSavedApiKey();
        this._bindSettingsEvents();
        this.onSend = () => this.handleSend();
    },

    _loadSavedApiKey() {
        const saved = localStorage.getItem('dashscope_api_key');
        if (saved) document.getElementById('apiKey').value = saved;
    },

    _bindSettingsEvents() {
        document.getElementById('apiKey').addEventListener('input', (e) => {
            localStorage.setItem('dashscope_api_key', e.target.value);
        });

        document.getElementById('newChatBtn').addEventListener('click', () => {
            location.reload();
        });

        document.getElementById('loadSample1Btn').addEventListener('click', () => {
            this.quickAction('sample1');
            document.getElementById('sidebar').classList.remove('open');
        });

        document.getElementById('loadSample2Btn').addEventListener('click', () => {
            this.quickAction('sample2');
            document.getElementById('sidebar').classList.remove('open');
        });
    },

    quickAction(action) {
        switch (action) {
            case 'sample1':
                this._processText(SampleData['1'], '示例：万科企业2023年年报');
                break;
            case 'sample2':
                this._processText(SampleData['2'], '示例：腾讯控股2023年年报');
                break;
            case 'upload':
                document.getElementById('fileInput').click();
                break;
            case 'paste':
                document.getElementById('chatInput').focus();
                document.getElementById('chatInput').placeholder = '请粘贴年报文本内容...';
                break;
        }
    },

    async handleSend() {
        if (this.isProcessing) return;

        const apiKey = document.getElementById('apiKey').value.trim();
        if (!apiKey) {
            UI.addAgentMessage('<p style="color:var(--warning)">请先配置 API Key。点击左上角菜单按钮，在设置中输入你的 DashScope API Key。</p>');
            return;
        }

        // 获取输入
        let text = '';
        let userDisplay = '';

        if (UI.selectedFile) {
            userDisplay = `📎 上传文件：${UI.selectedFile.name}`;
            try {
                UI.addUserMessage(userDisplay);
                UI.clearInput();
                const typing = UI.addTypingIndicator();
                const result = await PDFParser.extractText(UI.selectedFile);
                UI.removeTypingIndicator(typing);
                text = result.text;
                UI.addAgentMessage(`<p>已解析PDF，共 ${result.totalPages} 页，${text.length} 字符。正在开始提取...</p>`);
            } catch (err) {
                UI.addAgentMessage(`<p style="color:var(--danger)">PDF解析失败：${err.message}</p>`);
                return;
            }
        } else {
            text = UI.getInputText();
            if (!text) return;

            // 判断是直接的年报文本还是简短指令
            if (text.length < 100) {
                // 短文本，当作指令处理
                UI.addUserMessage(text);
                UI.clearInput();
                this._handleShortCommand(text, apiKey);
                return;
            }

            userDisplay = text.length > 200 ? text.substring(0, 200) + '...' : text;
            UI.addUserMessage(userDisplay);
            UI.clearInput();
        }

        this._processText(text, null, apiKey);
    },

    async _handleShortCommand(command, apiKey) {
        const typing = UI.addTypingIndicator();

        // 用LLM理解用户意图
        const intentPrompt = `用户说："${command}"
请判断用户意图，返回以下JSON之一：
{"intent": "extract", "detail": "用户想要提取年报数据"}
{"intent": "help", "detail": "用户需要帮助"}
{"intent": "sample", "detail": "用户想看示例"}
{"intent": "unknown", "detail": "无法理解"}

只返回JSON，不要其他内容。`;

        try {
            const response = await LLMClient.chatSync({
                apiKey,
                model: document.getElementById('modelSelect').value,
                messages: [{ role: 'user', content: intentPrompt }]
            });

            UI.removeTypingIndicator(typing);

            let intent = 'unknown';
            try {
                const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
                intent = parsed.intent || 'unknown';
            } catch (e) {}

            switch (intent) {
                case 'sample':
                    UI.addAgentMessage('<p>好的，让我为你加载一份示例年报数据进行提取演示。</p>');
                    this._processText(SampleData['1'], '示例：万科企业2023年年报', apiKey);
                    break;
                case 'help':
                    UI.addAgentMessage(`
                        <p>我是企业年报智能提取Agent，可以帮你：</p>
                        <ul>
                            <li>上传PDF年报文件，自动提取结构化数据</li>
                            <li>粘贴年报文本，提取资产负债表、管理层变动、附注信息</li>
                        </ul>
                        <p>使用方法：</p>
                        <div class="action-chips">
                            <button class="chip" onclick="App.quickAction('sample1')">试用示例数据</button>
                            <button class="chip" onclick="App.quickAction('upload')">上传PDF</button>
                        </div>
                        <p class="hint-text">或者直接将年报文本粘贴到输入框中发送给我。</p>
                    `);
                    break;
                default:
                    UI.addAgentMessage(`
                        <p>我主要擅长企业年报数据提取。你可以：</p>
                        <div class="action-chips">
                            <button class="chip" onclick="App.quickAction('sample1')">试用示例：万科年报</button>
                            <button class="chip" onclick="App.quickAction('upload')">上传PDF年报</button>
                            <button class="chip" onclick="App.quickAction('paste')">粘贴年报文本</button>
                        </div>
                    `);
            }
        } catch (err) {
            UI.removeTypingIndicator(typing);
            UI.addAgentMessage(`<p style="color:var(--danger)">处理出错：${err.message}</p>`);
        }
    },

    async _processText(text, displayName, apiKey) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        if (!apiKey) apiKey = document.getElementById('apiKey').value.trim();
        const model = document.getElementById('modelSelect').value;

        if (!apiKey) {
            UI.addAgentMessage('<p style="color:var(--warning)">请先配置 API Key。</p>');
            this.isProcessing = false;
            return;
        }

        if (!displayName) {
            const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
            UI.addUserMessage(preview);
            UI.clearInput();
        }

        // 创建工作流卡片
        const workflowMsg = UI.createWorkflowCard();

        try {
            const result = await Workflow.run({
                text,
                apiKey,
                model,
                callbacks: {
                    onStepStart: (step) => {
                        UI.updateWorkflowStep(workflowMsg, step, 'active');
                        const names = { preprocess: '文档预处理', balance: '资产负债表', management: '管理层变动', notes: '附注信息' };
                        UI.updateWorkflowStatus(workflowMsg, `正在执行：${names[step]}`);
                        UI.appendStream(workflowMsg, `\n── ${names[step]} ──\n`);
                    },
                    onStepDone: (step) => {
                        UI.updateWorkflowStep(workflowMsg, step, 'done');
                        UI.appendStream(workflowMsg, `\n✓ 完成\n`);
                    },
                    onStepError: (step, err) => {
                        UI.updateWorkflowStep(workflowMsg, step, 'error');
                        UI.appendStream(workflowMsg, `\n✗ 错误: ${err.message}\n`);
                    },
                    onStreamToken: (step, token) => {
                        UI.appendStream(workflowMsg, token);
                    },
                    onAllDone: (finalResult) => {
                        this.lastResult = finalResult;
                        UI.updateWorkflowStatus(workflowMsg, '全部完成');

                        // 生成结果摘要
                        const overview = Workflow.getOverview(finalResult);
                        UI.addAgentMessage(`
                            <p>提取完成！以下是分析结果摘要：</p>
                            <p><strong>公司：</strong>${overview.company}　<strong>年份：</strong>${overview.year}</p>
                            <p><strong>总资产：</strong>${Workflow.formatNumber(overview.totalAssets)}　<strong>总负债：</strong>${Workflow.formatNumber(overview.totalLiabilities)}　<strong>净资产：</strong>${Workflow.formatNumber(overview.totalEquity)}</p>
                        `);

                        // 渲染详细结果卡片
                        UI.createResultCard(finalResult);
                    }
                }
            });
        } catch (err) {
            UI.addAgentMessage(`<p style="color:var(--danger)">处理出错：${err.message}</p>`);
        } finally {
            this.isProcessing = false;
        }
    },

    // ========== 导出功能 ==========

    copyJSON() {
        if (!this.lastResult) return;
        const text = JSON.stringify(this.lastResult, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            UI.addAgentMessage('<p style="color:var(--success)">JSON已复制到剪贴板 ✓</p>');
        });
    },

    downloadJSON() {
        if (!this.lastResult) return;
        const text = JSON.stringify(this.lastResult, null, 2);
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `年报提取_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    downloadCSV() {
        if (!this.lastResult) return;
        let csv = '﻿科目,期末余额,期初余额\n';
        const rows = Workflow.getBalanceSheetRows(this.lastResult);
        for (const row of rows) {
            if (row.isSection) {
                csv += `\n${row.label},,\n`;
            } else {
                csv += `"${row.item || row.label}",${row.ending ?? row.ending_balance ?? ''},${row.beginning ?? row.beginning_balance ?? ''}\n`;
            }
        }
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `资产负债表_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

// 示例数据
const SampleData = {
    '1': `万科企业股份有限公司 2023年年度报告

公司简称：万科A
股票代码：000002
所属行业：房地产业

一、公司基本情况
万科企业股份有限公司成立于1984年，是中国领先的城乡建设与生活服务商。公司主营业务包括房地产开发和物业服务。

二、主要财务数据

资产负债表（单位：元）

流动资产：
货币资金          期末：98,765,432,100    期初：108,234,567,800
应收账款          期末：12,345,678,900    期初：10,987,654,300
存货              期末：789,012,345,600   期初：812,345,678,900
其他流动资产      期末：45,678,901,200    期初：38,765,432,100
流动资产合计      期末：945,802,357,800   期初：970,333,333,100

非流动资产：
固定资产          期末：23,456,789,000    期初：21,345,678,900
无形资产          期末：5,678,901,200     期初：4,567,890,100
长期股权投资      期末：67,890,123,400    期初：58,765,432,100
非流动资产合计    期末：97,025,813,600    期初：84,678,001,100

资产总计          期末：1,042,828,171,400 期初：1,055,011,334,200

流动负债：
应付账款          期末：156,789,012,300   期初：167,890,123,400
短期借款          期末：45,678,901,200    期初：38,901,234,500
预收款项          期末：234,567,890,100   期初：256,789,012,300
流动负债合计      期末：437,035,803,600   期初：463,580,370,200

非流动负债：
长期借款          期末：189,012,345,600   期初：178,901,234,500
应付债券          期末：56,789,012,300    期初：67,890,123,400
非流动负债合计    期末：245,801,357,900   期初：246,791,357,900

负债合计          期末：682,837,161,500   期初：710,371,728,100

所有者权益：
股本              期末：11,618,947,500    期初：11,618,947,500
资本公积          期末：87,654,321,000    期初：87,654,321,000
盈余公积          期末：45,678,901,200    期初：42,345,678,900
未分配利润        期末：215,038,840,200   期初：203,020,658,700
所有者权益合计    期末：359,991,009,900   期初：344,639,606,100

负债和所有者权益总计  期末：1,042,828,171,400  期初：1,055,011,334,200

三、管理层变动情况

报告期内，公司管理层发生以下变动：
1. 张海先生因工作调整原因，辞去公司执行副总裁职务，辞职日期2023年6月15日。
2. 李明先生经董事会审议通过，被聘任为公司副总裁，任期自2023年7月1日起。
3. 王芳女士因任期届满，不再担任公司独立董事，公司已选举赵强先生为新任独立董事。
4. 陈伟先生因个人原因辞去公司监事会主席职务。

四、附注

1. 会计政策变更
本公司自2023年1月1日起执行新收入准则，对财务报表进行了相应调整。

2. 关联方及关联交易
报告期内，公司与关联方发生关联交易共计约12.5亿元，主要包括商品销售和劳务提供。

3. 或有事项
截至报告期末，公司为子公司提供担保余额为人民币234.5亿元。

4. 资产负债表日后事项
2024年1月，公司完成了一笔重大资产收购，收购金额约50亿元。`,

    '2': `深圳市腾讯计算机系统有限公司
2023年年度报告摘要

公司名称：腾讯控股有限公司
股票代码：00700.HK
所属行业：互联网服务

一、公司概况
腾讯控股有限公司是中国领先的互联网增值服务提供商，主要产品包括社交平台微信和QQ、在线游戏、数字内容、金融科技及企业服务等。

二、资产负债表（单位：人民币千元）

流动资产：
现金及现金等价物      期末：184,532,000    期初：156,789,000
定期存款              期末：98,765,000     期初：87,654,000
应收账款              期末：45,678,000     期初：38,901,000
存货                  期末：2,345,000      期初：1,987,000
其他流动资产          期末：67,890,000     期初：56,789,000
流动资产合计          期末：399,210,000    期初：342,120,000

非流动资产：
固定资产              期末：78,901,000     期初：67,890,000
无形资产              期末：34,567,000     期初：28,901,000
商誉                  期末：123,456,000    期初：118,901,000
长期投资              期末：234,567,000    期初：198,765,000
非流动资产合计        期末：471,491,000    期初：414,457,000

资产总计              期末：870,701,000    期初：756,577,000

流动负债：
应付账款              期末：89,012,000     期初：78,901,000
短期借款              期末：34,567,000     期初：28,901,000
递延收入              期末：45,678,000     期初：42,345,000
流动负债合计          期末：169,257,000    期初：150,147,000

非流动负债：
长期借款              期末：156,789,000    期初：134,567,000
递延所得税负债        期末：23,456,000     期初：19,876,000
非流动负债合计        期末：180,245,000    期初：154,443,000

负债合计              期末：349,502,000    期初：304,590,000

所有者权益：
股本                  期末：9,567,000      期初：9,567,000
资本公积              期末：87,654,000     期初：87,654,000
盈余公积              期末：56,789,000     期初：48,901,000
未分配利润            期末：367,189,000    期初：305,865,000
所有者权益合计        期末：521,199,000    期初：451,987,000

三、管理层变动

1. 刘炽平先生继续担任公司执行董事兼总裁。
2. 张小龙先生继续担任微信事业群总裁。
3. 马化腾先生继续担任董事会主席兼首席执行官。
4. 罗硕瀚先生因退休原因，辞去公司首席财务官职务，自2023年9月30日起生效。
5. 刘胜义先生被任命为公司首席财务官，自2023年10月1日起生效。

四、重要附注

1. 重大投资
报告期内，公司完成了对多家游戏公司的战略投资，总投资金额约200亿元人民币。

2. 关联交易
公司与主要股东Naspers Limited及其关联方存在持续关联交易。

3. 法律诉讼
公司涉及若干知识产权诉讼案件，管理层认为不会对财务状况产生重大不利影响。

4. 会计估计变更
报告期内，公司对无形资产摊销年限进行了重新评估，将部分软件摊销年限由3年调整为5年。`
};

document.addEventListener('DOMContentLoaded', () => App.init());
