const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const os = require('os'); // Add os module to get network interfaces

// Function to get local IP address
const getLocalIpAddress = () => {
  const interfaces = os.networkInterfaces();
  for (const ifname of Object.keys(interfaces)) {
    for (const iface of interfaces[ifname]) {
      // Skip over non-IPv4 and internal (loopback) addresses
      if (iface.family !== 'IPv4' || iface.internal) {
        continue;
      }
      return iface.address;
    }
  }
  return '127.0.0.1'; // Fallback to localhost
};

module.exports = {
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      filename: 'index.html'
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'assets', to: 'assets' }
      ]
    })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist')
    },
    compress: true,
    port: 8080,
    hot: true,
    host: '0.0.0.0', // Listen on all network interfaces
    client: {
      logging: 'info',
    },
    open: true,
    setupMiddlewares: (middlewares, devServer) => {
      // Display local IP when server starts
      const localIp = getLocalIpAddress();
      if (!devServer) {
        throw new Error('webpack-dev-server is not defined');
      }
      
      devServer.app.get('/ip', (_, response) => {
        response.json({ ip: localIp });
      });
      
      const originalSetupMiddlewares = devServer.app.locals.originalSetupMiddlewares || (() => middlewares);
      devServer.app.locals.originalSetupMiddlewares = originalSetupMiddlewares;
      
      console.log(`\n\n🎮 Game server running at:\n- Local: http://localhost:8080\n- Network: http://${localIp}:8080\n`);
      
      return middlewares;
    }
  },
  resolve: {
    extensions: ['.js']
  }
};