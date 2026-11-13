// Expo's default Metro config detects the npm-workspaces monorepo automatically (SDK 52+).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
