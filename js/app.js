/**
 * 主应用逻辑 - 整合所有模块
 */
const App = {
    init() {
        UI.init();
        this._bindEvents();
        this._loadSavedApiKey();
    },

    _bindEvents() {
        // API Key输入监听
        document.getElementById('apiKey').addEventListener('input', () => {
            UI._updateStartBtn();
            localStorage.setItem('dashscope_api_key', document.getElementById('apiKey').value);
        });

        // 文本输入监听
        document.getElementById('textInput').addEventListener('input', () => {
            UI._updateStartBtn();
        });

        // 开始按钮
        document.getElementById('startBtn').addEventListener('click', () => this.start());

        // 停止按钮
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());

        // 示例数据按钮
        document.querySelectorAll('.sample-btn').forEach(btn => {
            btn.addEventListener('click', () => this.loadSample(btn.dataset.sample));
        });

        // JSON操作按钮
        document.getElementById('copyJsonBtn').addEventListener('click', () => this.copyJSON());
        document.getElementById('downloadJsonBtn').addEventListener('click', () => this.downloadJSON());
        document.getElementById('downloadCsvBtn').addEventListener('click', () => this.downloadCSV());

        // 清空输出
        document.getElementById('clearOutputBtn').addEventListener('click', () => UI.clearStream());
    },

    _loadSavedApiKey() {
        const saved = localStorage.getItem('dashscope_api_key');
        if (saved) {
            document.getElementById('apiKey').value = saved;
        }
    },

    /**
     * 获取输入文本
     */
    async _getInputText() {
        // 优先使用上传的文件
        if (UI.selectedFile) {
            const result = await PDFParser.extractText(UI.selectedFile, (current, total) => {
                UI.appendStream(`[PDF解析] 第 ${current}/${total} 页...\n`);
            });
            return result.text;
        }

        // 使用粘贴的文本
        const text = document.getElementById('textInput').value.trim();
        if (text) return text;

        throw new Error('请先上传PDF文件或粘贴文本');
    },

    /**
     * 开始提取
     */
    async start() {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (!apiKey) {
            alert('请输入DashScope API Key');
            return;
        }

        const model = document.getElementById('modelSelect').value;

        // 切换UI状态
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('stopBtn').style.display = 'inline-flex';
        UI.showPanel('workflowPanel');
        UI.hidePanel('resultPanel');
        UI.clearStream();

        // 重置步骤状态
        ['preprocess', 'balance', 'management', 'notes'].forEach(step => {
            UI.setStepStatus(step, '', '等待中');
        });

        try {
            // 获取输入文本
            UI.appendStream('[系统] 正在读取输入...\n');
            const text = await this._getInputText();
            UI.appendStream(`[系统] 输入文本共 ${text.length} 字符\n\n`);

            // 执行工作流
            const result = await Workflow.run({
                text,
                apiKey,
                model,
                callbacks: {
                    onStepStart: (step) => {
                        const names = {
                            preprocess: '文档预处理',
                            balance: '资产负债表提取',
                            management: '管理层变动提取',
                            notes: '附注信息提取'
                        };
                        UI.setStepStatus(step, 'active');
                        UI.appendStream(`\n${'='.repeat(50)}\n`);
                        UI.appendStream(`[步骤] ${names[step]} 开始...\n\n`);
                    },
                    onStepDone: (step, data) => {
                        UI.setStepStatus(step, 'done');
                        UI.appendStream(`\n[完成] ${step} 提取成功\n`);
                    },
                    onStepError: (step, error) => {
                        UI.setStepStatus(step, 'error', error.message);
                    },
                    onStreamToken: (step, token) => {
                        UI.appendStream(token);
                    },
                    onAllDone: (finalResult) => {
                        this._renderResults(finalResult);
                    }
                }
            });

        } catch (error) {
            UI.appendStream(`\n[错误] ${error.message}\n`);
            console.error('Workflow error:', error);
        } finally {
            document.getElementById('startBtn').style.display = 'inline-flex';
            document.getElementById('stopBtn').style.display = 'none';
        }
    },

    /**
     * 停止工作流
     */
    stop() {
        Workflow.stop();
        UI.appendStream('\n[系统] 已停止\n');
        document.getElementById('startBtn').style.display = 'inline-flex';
        document.getElementById('stopBtn').style.display = 'none';
    },

    /**
     * 渲染结果
     */
    _renderResults(result) {
        UI.showPanel('resultPanel');

        const overview = Workflow.getOverview(result);
        UI.renderOverview(overview);

        const balanceRows = Workflow.getBalanceSheetRows(result);
        UI.renderBalanceSheet(balanceRows);

        UI.renderManagement(result.management_changes || []);
        UI.renderNotes(result.notes || {});
        UI.renderJSON(result);

        // 滚动到结果
        document.getElementById('resultPanel').scrollIntoView({ behavior: 'smooth' });
    },

    /**
     * 加载示例数据
     */
    loadSample(id) {
        const sample = SampleData[id];
        if (!sample) return;

        document.getElementById('textInput').value = sample;
        // 切换到粘贴文本tab
        document.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.tab[data-tab="paste"]').classList.add('active');
        document.getElementById('tab-paste').classList.add('active');
        UI._updateStartBtn();
    },

    /**
     * 复制JSON
     */
    copyJSON() {
        const text = document.getElementById('jsonOutput').textContent;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copyJsonBtn');
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = '复制JSON', 1500);
        });
    },

    /**
     * 下载JSON
     */
    downloadJSON() {
        const text = document.getElementById('jsonOutput').textContent;
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `年报提取结果_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    /**
     * 下载CSV
     */
    downloadCSV() {
        const result = Workflow.results;
        let csv = '﻿'; // BOM for Excel

        // 资产负债表CSV
        csv += '科目,期末余额,期初余额\n';
        const rows = Workflow.getBalanceSheetRows(Workflow._mergeResults());
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

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
