## Графическая схема взаимодействия элементов приложения.

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

## Решение по балансировке нагрузки с указанием директив конфигурации
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

## Элементы клиентской и серверной оптимизации с обоснованием и директивами конфигурации.

### Серверная
- Пулинг подключений к PostgreSQL и Redis
- JWT для быстрой аутентификации

### Клиентская
- Пакетная загрузка истории сообщений (лимит 50)
- Кеширование статики

## Защита от DoS-атак

### 1. Таймауты против Slowloris
```nginx
client_body_timeout 5s;
client_header_timeout 5s;
keepalive_timeout 10s;
send_timeout 5s;
```
client_header_timeout 5s — ограничивает время ожидания полной отправки заголовков клиентом не более 5 секунд. Если клиент слишком медленно присылает заголовки, соединение закрывается. Это предотвращает зависание соединений на этапе получения HTTP заголовков, типичное для Slowloris.

client_body_timeout 5s — ограничивает время ожидания отправки тела запроса (например, POST данных) клиентом также не более 5 секунд между пакетами данных. Если данные идут слишком медленно, соединение прерывается, что снижает возможность удерживать соединение открытым длительное время.

send_timeout 5s — определяет максимальное время, в течение которого сервер пытается отправлять данные клиенту, ожидая получения подтверждения. Если клиент задерживает чтение данных более 5 секунд, сервер закрывает соединение. Это предотвращает зависание соединения на стороне сервера при медленном получателе.

keepalive_timeout 10s — указывает, сколько времени сервер будет поддерживать открытое неактивное соединение после завершения предыдущего запроса. Если клиент не использует соединение и задерживается дольше 10 секунд, оно закрывается. Это позволяет быстро освобождать ресурсы от "висящих" соединений.

### 2. Лимиты запросов
```nginx
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
limit_req_zone $binary_remote_addr zone=req_per_ip:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=ws_req_ip:10m rate=30r/s;

# Для WebSocket
limit_req zone=ws_req_ip burst=40 nodelay;
limit_conn conn_per_ip 10;
```
Настройка	Тип трафика	Лимит	burst	Назначение
limit_conn_zone + conn_per_ip	TCP/WS	10 соединений/IP	–	Защита от перегрузки соединений
limit_req_zone + req_per_ip	HTTP	10 запросов/сек/IP	20	Защита REST API
limit_req_zone + ws_req_ip	WebSocket	30 сообщений/сек/IP	40	Безопасность чата без лагов

| Настройка                     | Тип трафика   | Лимит             | burst | Назначение                      |
|------------------------------|---------------|-------------------|-------|--------------------------------|
| limit_conn_zone + conn_per_ip | TCP/WS        | 10 соединений/IP  | –     | Защита от перегрузки соединений |
| limit_req_zone + req_per_ip   | HTTP          | 10 запросов/сек/IP| 20    | Защита REST API                |
| limit_req_zone + ws_req_ip    | WebSocket     | 30 сообщений/сек/IP| 40    | Безопасность чата без лагов    |


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


