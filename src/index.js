import 'dotenv/config';
import OpenAI from 'openai';
import http from 'http';

// 引入系统提示词
import systemPrompt from './adventure_story_prompt.js';

const PORT = process.env.PORT || 3000;
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const AI_API_KEY = process.env.AI_API_KEY || 'a5cccc9b-116e-40e1-9009-0c0f8fe56eb8';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v3-2-251201';
const ENABLE_PROMPT_FILTER = process.env.ENABLE_PROMPT_FILTER === 'true';
const PROMPT_BLACKLIST = (process.env.PROMPT_BLACKLIST || '').split(',').filter(Boolean);

// 初始化 OpenAI 客户端
const openai = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: AI_BASE_URL,
});

// 内容已屏蔽标记
const FILTERED_MARKER = '[内容已屏蔽]';

/**
 * 检查文本是否包含黑名单词汇
 * @param {string} text - 要检查的文本
 * @returns {boolean} - 是否包含敏感词
 */
function containsBlacklistWords(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return PROMPT_BLACKLIST.some(word => lowerText.includes(word.toLowerCase()));
}

/**
 * 过滤消息内容，替换敏感词
 * @param {object} message - 消息对象
 * @returns {object} - 过滤后的消息
 */
function filterMessageContent(message) {
  if (!message || message.role !== 'user') {
    return message;
  }

  if (!message.content || typeof message.content !== 'string') {
    return message;
  }

  if (containsBlacklistWords(message.content)) {
    return {
      ...message,
      content: FILTERED_MARKER
    };
  }

  return message;
}

/**
 * 过滤请求消息列表
 * @param {Array} messages - 消息数组
 * @returns {Array} - 过滤后的消息数组
 */
function filterMessages(messages) {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return messages.map(msg => filterMessageContent(msg));
}

/**
 * 处理聊天请求
 */
async function handleChat(req, res) {
  let body = '';

  req.on('data', chunk => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const requestData = JSON.parse(body);
      
      // 获取模型名称（如果未指定，使用配置的默认模型）
      const model = requestData.model || AI_MODEL;
      
      // 过滤提示词
      let filteredData = requestData;
      if (ENABLE_PROMPT_FILTER && requestData.messages) {
        filteredData = {
          ...requestData,
          messages: filterMessages(requestData.messages)
        };
        
        // 检查是否有内容被过滤
        const hasFiltered = filteredData.messages.some((msg, idx) => 
          msg.content === FILTERED_MARKER && requestData.messages[idx]?.content !== FILTERED_MARKER
        );
        
        if (hasFiltered) {
          console.log(`[${new Date().toISOString()}] 提示词已屏蔽`);
        }
      }

      // 将系统提示词添加到 messages 最前面
      const messagesWithSystem = [
        {
          role: 'system',
          content: systemPrompt
        },
        ...filteredData.messages
      ];

      // 使用 OpenAI SDK 调用 AI 后端
      const response = await openai.chat.completions.create({
        model: model,
        messages: messagesWithSystem,
      });

      // 返回响应给客户端
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end(JSON.stringify(response));

      } catch (error) {
        console.error(`[${new Date().toISOString()}] 处理请求失败:`, error.message);
        
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: '服务器处理请求失败',
            type: 'server_error'
          }
        }));
      }
    });
}

/**
 * 处理 OPTIONS 预检请求
 */
function handleCors(res) {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end();
}

/**
 * 健康检查
 */
function handleHealth(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    promptFilter: {
      enabled: ENABLE_PROMPT_FILTER,
      blacklistCount: PROMPT_BLACKLIST.length
    }
  }));
}

/**
 * 创建 HTTP 服务器
 */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 记录请求
  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);

  // 处理 CORS 预检请求
  if (req.method === 'OPTIONS') {
    handleCors(res);
    return;
  }

  // 路由处理
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    handleChat(req, res);
  } else if (url.pathname === '/health' && req.method === 'GET') {
    handleHealth(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: '未找到请求的端点',
        type: 'not_found'
      }
    }));
  }
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  AI 大模型转发服务器已启动`);
  console.log(`========================================`);
  console.log(`  端口: ${PORT}`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  提示词过滤: ${ENABLE_PROMPT_FILTER ? '已启用' : '已禁用'}`);
  if (ENABLE_PROMPT_FILTER) {
    console.log(`  黑名单词汇: ${PROMPT_BLACKLIST.length} 个`);
  }
  console.log(`========================================\n`);
  console.log(`可用接口:`);
  console.log(`  POST /api/chat  - 聊天接口`);
  console.log(`  GET  /health    - 健康检查`);
  console.log(`\n`);
});

// 错误处理
server.on('error', (error) => {
  console.error(`服务器错误:`, error.message);
  process.exit(1);
});
