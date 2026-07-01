/**
 * PDF解析模块 - 使用pdf.js在浏览器端提取文本
 */
const PDFParser = {
    /**
     * 初始化pdf.js worker
     */
    init() {
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    },

    /**
     * 从PDF文件提取文本
     * @param {File} file - PDF文件对象
     * @param {Function} onProgress - 进度回调 (currentPage, totalPages)
     * @returns {Promise<{text: string, pages: Array<{pageNum: number, content: string}>}>}
     */
    async extractText(file, onProgress) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        const pages = [];
        let fullText = '';

        for (let i = 1; i <= totalPages; i++) {
            if (onProgress) onProgress(i, totalPages);

            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // 按y坐标分组，还原段落结构
            const lines = this._groupByLines(textContent.items);
            const pageText = lines.join('\n');

            pages.push({ pageNum: i, content: pageText });
            fullText += pageText + '\n\n';
        }

        return {
            text: fullText.trim(),
            pages,
            totalPages,
            fileName: file.name
        };
    },

    /**
     * 按y坐标将文本项分组为行
     */
    _groupByLines(items) {
        if (!items || items.length === 0) return [];

        // 按y坐标分组（相近的y值视为同一行）
        const tolerance = 3;
        const groups = [];

        // 按y坐标降序排列（PDF坐标系y轴向上）
        const sorted = items
            .filter(item => item.str && item.str.trim())
            .sort((a, b) => {
                const yDiff = b.transform[5] - a.transform[5];
                if (Math.abs(yDiff) > tolerance) return yDiff;
                return a.transform[4] - b.transform[4]; // 同一行按x排序
            });

        let currentY = null;
        let currentLine = [];

        for (const item of sorted) {
            const y = item.transform[5];

            if (currentY === null || Math.abs(y - currentY) > tolerance) {
                if (currentLine.length > 0) {
                    groups.push(currentLine.join(''));
                }
                currentLine = [item.str];
                currentY = y;
            } else {
                // 同一行，检查是否需要加空格
                currentLine.push(item.str);
            }
        }

        if (currentLine.length > 0) {
            groups.push(currentLine.join(''));
        }

        return groups;
    },

    /**
     * 文本预处理：去除多余空白，规范化
     */
    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();
    },

    /**
     * 将长文本分块，每块不超过maxChars
     */
    chunkText(text, maxChars = 6000) {
        const paragraphs = text.split(/\n\n+/);
        const chunks = [];
        let current = '';

        for (const para of paragraphs) {
            if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
                chunks.push(current.trim());
                current = para;
            } else {
                current = current ? current + '\n\n' + para : para;
            }
        }

        if (current.trim()) {
            chunks.push(current.trim());
        }

        return chunks;
    }
};

// 初始化
PDFParser.init();
