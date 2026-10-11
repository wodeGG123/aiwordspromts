#!/bin/bash
# ============================================================
# docker-deploy.sh
# ----------------------------------------------------------------
# 服务器端执行: 在远端服务器上拉取最新代码并重新构建/启动 Docker 容器
# ----------------------------------------------------------------
# 推荐用法(在服务器上):
#   cd ~/aitransfer/aiwordspromts
#   bash docker-deploy.sh
#
# 也支持一次性脚本直连远程服务器(无需预先 SSH):
#   curl -fsSL <URL>/docker-deploy.sh | bash
# ============================================================

set -euo pipefail

# ---------- 颜色输出 ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠${NC} $*"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)] ✗${NC} $*"; exit 1; }

# ---------- 环境检查 ----------
step "检查 Docker 环境..."
if ! command -v docker >/dev/null 2>&1; then
  fail "未安装 docker,请先执行安装脚本(参见 README)"
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon 未运行,请执行: systemctl start docker"
fi

# ---------- 项目目录解析 ----------
# 既支持仓库根目录执行,也支持通过 curl pipe 调用
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
PROJECT_DIR="${PROJECT_DIR:-${SCRIPT_DIR}}"

# 若用户从管道执行,首次拉一份代码
if [[ ! -d "${PROJECT_DIR}/.git" ]]; then
  REPO_URL="${REPO_URL:-git@github.com:YOUR_ORG/aiwordspromts.git}"
  BRANCH="${BRANCH:-main}"
  step "未检测到 git 仓库,克隆 ${REPO_URL} @ ${BRANCH} 到 ${PROJECT_DIR}"
  mkdir -p "$(dirname "${PROJECT_DIR}")"
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${PROJECT_DIR}"
fi

cd "${PROJECT_DIR}"
step "工作目录: $(pwd)"

# ---------- 配置校验 ----------
if [[ ! -f .env.production ]]; then
  if [[ -f .env.example ]]; then
    warn ".env.production 不存在,自动从 .env.example 复制,请尽快填入真实配置!"
    cp .env.example .env.production
  else
    fail "缺少 .env.production 与 .env.example,无法启动"
  fi
fi

# AI_API_KEY 必填校验
if ! grep -qE '^AI_API_KEY=.+' .env.production; then
  fail "请在 .env.production 中填写 AI_API_KEY"
fi

# ---------- 拉取最新代码 ----------
step "拉取最新代码..."
git fetch --all --prune
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)" 2>/dev/null || git pull --rebase --autostash

# ---------- 构建镜像 ----------
step "构建 Docker 镜像(将输出下载进度)..."
docker compose -f docker-compose.yml build --pull --no-cache

# ---------- 重启容器 ----------
step "停止并重建容器..."
docker compose -f docker-compose.yml down --remove-orphans || true
docker compose -f docker-compose.yml up -d

# ---------- 健康检查 ----------
step "等待服务启动并验证健康状态..."
ATTEMPTS=0
MAX_ATTEMPTS=15
until docker compose -f docker-compose.yml ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ ${ATTEMPTS} -ge ${MAX_ATTEMPTS} ]]; then
    warn "健康检查超时,打印最近日志:"
    docker compose -f docker-compose.yml logs --tail=80 app || true
    fail "服务启动失败,请检查上方日志"
  fi
  sleep 2
done
step "容器健康状态: ✓ healthy"

# ---------- 清理悬空镜像 ----------
step "清理悬空镜像,释放磁盘..."
docker image prune -f >/dev/null

# ---------- 完成 ----------
step "部署完成 ✓"
docker compose -f docker-compose.yml ps
echo -e "${GREEN}日志查看:${NC}  cd ${PROJECT_DIR} && docker compose logs -f app"
