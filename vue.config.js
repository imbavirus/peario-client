const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');
const { version } = require('./package.json');

module.exports = defineConfig({
    configureWebpack: {
        resolve: {
            fallback: {
                stream: false,
                process: require.resolve('process/browser'),
                buffer: require.resolve('buffer/'),
                events: require.resolve('events'),
                querystring: require.resolve('querystring-es3'),
            }
        },
        plugins: [
            new webpack.ProvidePlugin({
                Buffer: ['buffer', 'Buffer'],
                process: 'process/browser',
            }),
            new webpack.DefinePlugin({
                'process.env.PACKAGE_VERSION': JSON.stringify(version),
            })
        ],
        devServer: {
            client: {
                overlay: false,
            },
            // Proxy Stremio streaming server to avoid CORS in development (HLS uses XHR/fetch).
            proxy: {
                '^/stremio': {
                    target: 'http://localhost:11470',
                    changeOrigin: true,
                    ws: true,
                    pathRewrite: { '^/stremio': '' },
                },
                // Proxy Stremio subtitle file host to avoid CORS in development.
                '^/subs': {
                    target: 'https://subs5.strem.io',
                    changeOrigin: true,
                    secure: true,
                    pathRewrite: { '^/subs': '' },
                },
                // Proxy Peario server HTTP endpoints in development (keeps requests same-origin).
                '^/peario': {
                    target: 'http://localhost:8181',
                    changeOrigin: true,
                    ws: false,
                    pathRewrite: { '^/peario': '' },
                },
            },
        },
    },
    css: {
        loaderOptions: {
            sass: {
                additionalData: `
                    @import "src/assets/styles/variables.scss";
                `
            }
        }
    },
    chainWebpack: config => {
        config.module
            .rule('vue')
            .use('vue-loader')
            .tap(options => ({
                ...options,
                compilerOptions: {
                    isCustomElement: (tag) => tag === 'ion-icon'
                }
            }));
    },
    transpileDependencies: [
        'vue-meta',
    ],
    productionSourceMap: false,
});