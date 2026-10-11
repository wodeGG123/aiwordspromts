#!/bin/bash
# ============================================================
# deploy.sh
# ----------------------------------------------------------------
# 本地一键部署: git push 代码 → 远端服务器拉取 → Docker 构建并启动
# ----------------------------------------------------------------
# 用法:
#   # 方式 1: 已配置 SSH key,直接执行
#   ./deploy.sh
#
#   # 方式 2: 通过 sshpass 走密码
#   DEPLOY_SSH_PASS='xxx' ./deploy.sh
#
#   # 方式 3: 自定义远端信息
#   DEPLOY_HOST=8.137.38.227 DEPLOY_USER=root \
#   DEPLOY_PORT=22 DEPLOY_DIR='~/aitransfer/aiwordspromts' \
#   ./deploy.sh
# ============================================================

set -euo pipefail

# ---------- 默认配置 ----------
DEPLOY_HOST="${DEPLOY_HOST:-8.137.38.227}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_DIR="${DEPLOY_DIR:-~/aitransfer/aiwordspromts}"
SSH_OPTS=(
  -p "${DEPLOY_PORT}"
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=30
  -o ConnectTimeout=15
)

# ---------- 颜色 ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
die()  { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*"; exit 1; }

# ---------- 同步代码到远端(可选) ----------
info "目标服务器: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_DIR}"

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "本地有未提交的修改:"
  git status --short
  read -rp "是否提交并推送? [Y/n] " ans
  ans="${ans:-Y}"
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    git add -A
    COMMIT_MSG="${1:-chore: deploy $(date +%Y%m%d-%H%M%S)}"
    git commit -m "$COMMIT_MSG" || true
    git push || die "git push 失败"
  else
    die "请先提交所有改动"
  fi
else
  # 无改动也尝试推送,触发 webhook / 更新远端指针
  git push 2>/dev/null || warn "推送跳过(可能没有远程或无网络)"
fi

# ---------- SSH 执行方式 ----------
# 优先用 key,否则用 sshpass(密码不打印到日志)
SSH_CMD="ssh ${SSH_OPTS[*]} ${DEPLOY_USER}@${DEPLOY_HOST}"
run_remote() {
  if [[ -n "${DEPLOY_SSH_PASS:-}" ]]; then
    command -v sshpass >/dev/null 2>&1 || die "请先安装 sshpass: brew install sshpass / apt install sshpass"
    sshpass -p "${DEPLOY_SSH_PASS}" ${SSH_CMD} "$1"
  else
    ${SSH_CMD} "$1"
  fi
}

# ---------- 在远端先确保 docker 已安装 ----------
info "检查远端 Docker 状态..."
if ! run_remote "command -v docker >/dev/null && docker info >/dev/null 2>&1"; then
  warn "远端未检测到运行中的 Docker,自动安装..."
  run_remote "curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun" \
    || die "Docker 安装失败,请手动安装后重试"
fi

# ---------- 首次部署拉一次代码,后续由 docker-deploy.sh 处理 ----------
info "确保远端代码仓库就绪..."
run_remote "mkdir -p $(dirname ${DEPLOY_DIR}) && \
  (cd ${DEPLOY_DIR} 2>/dev/null && git fetch --all) || \
  (test -n \"\\$(command -v git)\" && echo ok)"

# ---------- 触发服务器端 Docker 部署 ----------
info "触发远端 Docker 部署..."
run_remote "cd ${DEPLOY_DIR} && bash docker-deploy.sh"

# ---------- 校验端口 ----------
info "校验服务端口..."
sleep 2
if run_remote "ss -ltn | grep -E ':(3000|3001)\b' >/dev/null"; then
  info "✓ 端口 3000/3001 正在监听"
else
  warn "未检测到端口监听,请到远端查看日志: cd ${DEPLOY_DIR} && docker compose logs -f app"
fi

info "部署完成 ✓"
echo -e "${GREEN}远端 URL 示例:${NC}"
echo -e "  http://${DEPLOY_HOST}:3000/health"
echo -e "  http://${DEPLOY_HOST}:3000/api/chat"
