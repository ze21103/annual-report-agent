/**
 * LLM客户端 - 封装阿里云DashScope API调用
 */
const LLMClient = {
    API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',

    /**
     * 调用Qwen模型（流式输出）
     * @param {Object} options
     * @param {string} options.apiKey - API Key
     * @param {string} options.model - 模型名称
     * @param {Array} options.messages - 消息数组
     * @param {Function} options.onToken - 每个token的回调
     * @param {Function} options.onDone - 完成回调
     * @param {Function} options.onError - 错误回调
     * @param {AbortSignal} options.signal - 中断信号
     * @returns {Promise<string>}
     */
    async chat({ apiKey, model = 'qwen-plus', messages, onToken, onDone, onError, signal }) {
        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: true,
                    temperature: 0.1,
                    max_tokens: 4096
                }),
                signal
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API请求失败 (${response.status}): ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;

                    const data = trimmed.slice(5).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullContent += delta;
                            if (onToken) onToken(delta, fullContent);
                        }
                    } catch (e) {
                        // 跳过解析失败的行
                    }
                }
            }

            if (onDone) onDone(fullContent);
            return fullContent;

        } catch (error) {
            if (error.name === 'AbortError') {
                if (onDone) onDone('');
                return '';
            }
            if (onError) onError(error);
            throw error;
        }
    },

    /**
     * 非流式调用
     */
    async chatSync({ apiKey, model = 'qwen-plus', messages, signal }) {
        const response = await fetch(this.API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                messages,
                stream: false,
                temperature: 0.1,
                max_tokens: 4096
            }),
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败 (${response.status}): ${errorText}`);
        }

        const result = await response.json();
        return result.choices?.[0]?.message?.content || '';
    },

    /**
     * 构建系统提示词
     */
    buildSystemPrompt(role) {
        const prompts = {
            preprocess: `你是一个专业的年报分析助手。你的任务是从企业年报文本中识别并提取基本信息。
请严格按照JSON格式输出，不要输出任何其他内容。

输出格式：
{
  "company_name": "公司全称",
  "stock_code": "股票代码",
  "report_year": "报告年份",
  "report_type": "年报/半年报/季报",
  "industry": "所属行业",
  "summary": "一句话概述公司主营业务"
}

如果某项信息无法从文本中确定，对应字段填null。`,

            balance: `你是一个专业的会计数据分析助手。你的任务是从企业年报文本中提取资产负债表数据。
请严格按照JSON格式输出，不要输出任何其他内容。

输出格式：
{
  "balance_sheet": {
    "assets": {
      "current_assets": [
        {"item": "货币资金", "ending_balance": 数值, "beginning_balance": 数值},
        ...
      ],
      "non_current_assets": [
        {"item": "固定资产", "ending_balance": 数值, "beginning_balance": 数值},
        ...
      ],
      "total_assets": {"item": "资产总计", "ending_balance": 数值, "beginning_balance": 数值}
    },
    "liabilities": {
      "current_liabilities": [...],
      "non_current_liabilities": [...],
      "total_liabilities": {"item": "负债合计", "ending_balance": 数值, "beginning_balance": 数值}
    },
    "equity": {
      "items": [...],
      "total_equity": {"item": "所有者权益合计", "ending_balance": 数值, "beginning_balance": 数值}
    }
  }
}

数值要求：
1. 使用数字，不要带单位（单位默认为元）
2. 如果原文使用万元/亿元，请转换为元
3. 负数保持负号
4. 如果某项数据无法提取，填null`,

            management: `你是一个专业的公司治理分析助手。你的任务是从企业年报文本中提取管理层变动信息。
请严格按照JSON格式输出，不要输出任何其他内容。

输出格式：
{
  "management_changes": [
    {
      "name": "姓名",
      "position": "职位",
      "change_type": "新任/离任/换届/调任",
      "description": "变动说明",
      "date": "变动日期（如有）"
    }
  ]
}

注意：
1. 包括董事、监事、高级管理人员的所有变动
2. 如果报告期内无变动，返回空数组
3. 职位包括：董事长、董事、独立董事、总经理、副总经理、财务总监、董事会秘书、监事会主席、监事等`,

            notes: `你是一个专业的财务分析助手。你的任务是从企业年报文本中提取附注中的重要信息。
请严格按照JSON格式输出，不要输出任何其他内容。

输出格式：
{
  "important_notes": [
    {
      "category": "类别",
      "title": "标题",
      "content": "内容摘要",
      "impact": "high/medium/low"
    }
  ],
  "related_parties": {
    "has_transactions": true/false,
    "summary": "关联交易概述"
  },
  "contingent_liabilities": {
    "has_items": true/false,
    "summary": "或有事项概述"
  },
  "subsequent_events": {
    "has_items": true/false,
    "summary": "资产负债表日后事项概述"
  }
}

类别包括：会计政策变更、重大会计估计、关联方及关联交易、或有事项、承诺事项、资产负债表日后事项、其他重要事项等`
        };

        return prompts[role] || '';
    }
};
