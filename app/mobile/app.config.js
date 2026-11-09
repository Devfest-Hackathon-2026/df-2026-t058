// app.json を読み、./google-services.json がある時だけ FCM の設定を足す（無ければ CI・他の人のビルドも落ちない）
const fs = require('fs');
const base = require('./app.json');

module.exports = () => {
  const expo = { ...base.expo, android: { ...base.expo.android } };
  if (fs.existsSync('./google-services.json')) {
    expo.android.googleServicesFile = './google-services.json';
  }
  return { ...base, expo };
};
