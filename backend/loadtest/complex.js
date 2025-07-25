import { check, sleep } from 'k6';
import http from 'k6/http';
import ws from 'k6/ws';
import { Trend, Rate, Counter } from 'k6/metrics';

// Конфигурация
const BASE_URL = 'https://chat.zeleziaka.ru';
const WS_URL = 'wss://chat.zeleziaka.ru/ws';
const USERNAME = `user_${__VU}_${Date.now()}`;
const PASSWORD = 'test_password';

// Метрики
const loginTrend = new Trend('login_time');
const registerTrend = new Trend('register_time');
const wsConnectTrend = new Trend('ws_connect_time');
const messageTrend = new Trend('message_delivery_time');
const errorRate = new Rate('errors');
const successRate = new Rate('success');
const messagesSent = new Counter('messages_sent');

// Опции теста
export const options = {
  scenarios: {
    // Тестирование регистрации и логина
    auth_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 50 },  // Быстрое наращивание
        { duration: '1m', target: 50 },   // Стабильная нагрузка
        { duration: '30s', target: 0 },   // Снижение
      ],
      exec: 'authTest',
    },
    
    // Тестирование WebSocket соединений
    ws_connection: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 10,
      maxDuration: '5m',
      exec: 'wsConnectionTest',
      startTime: '30s', // Начинаем после теста авторизации
    },
    
    // Комплексная нагрузка (имитация реального использования)
    full_load: {
      executor: 'constant-vus',
      vus: 200,
      duration: '5m',
      exec: 'fullLoadTest',
      startTime: '2m', // Начинаем после других тестов
    },
    
    // Тест на предельную нагрузку
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: 500 },  // Быстрое наращивание
        { duration: '2m', target: 1000 }, // Максимальная нагрузка
        { duration: '30s', target: 0 },    // Снижение
      ],
      exec: 'stressTest',
      startTime: '8m', // Начинаем после других тестов
    },
  },
  thresholds: {
    'errors': ['rate<0.01'], // Менее 1% ошибок
    'login_time': ['p(95)<500'], // 95% запросов на логин быстрее 500мс
    'ws_connect_time': ['p(95)<1000'], // 95% WS соединений быстрее 1с
    'message_delivery_time': ['p(95)<300'], // 95% сообщений доставляются быстрее 300мс
  },
};

// Функции для тестирования

// Тест регистрации и логина
export function authTest() {
  // Регистрация
  let registerRes = http.post(`${BASE_URL}/api/register`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  check(registerRes, {
    'register success': (r) => r.status === 201,
  }) || errorRate.add(1);
  
  if (registerRes.status === 201) {
    registerTrend.add(registerRes.timings.duration);
    successRate.add(1);
  } else {
    errorRate.add(1);
  }
  
  // Логин
  let loginRes = http.post(`${BASE_URL}/api/login`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  check(loginRes, {
    'login success': (r) => r.status === 200,
    'got cookies': (r) => r.cookies.accessToken && r.cookies.refreshToken,
  }) || errorRate.add(1);
  
  if (loginRes.status === 200) {
    loginTrend.add(loginRes.timings.duration);
    successRate.add(1);
  } else {
    errorRate.add(1);
  }
  
  sleep(1);
}

// Тест WebSocket соединений
export function wsConnectionTest() {
  // Сначала логинимся, чтобы получить токен
  let loginRes = http.post(`${BASE_URL}/api/login`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginRes.status !== 200) {
    errorRate.add(1);
    return;
  }
  
  const cookies = {
    accessToken: loginRes.cookies.accessToken[0].value,
    refreshToken: loginRes.cookies.refreshToken[0].value,
  };
  
  // Устанавливаем WebSocket соединение
  const start = Date.now();
  const response = ws.connect(WS_URL, {
    headers: {
      Cookie: `accessToken=${cookies.accessToken}; refreshToken=${cookies.refreshToken}`,
    },
  }, (socket) => {
    socket.on('open', () => {
      wsConnectTrend.add(Date.now() - start);
      successRate.add(1);
      
      // Отправляем тестовое сообщение
      const message = {
        type: 'chat',
        message: `Hello from ${USERNAME}`,
      };
      
      const sendStart = Date.now();
      socket.send(JSON.stringify(message));
      messagesSent.add(1);
      
      // Ожидаем ответ (в реальном чате это будет broadcast от сервера)
      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'chat' && msg.from === USERNAME) {
            messageTrend.add(Date.now() - sendStart);
          }
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      });
    });
    
    socket.on('close', () => {
      // console.log('WebSocket disconnected');
    });
    
    socket.on('error', (e) => {
      console.error('WebSocket error:', e);
      errorRate.add(1);
    });
    
    // Держим соединение открытым некоторое время
    sleep(Math.random() * 10 + 5);
  });
  
  check(response, {
    'ws connection established': (r) => r && r.status === 101,
  }) || errorRate.add(1);
}

