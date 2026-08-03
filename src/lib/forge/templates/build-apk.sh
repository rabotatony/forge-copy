#!/usr/bin/env bash
# ============================================================
# Forge — build-apk.sh
# ============================================================
# Wraps an HTML/JS/web project into a signed Android APK using a
# WebView. This is the "zero-native-code" path: the user's web
# assets become the app content, hosted inside a full-screen
# Android WebView.
#
# Usage:
#   build-apk.sh <project-root> <output-dir> [app-name] [package-id] [version-name]
#
# Outputs:
#   <output-dir>/app-release.apk   (signed, installable)
#   <output-dir>/build.log         (full build log)
#
# Requirements (auto-detected):
#   • Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT / /home/z/android-sdk)
#   • JDK 17+ (java, keytool on PATH)
#   • Gradle (downloaded on demand if missing)
# ============================================================
set -euo pipefail

PROJECT_ROOT="${1:-}"
OUTPUT_DIR="${2:-}"
APP_NAME="${3:-ForgeApp}"
PACKAGE_ID="${4:-app.forge.webview}"
VERSION_NAME="${5:-1.0.0}"

# ---------- validation ----------
if [[ -z "$PROJECT_ROOT" || -z "$OUTPUT_DIR" ]]; then
  echo "ERROR: usage: build-apk.sh <project-root> <output-dir> [app-name] [package-id] [version-name]" >&2
  exit 2
fi
if [[ ! -d "$PROJECT_ROOT" ]]; then
  echo "ERROR: project root does not exist: $PROJECT_ROOT" >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
BUILD_LOG="$OUTPUT_DIR/build.log"
exec > >(tee -a "$BUILD_LOG") 2>&1

echo "=== Forge APK Builder ==="
echo "Project root : $PROJECT_ROOT"
echo "Output dir   : $OUTPUT_DIR"
echo "App name     : $APP_NAME"
echo "Package ID   : $PACKAGE_ID"
echo "Version      : $VERSION_NAME"
echo "Timestamp    : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ---------- locate Android SDK ----------
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_SDK" || ! -d "$ANDROID_SDK" ]]; then
  for candidate in /home/z/android-sdk /opt/android-sdk "$HOME/android-sdk"; do
    if [[ -d "$candidate" ]]; then
      ANDROID_SDK="$candidate"
      break
    fi
  done
fi
if [[ -z "$ANDROID_SDK" || ! -d "$ANDROID_SDK" ]]; then
  echo "ERROR: Android SDK not found. Set ANDROID_HOME or install to /home/z/android-sdk" >&2
  exit 3
fi
echo "Android SDK  : $ANDROID_SDK"

# ---------- locate Java (prefer JDK 17 for Android Gradle Plugin 8.x) ----------
JAVA_HOME_DIR=""
# Try JDK 17 first (AGP 8.1 requires < 21 for jlink).
# Note: use ${JAVA_HOME:-} to avoid unbound-variable errors under `set -u`.
for candidate in \
  /home/z/jdk-17.0.9+9 \
  /home/z/jdk-17* \
  /usr/lib/jvm/java-17-openjdk-amd64 \
  /usr/lib/jvm/java-1.17.0-openjdk-amd64 \
  "${JAVA_HOME:-}"; do
  if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
    JAVA_HOME_DIR="$candidate"
    break
  fi
done
# Fall back to system java.
if [[ -z "$JAVA_HOME_DIR" ]]; then
  JAVA_BIN="$(command -v java || true)"
  if [[ -z "$JAVA_BIN" ]]; then
    echo "ERROR: java not found on PATH" >&2
    exit 3
  fi
  JAVA_HOME_DIR="$(dirname "$(dirname "$(readlink -f "$JAVA_BIN")")")"
fi
export JAVA_HOME="$JAVA_HOME_DIR"
export PATH="$JAVA_HOME/bin:$PATH"
echo "Java         : $JAVA_HOME/bin/java"
java -version 2>&1 | head -1

