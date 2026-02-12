const net = require('net');

const PORT = 5551;
const HOST = '127.0.0.1';
const TIMEOUT = 60000; // 60 seconds
const START_TIME = Date.now();

const tryConnect = () => {
  if (Date.now() - START_TIME > TIMEOUT) {
    console.error(`[waitForBackend] Timeout waiting for backend at ${HOST}:${PORT} after ${TIMEOUT}ms`);
    process.exit(1);
  }

  const socket = new net.Socket();
  
  socket.on('connect', () => {
    // console.log(`[waitForBackend] Backend is ready at ${HOST}:${PORT}`);
    socket.destroy();
    process.exit(0);
  });

  socket.on('error', () => {
    socket.destroy();
    // Wait 1 second before retrying
    setTimeout(tryConnect, 1000);
  });

  socket.connect(PORT, HOST);
};

// console.log(`[waitForBackend] Waiting for backend at ${HOST}:${PORT}...`);
tryConnect();
