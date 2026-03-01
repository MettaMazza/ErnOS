#!/usr/bin/env bash
# ErnOS V5 - Automated One-Click Installer
# This script installs all necessary dependencies (Node.js, pnpm, Docker/Podman, Ollama)
# and bootstraps the ErnOS environment for a seamless zero-to-running experience.
set -euo pipefail

# --- Colors for Output ---
RED='\032[0;31m'
GREEN='\032[0;32m'
BLUE='\032[0;34m'
YELLOW='\032[1;33m'
NC='\032[0m' # No Color

echo -e "${BLUE}=================================================${NC}"
echo -e "${GREEN}        Welcome to the ErnOS V5 Installer        ${NC}"
echo -e "${BLUE}=================================================${NC}"
echo "This script will automatically install:"
echo " - Node.js & pnpm"
echo " - Docker (or Podman on Linux)"
echo " - Ollama (for local offline inference)"
echo " - ErnOS repository & dependencies"

sleep 2

# --- OS Detection ---
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo -e "\n${YELLOW}Detecting OS... ${MACHINE}${NC}"

if [ "$MACHINE" == "UNKNOWN:*" ]; then
    echo -e "${RED}Unsupported Operating System. Please install dependencies manually.${NC}"
    exit 1
fi

# --- Helper: Check if command exists ---
cmd_exists() {
    command -v "$1" >/dev/null 2>&1
}

# --- 1. Package Manager / Base Tools ---
if [ "$MACHINE" == "Mac" ]; then
    if ! cmd_exists brew; then
        echo -e "${YELLOW}Installing Homebrew...${NC}"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        echo -e "${GREEN}Homebrew is already installed.${NC}"
    fi
elif [ "$MACHINE" == "Linux" ]; then
    echo -e "${YELLOW}Updating Apt...${NC}"
    sudo apt-get update -y
    sudo apt-get install -y curl git jq rsync
fi

# --- 2. Node.js & pnpm ---
if ! cmd_exists pnpm; then
    echo -e "${YELLOW}Installing pnpm...${NC}"
    curl -fsSL https://get.pnpm.io/install.sh | sh -
    export PNPM_HOME="\$HOME/.local/share/pnpm"
    export PATH="\$PNPM_HOME:\$PATH"
else
    echo -e "${GREEN}pnpm is already installed.${NC}"
fi

if ! cmd_exists node; then
    echo -e "${YELLOW}Installing Node.js...${NC}"
    if [ "$MACHINE" == "Mac" ]; then
        brew install node
    else
        # Install Node 22 via NodeSource
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
else
    echo -e "${GREEN}Node.js is already installed. ($(node -v))${NC}"
fi

# --- 3. Docker / Podman ---
if ! cmd_exists docker && ! cmd_exists podman; then
    echo -e "${YELLOW}Container runtime not found. Installing...${NC}"
    if [ "$MACHINE" == "Mac" ]; then
        echo -e "${YELLOW}Installing Docker for Mac via Homebrew...${NC}"
        brew install --cask docker
        echo -e "${BLUE}Please open Docker Desktop from your Applications folder, accept the terms, and let it start in the background.${NC}"
        read -p "Press Enter once Docker Desktop is running..."
    else
        echo -e "${YELLOW}Installing Docker for Linux...${NC}"
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker $USER
        rm get-docker.sh
    fi
else
    echo -e "${GREEN}Container runtime (Docker/Podman) is already installed.${NC}"
fi

# --- 4. Ollama ---
if ! cmd_exists ollama; then
    echo -e "${YELLOW}Installing Ollama for local LLM inference...${NC}"
    if [ "$MACHINE" == "Mac" ]; then
        brew install --cask ollama
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    # Start Ollama service in background
    if [ "$MACHINE" == "Mac" ]; then
        open -a Ollama
    else
        sudo systemctl enable --now ollama || true
    fi
    echo -e "${GREEN}Ollama installed. Pulling default model (qwen2.5:32b for ErnOS cognition)...${NC}"
    echo -e "${YELLOW}Note: This is a heavy model (19GB+) required for advanced reasoning. This may take a while.${NC}"
    sleep 3
    ollama pull qwen2.5:32b
else
    echo -e "${GREEN}Ollama is already installed.${NC}"
fi

# --- 5. ErnOS Repository Setup ---
ERNOS_DIR="$HOME/ernos"

if [ ! -d "$ERNOS_DIR" ]; then
    echo -e "\n${YELLOW}Cloning ErnOS repository into $ERNOS_DIR...${NC}"
    git clone https://github.com/ernos/ernos.git "$ERNOS_DIR"
else
    echo -e "\n${GREEN}ErnOS repository already exists at $ERNOS_DIR. Pulling latest...${NC}"
    cd "$ERNOS_DIR"
    git pull
fi

cd "$ERNOS_DIR"

echo -e "\n${YELLOW}Installing ErnOS Node dependencies...${NC}"
pnpm install

echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN}        Installation Complete! 🎉               ${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "To start ErnOS, simply run:"
echo -e "${BLUE}cd $ERNOS_DIR && ./start-ernos.sh${NC}"
echo -e "\nErnOS will automatically provision your Graph Memory container and local environment on first boot."