# ---------- ensure platform + build-tools ----------
PLATFORM="$ANDROID_SDK/platforms/android-34"
BUILD_TOOLS="$ANDROID_SDK/build-tools/34.0.0"
if [[ ! -d "$PLATFORM" || ! -d "$BUILD_TOOLS" ]]; then
  echo "Installing Android platform-34 + build-tools 34.0.0..."
  SDKMANAGER="$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager"
  if [[ ! -x "$SDKMANAGER" ]]; then
    echo "ERROR: sdkmanager not found at $SDKMANAGER" >&2
    exit 3
  fi
  yes | "$SDKMANAGER" --sdk_root="$ANDROID_SDK" "platforms;android-34" "build-tools;34.0.0" >/dev/null 2>&1 || true
fi
AAPT2="$BUILD_TOOLS/aapt2"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
if [[ ! -x "$AAPT2" ]]; then
  echo "ERROR: aapt2 not found at $AAPT2 (build-tools not installed)" >&2
  exit 3
fi
echo "aapt2        : $AAPT2"

# ---------- locate or download Gradle ----------
GRADLE_BIN="$(command -v gradle || true)"
if [[ -z "$GRADLE_BIN" ]]; then
  GRADLE_DIST_DIR="$HOME/.gradle/wrapper/dists"
  GRADLE_BIN="$(find "$GRADLE_DIST_DIR" -path "*/bin/gradle" -type f 2>/dev/null | head -1 || true)"
fi
if [[ -z "$GRADLE_BIN" ]]; then
  echo "Gradle not found — downloading Gradle 8.5..."
  GRADLE_ZIP="/tmp/gradle-8.5-bin.zip"
  GRADLE_DIR="$HOME/gradle-8.5"
  if [[ ! -d "$GRADLE_DIR" ]]; then
    curl -sL -o "$GRADLE_ZIP" "https://services.gradle.org/distributions/gradle-8.5-bin.zip"
    unzip -q "$GRADLE_ZIP" -d "$HOME"
    rm "$GRADLE_ZIP"
  fi
  GRADLE_BIN="$GRADLE_DIR/bin/gradle"
fi
echo "Gradle       : $GRADLE_BIN"
"$GRADLE_BIN" --version 2>&1 | head -3
echo

# ---------- prepare web assets ----------
echo "=== Preparing web assets ==="
WEB_ASSETS="$OUTPUT_DIR/web-assets"
rm -rf "$WEB_ASSETS"
mkdir -p "$WEB_ASSETS"

# Find the main HTML file (prefer index.html at root, then in public/, then any .html)
INDEX_HTML=""
for candidate in \
  "$PROJECT_ROOT/index.html" \
  "$PROJECT_ROOT/public/index.html" \
  "$PROJECT_ROOT/src/index.html" \
  "$PROJECT_ROOT/app/index.html"; do
  if [[ -f "$candidate" ]]; then
    INDEX_HTML="$candidate"
    break
  fi
