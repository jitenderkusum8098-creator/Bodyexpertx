import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bodyexpertx.customer',
  appName: 'BodyExpertX Customer',
  webDir: 'www',
  server: { url: 'https://jitenderkusum8098-creator.github.io/Bodyexpertx/massage.html', cleartext: false, androidScheme: 'https' },
  android: { allowMixedContent: false }
};
export default config;
