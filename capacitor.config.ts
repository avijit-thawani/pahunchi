// Android/iOS app: the same React build (dist/) inside a native shell. `npm run android` rebuilds
// and copies it into android/; /api/* goes to the deployed site (src/lib/native.ts).

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Permanent once published: the Play Store / App Store identity. Also the sign-in deep link scheme.
  appId: 'com.avijitthawani.pahunchi',
  appName: 'Pahunchi',
  webDir: 'dist',
  android: {
    // keeps background location updates flowing past 5 minutes (background-geolocation docs)
    useLegacyBridge: true,
  },
}

export default config
