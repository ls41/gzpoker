#!/usr/bin/env bash
# 生成 GitHub Pages 静态包到 docs/
set -e
cd "$(dirname "$0")"
rm -rf docs && mkdir -p docs
cp index.html app.js engine.js bot.js net.js mqtt.min.js docs/
touch docs/.nojekyll
echo "docs/ 已生成：$(ls docs | tr '\n' ' ')"
