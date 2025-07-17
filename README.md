Вот красивый и структурированный вариант для вашего README.md в GitHub:

```markdown
# Архитектура чата и защита от DoS-атак

## Схема системы

```mermaid
graph TD;
    Client1[Клиент 1] -->|HTTPS/WSS| Frontend;
    Client2[Клиент 2] -->|HTTPS/WSS| Frontend;
    
    Frontend["Frontend (Angie)
    ▸ Балансировка нагрузки
    ▸ SSL/TLS termination
    ▸ Rate limiting"];
    
    Frontend -->|WebSocket| Backend1;
    Frontend -->|WebSocket| Backend2;
    
    Backend1["Backend 1 (Node.js)
    ▸ JWT-аутентификация
    ▸ Логика чата"];
    
    Backend2["Backend 2 (Node.js)
    ▸ JWT-аутентификация
    ▸ Логика чата"];
    
    Backend1 -->|SELECT/INSERT| Database;
    Backend2 -->|SELECT/INSERT| Database;
    
    Database[("Database (PostgreSQL)
    ▸ Пользователи
    ▸ Сессии
    ▸ История сообщений")];
    
    style Frontend fill:#4CAF50,color:white
    style Backend1 fill:#2196F3,color:white
    style Backend2 fill:#2196F3,color:white
    style Database fill:#FF9800,color:white
```

## Балансировка нагрузки

```nginx
upstream chat-upstream {
  server backend1:3000;
  server backend2:3000;
  zone chat-upstream 256k;
  least_conn;

  # Оптимизация подключений
  keepalive 32;
  keepalive_requests 100;
  keepalive_timeout 60s;
}
```

**Параметры:**
- `least_conn` - балансировка по наименьшему числу соединений
- `keepalive` - пул постоянных соединений к бэкендам
- `zone` - разделяемая память для статистики

## Оптимизации

### Серверная
- Пулинг подключений к PostgreSQL и Redis
- JWT для быстрой аутентификации
- Кластеризация Node.js процессов

### Клиентская
- Пакетная загрузка истории сообщений (лимит 50)
- Оптимизированные WebSocket-фреймы
- Кеширование статики

## Защита от DoS-атак

### 1. Транспортный уровень
```nginx
client_body_buffer_size 16k;
client_header_buffer_size 4k;
client_max_body_size 32k;

# Таймауты против Slowloris
client_body_timeout 5s;
client_header_timeout 5s;
keepalive_timeout 10s;
send_timeout 5s;
```

### 2. Лимиты запросов
```nginx
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
limit_req_zone $binary_remote_addr zone=req_per_ip:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=ws_req_ip:10m rate=30r/s;

# Для WebSocket
limit_req zone=ws_req_ip burst=40 nodelay;
limit_conn conn_per_ip 10;
```

### 3. Фильтрация угроз
```nginx
# Блокировка сканеров
if ($http_user_agent ~* (bot|crawler|scan|nikto|sqlmap)) {
    return 444;
}

# Защита служебных путей
location ~* ^/(\.git|\.env|backup) {
    deny all;
    return 403;
}
```

### 4. WebSocket защита
```nginx
proxy_websocket_max_frame_size 32k;
proxy_websocket_keepalive_timeout 60s;
proxy_read_timeout 3600s;
```

## Мониторинг
Рекомендуется настроить:
- Логирование аномальных запросов
- Grafana дашборд с метриками Angie
- Автоматическую блокировку IP через Fail2Ban
```

Этот вариант:
1. Имеет четкую визуальную структуру
2. Содержит подсветку кода для конфигов
3. Разделен на логические блоки
4. Использует Mermaid для наглядной схемы
5. Сохраняет цветовое кодирование компонентов

Вы можете дополнить его реальными метриками из вашей системы или добавить раздел с deployment инструкциями.
