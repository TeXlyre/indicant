const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => ({
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: argv.mode === 'production' ? '/indicant/' : '/',
    clean: true
  },
  devServer: {
    static: { directory: path.join(__dirname, 'dist') },
    hot: true,
    port: 3000
  },
  module: {
    rules: [
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './src/index.html', filename: 'index.html' }),
    new CopyPlugin({
      patterns: [{ from: path.resolve(__dirname, '../../README.md'), to: 'README.md' }]
    }),
    new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, path.resolve(__dirname, 'src/empty-crypto.js'))
  ],
  resolve: {
    modules: ['node_modules', path.resolve(__dirname, '../../node_modules'), path.resolve(__dirname, '../..')],
    extensions: ['.js'],
    alias: { 'indicant': path.resolve(__dirname, '../../dist') }
  }
});
