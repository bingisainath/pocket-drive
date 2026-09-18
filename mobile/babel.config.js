module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated 4's worklet transform (via react-native-worklets). Must be listed last.
  plugins: ['react-native-worklets/plugin'],
};
