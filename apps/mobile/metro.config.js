// Expo's default Metro config detects the npm-workspaces monorepo automatically (SDK 52+).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// expo-sqlite's web build ships a .wasm file (used only for the browser preview of the app).
config.resolver.assetExts.push('wasm');

module.exports = config;
