require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const url = require('url');
const cookie = require('cookie');
const { createClient } = require('redis');

// Конфигурация
const PORT = process.env.PORT || 3000;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'your-access-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

// Подключение к БД PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'chat_admin',
  host: process.env.DB_HOST || '10.129.0.23',
  database: process.env.DB_NAME || 'chat_app',
  password: process.env.DB_PASSWORD || 'your_strong_password',
  port: process.env.DB_PORT || 5432,
});

// Подключение к Redis
const redisOptions = {
  socket: {
    host: process.env.REDIS_HOST || 'db',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 100, 5000);
      console.log(`Retrying Redis connection in ${delay}ms...`);
      return delay;
    },
    connectTimeout: 10000
  },
  password: process.env.REDIS_PASSWORD || 'your_strong_password'
};

// Создаем Redis клиенты
const redisClient = createClient(redisOptions);
const redisPublisher = createClient(redisOptions);
const redisSubscriber = createClient(redisOptions);

// Настройка обработчиков событий Redis
function setupRedisHandlers(client, name) {
  client.on('error', (err) => {
    console.error(`Redis ${name} error:`, err);
  });

  client.on('connect', () => {
    console.log(`Redis ${name} connected`);
  });

  client.on('reconnecting', () => {
    console.log(`Redis ${name} reconnecting`);
  });

  client.on('ready', () => {
    console.log(`Redis ${name} ready`);
  });
}

setupRedisHandlers(redisClient, 'Client');
setupRedisHandlers(redisPublisher, 'Publisher');
setupRedisHandlers(redisSubscriber, 'Subscriber');

// HTTP сервер
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', 'https://chat.zeleziaka.ru');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (pathname === '/api/login' && req.method === 'POST') {
      await handleLogin(req, res);
    } else if (pathname === '/api/register' && req.method === 'POST') {
      await handleRegister(req, res);
    } else if (pathname === '/api/refresh' && req.method === 'POST') {
      await handleRefreshToken(req, res);
    } else if (pathname === '/api/messages' && req.method === 'GET') {
      await handleGetMessages(req, res);
    } else if (pathname === '/api/health' && req.method === 'GET') {
      await handleHealthCheck(req, res);
    } else {
      sendResponse(res, 404, { error: 'Not Found' });
    }
  } catch (error) {
    console.error('Server error:', error);
    sendResponse(res, 500, { error: 'Internal Server Error' });
  }
});

// WebSocket сервер
const wss = new WebSocket.Server({ server });
const clients = new Map();

// Инициализация Redis
async function initializeRedis() {
  try {
    console.log('Connecting to Redis...');

    await Promise.all([
      redisClient.connect(),
      redisPublisher.connect(),
      redisSubscriber.connect()
    ]);

    console.log('All Redis connections established');

    // Подписка на канал
    await redisSubscriber.subscribe('chat_messages', (message, channel) => {
      console.log(`Received message from channel ${channel}`);
      try {
        const parsedMessage = JSON.parse(message);
        broadcastLocally(parsedMessage);
      } catch (err) {
        console.error('Error parsing Redis message:', err);
      }
    });

    console.log('Successfully subscribed to chat_messages channel');

    return true;
  } catch (err) {
    console.error('Redis initialization failed:', err);
    return false;
  }
}

wss.on('connection', async (ws, req) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies.accessToken;

  if (!token) {
    ws.close(4001, 'No token provided');
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [decoded.userId]);

    if (rows.length === 0) {
      ws.close(4001, 'User not found');
      return;
    }

    const user = rows[0];
    clients.set(ws, { userId: user.id, username: user.username });

    console.log(`User connected: ${user.username}`);

    // Отправляем историю сообщений
    const { rows: messages } = await pool.query(
      `SELECT m.id, m.text, m.created_at, u.username
       FROM messages m JOIN users u ON m.user_id = u.id
       ORDER BY m.created_at DESC LIMIT 50`
    );

    ws.send(JSON.stringify({
      type: 'history',
      messages: messages.reverse()
    }));

    // Оповещаем других пользователей о новом подключении через Redis
    const systemMessage = {
      type: 'system',
      message: `${user.username} joined the chat`,
      timestamp: new Date().toISOString(),
      serverId: process.pid
    };

    await redisPublisher.publish('chat_messages', JSON.stringify(systemMessage));
    console.log('Published join message to Redis');

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'chat' && msg.message.trim()) {
          // Сохраняем сообщение в БД
          const { rows } = await pool.query(
            'INSERT INTO messages (user_id, text) VALUES ($1, $2) RETURNING id, created_at',
            [user.id, msg.message.trim()]
          );

          // Отправляем сообщение через Redis
          const chatMessage = {
            type: 'chat',
            from: user.username,
            message: msg.message,
            timestamp: rows[0].created_at.toISOString(),
            serverId: process.pid
          };

          await redisPublisher.publish('chat_messages', JSON.stringify(chatMessage));
          console.log('Published chat message to Redis');
        }
      } catch (e) {
        console.error('Message error:', e);
      }
    });

    ws.on('close', async () => {
      if (clients.has(ws)) {
        const { username } = clients.get(ws);
        clients.delete(ws);

        // Оповещаем о выходе пользователя через Redis
        const systemMessage = {
          type: 'system',
          message: `${username} left the chat`,
          timestamp: new Date().toISOString(),
          serverId: process.pid
        };

        await redisPublisher.publish('chat_messages', JSON.stringify(systemMessage));
        console.log('Published leave message to Redis');
      }
    });

  } catch (err) {
    console.error('WS connection error:', err);
    ws.close(4001, 'Invalid token');
  }
});