done
if [[ -z "$INDEX_HTML" ]]; then
  # Fall back to the first .html file found
  INDEX_HTML="$(find "$PROJECT_ROOT" -maxdepth 3 -name "*.html" -not -path "*/node_modules/*" 2>/dev/null | head -1 || true)"
fi
if [[ -z "$INDEX_HTML" ]]; then
  echo "ERROR: no HTML file found in project" >&2
  exit 4
fi
echo "Main HTML    : $INDEX_HTML"

# Copy the whole project (minus heavy dirs) into web-assets so the
# WebView can load relative paths. We keep it flat under www/.
# BUGFIX(2026-08): previously "$WEB_ASSETS/assets/www" which produced
# android_asset/assets/www/... while MainActivity loads android_asset/www/...
# (assets.srcDirs points at $WEB_ASSETS). Keep files under www/ to match the loadUrl.
WEB_WWW="$WEB_ASSETS/www"
mkdir -p "$WEB_WWW"
SKIP_DIRS=(node_modules .git dist build .next target __pycache__ .venv venv .cache)

# Use rsync if available for efficient copy with excludes; else cp
if command -v rsync >/dev/null 2>&1; then
  rsync_excludes=()
  for d in "${SKIP_DIRS[@]}"; do
    rsync_excludes+=("--exclude=$d")
  done
  rsync -a "${rsync_excludes[@]}" "$PROJECT_ROOT/" "$WEB_WWW/"
else
  # Manual copy skipping heavy dirs
  (cd "$PROJECT_ROOT" && find . -maxdepth 4 -type f \
    -not -path "./node_modules/*" \
    -not -path "./.git/*" \
    -not -path "./dist/*" \
    -not -path "./build/*" \
    -not -path "./.next/*" \
    -not -path "./target/*" \
    -not -path "./__pycache__/*" \
    -not -path "./.venv/*" \
    -not -path "./venv/*" \
    -not -path "./.cache/*" \
    -exec cp --parents {} "$WEB_WWW/" \; 2>/dev/null) || true
fi

# Ensure index.html exists at the web root
if [[ ! -f "$WEB_WWW/index.html" ]]; then
  cp "$INDEX_HTML" "$WEB_WWW/index.html"
fi
echo "Web assets   : $(find "$WEB_WWW" -type f | wc -l) files, $(du -sh "$WEB_WWW" | cut -f1)"
echo

# ---------- generate the Android project ----------
echo "=== Generating Android project ==="
ANDROID_PROJECT="$OUTPUT_DIR/android-project"
rm -rf "$ANDROID_PROJECT"
mkdir -p "$ANDROID_PROJECT/app/src/main/java/$(echo "$PACKAGE_ID" | tr '.' '/')"
mkdir -p "$ANDROID_PROJECT/app/src/main/res/values"
mkdir -p "$ANDROID_PROJECT/app/src/main/res/mipmap"

# --- settings.gradle ---
cat > "$ANDROID_PROJECT/settings.gradle" <<EOF
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ForgeApp"
include ':app'
EOF

# --- build.gradle (root) ---
cat > "$ANDROID_PROJECT/build.gradle" <<'EOF'
plugins {
    id 'com.android.application' version '8.1.4' apply false
}
EOF

# --- gradle.properties ---
cat > "$ANDROID_PROJECT/gradle.properties" <<EOF
android.useAndroidX=true
android.enableJetifier=false
org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8
org.gradle.parallel=false
org.gradle.daemon=false
android.suppressUnsupportedCompileSdk=34
EOF

# --- local.properties (SDK location) ---
cat > "$ANDROID_PROJECT/local.properties" <<EOF
sdk.dir=$ANDROID_SDK
EOF

# --- app/build.gradle ---
cat > "$ANDROID_PROJECT/app/build.gradle" <<EOF
plugins {
    id 'com.android.application'
}

android {
    namespace '$PACKAGE_ID'
    compileSdk 34

    defaultConfig {
        applicationId "$PACKAGE_ID"
        minSdk 21
        targetSdk 34
        versionCode 1
        versionName "$VERSION_NAME"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    sourceSets {
        main {
            assets.srcDirs = ["$WEB_ASSETS"]
        }
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.webkit:webkit:1.8.0'
}
EOF

# --- proguard-rules.pro ---
cat > "$ANDROID_PROJECT/app/proguard-rules.pro" <<EOF
-keep class $PACKAGE_ID.** { *; }
EOF

# --- AndroidManifest.xml ---
cat > "$ANDROID_PROJECT/app/src/main/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:label="$APP_NAME"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="@style/Theme.App"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden|uiMode"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

# --- MainActivity.java ---
JAVA_PKG_PATH="$(echo "$PACKAGE_ID" | tr '.' '/')"
cat > "$ANDROID_PROJECT/app/src/main/java/$JAVA_PKG_PATH/MainActivity.java" <<EOF
package $PACKAGE_ID;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.loadUrl("file:///android_asset/www/index.html");

        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
EOF

# --- res/layout/activity_main.xml ---
mkdir -p "$ANDROID_PROJECT/app/src/main/res/layout"
cat > "$ANDROID_PROJECT/app/src/main/res/layout/activity_main.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<WebView xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/webview"
    android:layout_width="match_parent"
    android:layout_height="match_parent" />
EOF

# --- res/values/themes.xml + strings.xml ---
cat > "$ANDROID_PROJECT/app/src/main/res/values/themes.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.App" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowNoTitle">true</item>
    </style>
</resources>
EOF

cat > "$ANDROID_PROJECT/app/src/main/res/values/strings.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">$APP_NAME</string>
</resources>
EOF

# --- Generate a simple launcher icon (green square with "F") ---
# Use aapt2 to create a minimal PNG-less adaptive icon via mipmap-anydpi-v26
mkdir -p "$ANDROID_PROJECT/app/src/main/res/mipmap-anydpi-v26"
cat > "$ANDROID_PROJECT/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
EOF
mkdir -p "$ANDROID_PROJECT/app/src/main/res/drawable"
cat > "$ANDROID_PROJECT/app/src/main/res/drawable/ic_launcher_background.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#10B981" />
</shape>
EOF
cat > "$ANDROID_PROJECT/app/src/main/res/drawable/ic_launcher_foreground.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M30,30 h48 v12 h-36 v10 h28 v12 h-28 v14 h-12 z" />
</vector>
EOF
echo "Android project generated at $ANDROID_PROJECT"
echo

# ---------- generate debug keystore (for signing) ----------
echo "=== Generating signing keystore ==="
KEYSTORE="$OUTPUT_DIR/forge-debug.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair \
    -alias forge-debug \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -keystore "$KEYSTORE" \
    -storepass android \
    -keypass android \
    -dname "CN=Forge Debug, OU=CI, O=Forge, L=Local, ST=Local, C=IL" 2>&1 | tail -2
fi
echo "Keystore     : $KEYSTORE"
echo

# ---------- build the APK with Gradle ----------
echo "=== Building APK with Gradle ==="
cd "$ANDROID_PROJECT"
export ANDROID_HOME="$ANDROID_SDK"
export ANDROID_SDK_ROOT="$ANDROID_SDK"

# Build the debug APK first (lighter, faster, no shrinking/proguard).
# Debug APKs are signed with the debug key and installable on any device
# that allows "unknown sources". For a release build, the caller can
# post-process the output.
"$GRADLE_BIN" :app:assembleDebug \
  --no-daemon \
  --console=plain 2>&1 || {
    echo "ERROR: Gradle debug build failed — see log above" >&2
    exit 5
  }

# Locate the built APK
APK_SRC=""
for candidate in \
  "$ANDROID_PROJECT/app/build/outputs/apk/debug/app-debug.apk" \
  "$ANDROID_PROJECT/app/build/outputs/apk/release/app-release-unsigned.apk" \
  "$ANDROID_PROJECT/app/build/outputs/apk/release/app-release.apk"; do
  if [[ -f "$candidate" ]]; then
    APK_SRC="$candidate"
    break
  fi
done
if [[ -z "$APK_SRC" ]]; then
  echo "ERROR: no APK produced by Gradle" >&2
  exit 5
fi
echo "Built APK    : $APK_SRC ($(du -h "$APK_SRC" | cut -f1))"
echo

# ---------- sign the APK ----------
echo "=== Signing APK ==="
APK_ALIGNED="$OUTPUT_DIR/app-aligned.apk"
APK_FINAL="$OUTPUT_DIR/app-release.apk"

# Zipalign
"$ZIPALIGN" -f -p 4 "$APK_SRC" "$APK_ALIGNED" 2>&1 || cp "$APK_SRC" "$APK_ALIGNED"

# Sign with apksigner (v2 signature scheme for Android 7+)
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias forge-debug \
  --ks-pass pass:android \
  --key-pass pass:android \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$APK_FINAL" \
  "$APK_ALIGNED" 2>&1 || {
    echo "apksigner failed — falling back to jarsigner..."
    cp "$APK_ALIGNED" "$APK_FINAL"
    jarsigner -keystore "$KEYSTORE" \
      -storepass android \
      -keypass android \
      -signedjar "$APK_FINAL" \
      "$APK_ALIGNED" forge-debug 2>&1 | tail -3
  }

# Verify signature
"$APKSIGNER" verify --verbose "$APK_FINAL" 2>&1 | head -5 || true
echo
echo "=== Build complete ==="
echo "Final APK    : $APK_FINAL"
echo "Size         : $(du -h "$APK_FINAL" | cut -f1)"
echo "SHA-256      : $(sha256sum "$APK_FINAL" | cut -d' ' -f1)"
echo "App name     : $APP_NAME"
echo "Package ID   : $PACKAGE_ID"
echo "Version      : $VERSION_NAME"
echo
echo "The APK is signed and ready to install on any Android 5.0+ device."
echo "Install with: adb install $APK_FINAL"