// Комплексная нагрузка (имитация реального использования)
export function fullLoadTest() {
  // Логинимся
  let loginRes = http.post(`${BASE_URL}/api/login`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginRes.status !== 200) {
    errorRate.add(1);
    return;
  }
  
  const cookies = {
    accessToken: loginRes.cookies.accessToken[0].value,
    refreshToken: loginRes.cookies.refreshToken[0].value,
  };
  
  // Устанавливаем WebSocket соединение
  const response = ws.connect(WS_URL, {
    headers: {
      Cookie: `accessToken=${cookies.accessToken}; refreshToken=${cookies.refreshToken}`,
    },
  }, (socket) => {
    socket.on('open', () => {
      successRate.add(1);
      
      // Периодически отправляем сообщения
      const interval = setInterval(() => {
        const message = {
          type: 'chat',
          message: `Message ${Math.floor(Math.random() * 1000)} from ${USERNAME}`,
        };
        
        const sendStart = Date.now();
        socket.send(JSON.stringify(message));
        messagesSent.add(1);
        
        // Ожидаем ответ
        const handler = (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'chat' && msg.message.includes(USERNAME)) {
              messageTrend.add(Date.now() - sendStart);
              socket.off('message', handler);
            }
          } catch (e) {
            console.error('Error parsing message:', e);
            socket.off('message', handler);
          }
        };
        
        socket.on('message', handler);
      }, Math.random() * 5000 + 1000); // От 1 до 6 секунд между сообщениями
      
      // Закрываем соединение через случайное время
      setTimeout(() => {
        clearInterval(interval);
        socket.close();
      }, Math.random() * 120000 + 30000); // От 30 до 150 секунд
    });
    
    socket.on('error', (e) => {
      console.error('WebSocket error:', e);
      errorRate.add(1);
    });
  });
  
  check(response, {
    'ws connection established': (r) => r && r.status === 101,
  }) || errorRate.add(1);
  
  sleep(Math.random() * 5 + 1);
}

// Тест на предельную нагрузку
export function stressTest() {
  // В стресс-тесте мы просто создаем много соединений и отправляем сообщения
  
  // Логинимся
  let loginRes = http.post(`${BASE_URL}/api/login`, JSON.stringify({
    username: USERNAME,
    password: PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (loginRes.status !== 200) {
    errorRate.add(1);
    return;
  }
  
  const cookies = {
    accessToken: loginRes.cookies.accessToken[0].value,
    refreshToken: loginRes.cookies.refreshToken[0].value,
  };
  
  // Устанавливаем WebSocket соединение
  const response = ws.connect(WS_URL, {
    headers: {
      Cookie: `accessToken=${cookies.accessToken}; refreshToken=${cookies.refreshToken}`,
    },
  }, (socket) => {
    socket.on('open', () => {
      successRate.add(1);
      
      // Отправляем 10 сообщений подряд с минимальной задержкой
      for (let i = 0; i < 10; i++) {
        const message = {
          type: 'chat',
          message: `Stress message ${i} from ${USERNAME}`,
        };
        
        const sendStart = Date.now();
        socket.send(JSON.stringify(message));
        messagesSent.add(1);
        
        // Ожидаем ответ
        const handler = (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'chat' && msg.message.includes(USERNAME)) {
              messageTrend.add(Date.now() - sendStart);
              socket.off('message', handler);
            }
          } catch (e) {
            console.error('Error parsing message:', e);
            socket.off('message', handler);
          }
        };
        
        socket.on('message', handler);
        sleep(0.1);
      }
      
      // Закрываем соединение
      socket.close();
    });
    
    socket.on('error', (e) => {
      console.error('WebSocket error:', e);
      errorRate.add(1);
    });
  });
  
  check(response, {
    'ws connection established': (r) => r && r.status === 101,
  }) || errorRate.add(1);
  
  sleep(Math.random() * 2 + 0.5);
}
