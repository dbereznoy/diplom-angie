# Глобальные зоны для ограничений
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
limit_req_zone $binary_remote_addr zone=req_per_ip:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=ws_req_ip:10m rate=30r/s;

upstream chat-upstream {
  server backend1:3000;
  server backend2:3000;
  zone chat-upstream 256k;
  keepalive 32;
  keepalive_requests 100;
  keepalive_timeout 60s;
}

server {
    listen 443 ssl;
    server_name chat.zeleziaka.ru;
    status_zone chat-frontend;
    
    # SSL
    ssl_certificate /etc/letsencrypt/live/chat.zeleziaka.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.zeleziaka.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
   
    # Логирование
    access_log /var/log/angie/chat.zeleziaka.ru.access.log upstreamlog;
    error_log /var/log/angie/chat.zeleziaka.ru.error.log warn;

    ### anti DOS ###
    client_body_buffer_size 16k;
    client_header_buffer_size 4k;
    client_max_body_size 32k;  # Минимум для JSON-запросов
    
    # Защита от Slowloris
    client_body_timeout 5s;
    client_header_timeout 5s;
    keepalive_timeout 10s;
    send_timeout 5s;
    
    # Блокировка сканеров и ботов
    if ($http_user_agent ~* (wget|curl|nikto|sqlmap|zgrab|nmap|python-requests)) {
        return 444;  # Закрытие соединения без ответа
    }
    
    # Защита от сканирования
    location ~* ^/(\.git|\.env|backup) {
        deny all;
        return 403;
    }

    # Статика
    root /var/www/chat/static;
    location / {
        status_zone root_location;
        try_files $uri /index.html;        
        
        limit_req zone=req_per_ip burst=20 nodelay;
        limit_conn conn_per_ip 5;
    }

    ### WebSocket прокси ###
    location /ws {
        status_zone ws_endpoint;
        proxy_pass http://chat-upstream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Защита WebSocket
        limit_req zone=ws_req_ip burst=40 nodelay;
        limit_conn conn_per_ip 10;
        proxy_read_timeout 3600s;  # Долгий таймаут для WS
        
        # Защита от переполнения буфера
        proxy_buffer_size 16k;
        proxy_buffers 4 32k;
        proxy_busy_buffers_size 64k;
    }

    ### API эндпоинты ###
    location /api {
        status_zone api_endpoint;
        proxy_pass http://chat-upstream;
        proxy_set_header Host $host;
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Строгие лимиты для API
        limit_req zone=req_per_ip burst=5 nodelay;
        limit_conn conn_per_ip 3;
        
        # Кеширование ошибок
        proxy_cache_methods POST;
        proxy_cache_valid 200 10s;
        proxy_cache_valid 429 1m;
    }

    ### Health-check (без ограничений) ###
    location /api/health {
        proxy_pass http://chat-upstream;
        access_log off;
    }
}


