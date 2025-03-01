#!/bin/bash
echo "🔹 Installing Chromium for Puppeteer..."
apt-get update && apt-get install -y wget unzip
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb
echo "✅ Chromium Installed!"
