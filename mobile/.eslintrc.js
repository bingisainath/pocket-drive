module.exports = {
  root: true,
  extends: '@react-native',
  // Native projects hold generated build output (e.g. Gradle test reports), not source we lint.
  ignorePatterns: ['android/', 'ios/'],
};
