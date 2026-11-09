declare const require: (name: string) => any;
declare const __dirname: string;

// app.config.js が google-services.json の有無で googleServicesFile を出し分ける
function load(exists: boolean) {
  jest.resetModules();
  jest.doMock('fs', () => ({ existsSync: () => exists }));
  const config = require('../../app.config.js');
  jest.dontMock('fs');
  return config();
}

describe('app.config.js', () => {
  it('google-services.json が無ければ googleServicesFile を足さない', () => {
    const out = load(false);
    expect(out.expo.android.googleServicesFile).toBeUndefined();
    expect(out.expo.android.package).toBe('app.kangaetsuzukeru.devfest26');
  });

  it('google-services.json があれば googleServicesFile を足す', () => {
    const out = load(true);
    expect(out.expo.android.googleServicesFile).toBe('./google-services.json');
  });
});
