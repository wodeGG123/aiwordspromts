# AI 大模型转发服务器

一个用于转发AI API请求的服务端点，可屏蔽/过滤客户端发送的提示词。

## 功能特点

- 接收客户端请求并转发到指定的AI后端
- 支持屏蔽/过滤提示词
- 不处理流式数据，直接返回完整响应
- 支持多种AI API兼容接口

## 使用方法

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.example` 为 `.env`，或直接创建 `.env` 文件：

```env
# 服务器端口
PORT=3000

# AI 后端地址（支持 OpenAI 兼容 API）
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your-api-key-here
AI_MODEL=gpt-4o-mini

# 提示词屏蔽配置
ENABLE_PROMPT_FILTER=true
PROMPT_BLACKLIST=违禁词1,违禁词2,违禁词3
```

### 启动服务器

```bash
npm start
```

## API 接口

### POST /api/chat

发送聊天请求。

**请求体（OpenAI兼容格式）：**

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "你好，请帮我写一首诗"}
  ],
  "temperature": 0.7
}
```

**响应体：**

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "你好！这是一首诗..."
      },
      "finish_reason": "stop"
    }
  ]
}
```

### GET /health

健康检查接口。

## 提示词过滤说明

当 `ENABLE_PROMPT_FILTER=true` 时，系统会检测用户发送的提示词（messages 中的 user role 内容）是否包含黑名单词汇。如果检测到，服务器会：

1. 将请求中的敏感内容替换为 `[内容已屏蔽]`
2. 继续转发请求到AI后端
3. 返回AI的正常响应

## 许可证

MIT
