# Запуск на Debian 13

Для Debian 13 предусмотрен запуск через Docker Compose из этого репозитория.
Node и Deno устанавливаются внутри образа; Windows-файлы запуска не нужны.
Контейнер собирайте на Linux: не переносите `node_modules` и `.deno-deploy`
с Windows. В контейнере используются Linux-версии нативных зависимостей SQLite.

Docker официально поддерживает Debian 13 (Trixie). Установите Docker Engine
и плагин Compose по [официальной инструкции для Debian](https://docs.docker.com/engine/install/debian/).

## Подготовка

```bash
git clone https://github.com/isbigguy/HoursBooster.git
cd HoursBooster
umask 077
cp example.env .env
openssl rand -base64 48
nano .env
```

Поместите сгенерированное значение в `BETTER_AUTH_SECRET`.
При переносе существующей базы сохраните прежний сильный ключ вместо генерации
нового: иначе сохранённые учётные данные не расшифруются. Перенос базы описан
в `SECURITY_CHANGES.ru.md` и README.

Выберите один режим:

- Для доступа через домен настройте все обязательные OIDC-поля из `example.env`,
  задайте HTTPS-адрес сервиса в `BETTER_AUTH_URL` и `ORIGIN`, настройте HTTPS
  reverse proxy на `127.0.0.1:8000`. Callback:
  `/api/auth/callback/<OIDC_PROVIDER_ID>`.
- Для личной проверки через SSH-туннель оставьте OIDC-поля пустыми,
  установите `ALLOW_ANONYMOUS=true`, `BETTER_AUTH_URL=http://localhost:8000`
  и `ORIGIN=http://localhost:8000`. Этот режим даёт общий локальный доступ.

## Запуск

```bash
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100
curl --fail http://127.0.0.1:8000/ -o /dev/null
```

В личном режиме откройте туннель с вашего компьютера, заменив `user@server`
на свой SSH-адрес:

```bash
ssh -L 8000:127.0.0.1:8000 user@server
```

Откройте `http://localhost:8000` в браузере. Порт 8000 на сервере публикуется
только на `127.0.0.1`; менять его на публичную привязку для SSH-туннеля не нужно.

База хранится в именованном Docker-томе `vaporbooster-data`, внутри контейнера —
в `/data/sqlite.db`. Миграции выполняются при запуске. Политика `unless-stopped`
перезапускает контейнер при работающем Docker; после перезагрузки сервера
Docker также должен запускаться автоматически. Сохраните резервные копии базы
и `.env` отдельно от публичного репозитория.

## Что проверено

Проверены исходники Linux-конфигурации, 22 автоматических теста, сборка приложения
и runtime-проверка Deno с CSS/JavaScript и живым QR-запросом Steam в Windows.
Docker Engine и Linux-среда на проверочном компьютере отсутствуют: сборка
контейнера и фактический запуск на Debian 13 пока не выполнены. Инструкция
не означает, что такой запуск уже проверен.
