#!/usr/bin/env bash
# ============================================================
# Forge — bootstrap build tools (auto-install SDK + JDK + Gradle)
# ============================================================
# This script installs everything needed for APK builds into
# /home/z/ (persists better than /tmp). Safe to re-run.
# ============================================================
set -euo pipefail

echo "=== Forge Bootstrap ==="
echo "Checking build tools…"

NEED_SDK=false
NEED_JDK=false
NEED_GRADLE=false

if [[ ! -x /home/z/android-sdk/build-tools/34.0.0/aapt2 ]]; then
  NEED_SDK=true
fi
if [[ ! -x /home/z/jdk-17.0.9+9/bin/java ]]; then
  NEED_JDK=true
fi
if [[ ! -x /home/z/gradle-8.5/bin/gradle ]]; then
  NEED_GRADLE=true
fi

if [[ "$NEED_SDK" == "false" && "$NEED_JDK" == "false" && "$NEED_GRADLE" == "false" ]]; then
  echo "✓ All build tools already installed."
  exit 0
fi

echo "Missing tools: SDK=$NEED_SDK JDK=$NEED_JDK Gradle=$NEED_GRADLE"
echo

# --- JDK 17 ---
if [[ "$NEED_JDK" == "true" ]]; then
  echo "=== Installing JDK 17 (Temurin) ==="
  if [[ ! -d /home/z/jdk-17.0.9+9 ]]; then
    cd /tmp
    curl -sL -o jdk17.tar.gz "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jdk_x64_linux_hotspot_17.0.9_9.tar.gz"
    tar xzf jdk17.tar.gz -C /home/z
    rm jdk17.tar.gz
  fi
  /home/z/jdk-17.0.9+9/bin/java -version 2>&1 | head -1
  echo "✓ JDK 17 installed"
fi

# --- Android SDK ---
if [[ "$NEED_SDK" == "true" ]]; then
  echo "=== Installing Android SDK ==="
  mkdir -p /home/z/android-sdk/cmdline-tools
  cd /home/z/android-sdk/cmdline-tools
  if [[ ! -d latest ]]; then
    curl -sL -o /tmp/cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    unzip -q /tmp/cmdtools.zip
    mv cmdline-tools latest
    rm /tmp/cmdtools.zip
  fi
  export JAVA_HOME=/home/z/jdk-17.0.9+9
  export ANDROID_HOME=/home/z/android-sdk
  yes | /home/z/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/home/z/android-sdk --licenses 2>&1 | tail -1
  yes | /home/z/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/home/z/android-sdk "platforms;android-34" "build-tools;34.0.0" 2>&1 | tail -3
  echo "✓ Android SDK installed"
fi

# --- Gradle 8.5 ---
if [[ "$NEED_GRADLE" == "true" ]]; then
  echo "=== Installing Gradle 8.5 ==="
  if [[ ! -d /home/z/gradle-8.5 ]]; then
    cd /tmp
    curl -sL -o gradle.zip "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
    unzip -q gradle.zip -d /home/z
    rm gradle.zip
  fi
  /home/z/gradle-8.5/bin/gradle --version 2>&1 | head -2
  echo "✓ Gradle 8.5 installed"
fi

echo
echo "=== All build tools ready ==="
echo "SDK:    /home/z/android-sdk"
echo "JDK:    /home/z/jdk-17.0.9+9"
echo "Gradle: /home/z/gradle-8.5"
