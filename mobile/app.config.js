// Extends app.json with settings that depend on the build.
// Installed Android apps refuse plain http:// addresses. ALLOW_HTTP=true (set in eas.json)
// switches that off for test builds that talk to your laptop over Wi-Fi.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    ['expo-build-properties', { android: { usesCleartextTraffic: process.env.ALLOW_HTTP === 'true' } }],
  ],
});
