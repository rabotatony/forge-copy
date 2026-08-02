#!/usr/bin/env bash
# ============================================================
# Forge — pre-cache Gradle dependencies
# ============================================================
# Runs a no-op Gradle build to download all Android Gradle Plugin
# + AndroidX dependencies into the Gradle cache. After this, the
# first real APK build will be fast (no downloads needed).
#
# Run once after installing the Android SDK + JDK 17.
# ============================================================
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-/home/z/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/home/z/jdk-17.0.9+9}"
export PATH="$JAVA_HOME/bin:$PATH"

GRADLE_BIN="$(command -v gradle || true)"
if [[ -z "$GRADLE_BIN" ]]; then
  GRADLE_BIN="$(find /home/z/.gradle /home/z/gradle-* -path "*/bin/gradle" -type f 2>/dev/null | head -1 || true)"
fi
if [[ -z "$GRADLE_BIN" ]]; then
  echo "ERROR: Gradle not found. Install Gradle 8.5 first." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/app/src/main/java/app/forge/webview"
mkdir -p "$TMP_DIR/app/src/main/res/values"

cat > "$TMP_DIR/settings.gradle" <<'EOF'
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "Precache"
include ':app'
EOF

cat > "$TMP_DIR/build.gradle" <<'EOF'
plugins { id 'com.android.application' version '8.1.4' apply false }
EOF

cat > "$TMP_DIR/gradle.properties" <<'EOF'
android.useAndroidX=true
org.gradle.jvmargs=-Xmx1024m
org.gradle.daemon=false
EOF

cat > "$TMP_DIR/local.properties" <<EOF
sdk.dir=$ANDROID_HOME
EOF

cat > "$TMP_DIR/app/build.gradle" <<'EOF'
plugins { id 'com.android.application' }
android {
    namespace 'app.forge.precache'
    compileSdk 34
    defaultConfig { applicationId "app.forge.precache"; minSdk 21; targetSdk 34; versionCode 1; versionName "1.0" }
}
dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.webkit:webkit:1.8.0'
}
EOF

cat > "$TMP_DIR/app/src/main/AndroidManifest.xml" <<'EOF'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="Precache"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application>
</manifest>
EOF

cat > "$TMP_DIR/app/src/main/res/values/strings.xml" <<'EOF'
<resources><string name="app_name">Precache</string></resources>
EOF

echo "=== Pre-caching Gradle dependencies (this takes 2-3 min on first run) ==="
cd "$TMP_DIR"
"$GRADLE_BIN" :app:help --no-daemon --console=plain 2>&1 | tail -5
echo "=== Done. Gradle cache is now warm. ==="
