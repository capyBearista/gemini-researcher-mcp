# =============================================================================
# Gemini Researcher MCP Server - Dockerfile
# =============================================================================
# Multi-stage build for a lightweight MCP server image
#
# This Dockerfile builds the gemini-researcher MCP server, which proxies
# research queries to Gemini CLI for codebase analysis.
#
# Requirements:
#   - GEMINI_API_KEY environment variable must be set at runtime
#   - Mount your project directory to /workspace for analysis
#
# Usage:
#   docker build -t gemini-researcher .
#   docker run -e GEMINI_API_KEY="your-key" -v /path/to/project:/workspace gemini-researcher
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production
# -----------------------------------------------------------------------------
FROM node:22-slim AS production

# Install git (required for .gitignore parsing by the 'ignore' package)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev

# Install Gemini CLI globally (required for proxying queries)
RUN npm install -g @google/gemini-cli

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create workspace directory for mounting projects
RUN mkdir -p /workspace
WORKDIR /workspace

# Environment variables
# GEMINI_API_KEY must be provided at runtime
ENV NODE_ENV=production
ENV PROJECT_ROOT=/workspace

# The MCP server uses stdio transport - it reads from stdin and writes to stdout
# This makes it compatible with MCP clients like Claude Desktop

# Health check is not applicable for stdio-based servers
# The server validates Gemini CLI on startup

# Entry point - run the MCP server
ENTRYPOINT ["node", "/app/dist/index.js"]

# Default command (can be overridden for setup wizard)
# To run setup wizard: docker run ... gemini-researcher init
CMD []
