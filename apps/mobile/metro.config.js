const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");

// Expo's app lives in apps/mobile while shared workspace packages live at root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  "@ecochef/design-tokens": path.resolve(workspaceRoot, "packages/design-tokens/src"),
  "@ecochef/contracts": path.resolve(workspaceRoot, "packages/contracts/src"),
};

module.exports = config;
