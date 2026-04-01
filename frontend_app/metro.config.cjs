const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname, {
    // Enable CSS support for web
    isCSSEnabled: true,
});

module.exports = withNativeWind(config, { input: './app/globals.css' });
