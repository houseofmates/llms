module.exports = {
    content: [
        './index.html',
        './script.js',
        './electron/app/index.html',
        './electron/app/script.js'
    ],
    theme: {
        extend: {
            colors: {
                background: '#050505',
                primary: '#f5af12',
                secondary: '#25a1da'
            },
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
            }
        }
    },
    plugins: []
};
