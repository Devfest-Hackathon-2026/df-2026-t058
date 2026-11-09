// 集中中は他のアプリを開けなくする（#300・Android だけ）の設定の差し込み。
// - 権限: 使用状況・他のアプリの上に重ねる・前面のサービス（specialUse）・通知
// - サービスの宣言（外から呼べない exported=false）
// - モルティーの絵を、重ねる画面用に res/drawable へ写す
// AccessibilityService は使わない（docs/android-focus-lock.md）。
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const PERMISSIONS = [
  'android.permission.PACKAGE_USAGE_STATS',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.POST_NOTIFICATIONS',
];
const SERVICE = 'expo.modules.focuslock.FocusLockService';
const MASCOT = path.join('assets', 'mascot', 'kangaebi.webp');

function withFocusLockService(config) {
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({
      $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': 'specialUse' },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': 'User-enabled focus timer that reminds the user to return while focusing',
          },
        },
      ],
    });
    return c;
  });
}

function withFocusLockMascot(config) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const from = path.join(c.modRequest.projectRoot, MASCOT);
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
      if (fs.existsSync(from)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(from, path.join(dir, 'focus_lock_mascot.webp'));
      }
      return c;
    },
  ]);
}

module.exports = function withFocusLock(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  config = withFocusLockService(config);
  return withFocusLockMascot(config);
};
module.exports.PERMISSIONS = PERMISSIONS;
