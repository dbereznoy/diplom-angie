
```mermaid
graph TD;
    Client1[клиент 1] -->|HTTPS/WSS| Frontend;
    Client2[клиент 2] -->|HTTPS/WSS| Frontend;
    
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
Решение по балансировке нагрузки с указанием директив конфигурации.

upstream chat-upstream {
  server backend1:3000;
  server backend2:3000;
  zone chat-upstream 256k;
  least_conn;

  # Защита бэкендов
  keepalive 32;
  keepalive_requests 100;
  keepalive_timeout 60s;
}


### **3. Клиентская и серверная оптимизация (частично выполнено)**
- **Что сделано**:  
  - **Серверная**:  
    - Пулинг подключений к PostgreSQL и Redis.  
    - Использование JWT для быстрой аутентификации.  
  - **Клиентская**:  
    - Загрузка истории сообщений пачками (лимит 50).  
    - WebSocket вместо HTTP-опросов (long polling).  
- **Что добавить**:  
  - **Серверная**:  
    - Кеширование сообщений в Redis (например, топ-100).  
    - Сжатие ответов API (gzip).  
    ```nginx
    gzip on;
    gzip_types application/json;
    ```  
  - **Клиентская**:  
    - Ленивая загрузка изображений (если будут).  
    - Оптимизация WebSocket (переподключение с экспоненциальной задержкой).