// Обработчики эндпоинтов
async function handleLogin(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const { username, password } = JSON.parse(body);

      if (!username || !password) {
        return sendResponse(res, 400, { error: 'Username and password are required' });
      }

      const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

      if (rows.length === 0 || !bcrypt.compareSync(password, rows[0].password_hash)) {
        return sendResponse(res, 401, { error: 'Invalid credentials' });
      }

      const user = rows[0];
      const tokens = generateTokens(user);

      setAuthCookies(res, tokens);
      sendResponse(res, 200, {
        userId: user.id,
        username: user.username
      });

    } catch (e) {
      sendResponse(res, 400, { error: 'Bad request' });
    }
  });
}

async function handleRegister(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', async () => {
    try {
      const { username, password } = JSON.parse(body);

      if (!username || !password) {
        return sendResponse(res, 400, { error: 'Username and password required' });
      }

      const hashedPassword = bcrypt.hashSync(password, 10);
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, hashedPassword]
      );

      const user = rows[0];
      const tokens = generateTokens(user);

      setAuthCookies(res, tokens);
      sendResponse(res, 201, {
        userId: user.id,
        username: user.username
      });

    } catch (e) {
      if (e.code === '23505') {
        sendResponse(res, 409, { error: 'Username already exists' });
      } else {
        console.error('Registration error:', e);
        sendResponse(res, 500, { error: 'Internal server error' });
      }
    }
  });
}

async function handleRefreshToken(req, res) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const refreshToken = cookies.refreshToken;

  if (!refreshToken) {
    return sendResponse(res, 401, { error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [decoded.userId]);

    if (rows.length === 0) {
      return sendResponse(res, 401, { error: 'User not found' });
    }

    const user = rows[0];
    const newAccessToken = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_ACCESS_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    );

    res.setHeader('Set-Cookie',
      `accessToken=${newAccessToken}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax; Secure`
    );

    sendResponse(res, 200, { accessToken: newAccessToken });

  } catch (err) {
    sendResponse(res, 401, { error: 'Invalid refresh token' });
  }
}

async function handleGetMessages(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.text, m.created_at, u.username
       FROM messages m JOIN users u ON m.user_id = u.id
       ORDER BY m.created_at DESC LIMIT 50`
    );

    sendResponse(res, 200, { messages: rows.reverse() });
  } catch (error) {
    console.error('Get messages error:', error);
    sendResponse(res, 500, { error: 'Failed to get messages' });
  }
}

// Новый обработчик health check
async function handleHealthCheck(req, res) {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown',
      websocket: 'unknown'
    }
  };

  try {
    // Проверка PostgreSQL
    await pool.query('SELECT 1');
    healthCheck.services.database = 'ok';
  } catch (err) {
    healthCheck.services.database = 'error';
    healthCheck.status = 'degraded';
    console.error('Database health check failed:', err);
  }

  try {
    // Проверка Redis
    await Promise.all([
      redisClient.ping(),
      redisPublisher.ping(),
      redisSubscriber.ping()
    ]);
    healthCheck.services.redis = 'ok';
  } catch (err) {
    healthCheck.services.redis = 'error';
    healthCheck.status = 'degraded';
    console.error('Redis health check failed:', err);
  }

  // Проверка WebSocket
  healthCheck.services.websocket = wss.clients.size >= 0 ? 'ok' : 'error';

  // Если хотя бы одна служба не работает, меняем общий статус
  if (Object.values(healthCheck.services).some(s => s === 'error')) {
    healthCheck.status = 'unhealthy';
  }

  sendResponse(res, healthCheck.status === 'ok' ? 200 : 503, healthCheck);
}
// Вспомогательные функции
function generateTokens(user) {
  return {
    accessToken: jwt.sign(
      { userId: user.id, username: user.username },
      JWT_ACCESS_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    ),
    refreshToken: jwt.sign(
      { userId: user.id },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    )
  };
}

function setAuthCookies(res, tokens) {
  res.setHeader('Set-Cookie', [
    `accessToken=${tokens.accessToken}; HttpOnly; Path=/; Max-Age=900; SameSite=Lax; Secure`,
    `refreshToken=${tokens.refreshToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax; Secure`
  ]);
}

function sendResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Credentials': 'true'
  });
  res.end(JSON.stringify(data));
}

function broadcastLocally(data, excludeWs = null) {
  const message = JSON.stringify(data);
  clients.forEach((_, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}


// Запуск сервера
async function startServer() {
  try {
    const redisInitialized = await initializeRedis();
    if (!redisInitialized) {
      throw new Error('Failed to initialize Redis');
    }

    server.listen(PORT, () => {
      console.log(`Server (PID ${process.pid}) running on port ${PORT}`);
      console.log(`WebSocket available at ws://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Server startup failed:', err);
    process.exit(1);
  }
}

startServer();

// Обработка завершения работы
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');

  try {
    await Promise.all([
      redisClient.quit(),
      redisPublisher.quit(),
      redisSubscriber.quit(),
      pool.end()
    ]);

    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
});
