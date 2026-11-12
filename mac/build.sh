#!/bin/bash
# Builds build/Phlox.app: the native window plus a copy of the server it runs.
set -euo pipefail
cd "$(dirname "$0")/.."

APP=build/Phlox.app
rm -rf build/Ember.app # the name it had before
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

swiftc -O -o "$APP/Contents/MacOS/Phlox" mac/main.swift -framework Cocoa -framework WebKit

[ -f mac/Phlox.icns ] || swift mac/icon.swift
cp mac/Phlox.icns "$APP/Contents/Resources/Phlox.icns"
cp server.js package.json "$APP/Contents/Resources/app/"
cp -R public "$APP/Contents/Resources/app/public"
[ -d node_modules ] && cp -R node_modules "$APP/Contents/Resources/app/node_modules"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Phlox</string>
  <key>CFBundleDisplayName</key><string>Phlox</string>
  <key>CFBundleIdentifier</key><string>local.phlox.app</string>
  <key>CFBundleExecutable</key><string>Phlox</string>
  <key>CFBundleIconFile</key><string>Phlox</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"
