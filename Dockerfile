# ============================================================
# 多阶段构建,最终镜像只包含运行时所需文件
# ============================================================

# ---- 阶段 1: 依赖安装 ----
FROM node:20-alpine AS deps

# 阿里云镜像加速,避免国外源拉取超时
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /app

# 先复制 manifest 单独安装依赖,最大化层缓存复用
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ============================================================
# ---- 阶段 2: 运行时镜像 ----
FROM node:20-alpine AS runtime

# Alpine 需要 libc6-compat 才能跑某些 native 模块
RUN apk add --no-cache libc6-compat dumb-init wget \
 && npm config set registry https://registry.npmmirror.com

# 创建非 root 用户运行容器(安全最佳实践)
RUN addgroup -g 1001 -S nodejs \
 && adduser  -S -u 1001 -G nodejs nodejs

WORKDIR /app

# 复制生产依赖
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
# 复制应用源码
COPY --chown=nodejs:nodejs package.json ./
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs apk-info.json ./

# ⚠️ 旧版通道的数据包依赖:
#   src/runtime_contract.mjs 从 ../数据拆分包_20260904/ 引入预切片积木入口与
#   模块化入口。缺这个目录,容器启动即 ERR_MODULE_NOT_FOUND。
#   .dockerignore 排除了该目录(避免 2.9MB 进入构建上下文),所以这里显式 COPY。
COPY --chown=nodejs:nodejs 数据拆分包_20260904 ./数据拆分包_20260904

# v3(连续八章冒险)引擎已 vendor 到 src/engine/vendor/v3/,
# 由 `node tools/sync_v3.mjs` 从数据包同步而来,随 src 一起复制,无需额外 COPY。

ENV NODE_ENV=production \
    PORT=3000 \
    PROXY_PORT=3001 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

EXPOSE 3000 3001

# dumb-init 负责转发信号,保证容器能优雅关闭
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]

# 容器级健康检查:命中 /health 端点
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

USER nodejs
