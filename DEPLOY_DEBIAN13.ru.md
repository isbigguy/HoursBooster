# v0.0.3: HTTPS на Debian 13

Сервис принимает только HTTPS. В контейнере Deno сам завершает TLS на порту 8443;
Compose публикует его как 443. HTTP-порты 80 и 8000 не открываются, перенаправления
с HTTP нет. Без сертификата, читаемого приватного ключа и HTTPS-настроек запуск
завершается ошибкой. Windows-скрипты для Debian не нужны.

## Подготовка

Установите Docker Engine и Compose по
[официальной инструкции для Debian](https://docs.docker.com/engine/install/debian/).
В команде клонирования замените `<OWNER>` владельцем репозитория.

```bash
git clone "https://github.com/<OWNER>/HoursBooster.git"
cd HoursBooster
umask 077
cp example.env .env
openssl rand -base64 48
nano .env
```

Впишите сгенерированное значение в `BETTER_AUTH_SECRET`. При переносе существующей
базы сохраните прежний сильный ключ: иначе старые учётные данные не расшифруются.

Замените `hours.example.com` своим доменом в обоих полях:

```dotenv
BETTER_AUTH_URL=https://hours.example.com
ORIGIN=https://hours.example.com
ALLOW_ANONYMOUS=false
HTTPS_BIND_IP=0.0.0.0
```

Настройте четыре обязательных OIDC-параметра из `example.env`. Callback провайдера:
`https://hours.example.com/api/auth/callback/<OIDC_PROVIDER_ID>`.
Имя провайдера необязательно. `ORIGIN` и `BETTER_AUTH_URL` должны обозначать один
HTTPS-адрес без пути, логина, query и fragment.

По умолчанию `HTTPS_BIND_IP=127.0.0.1`: публичного доступа нет. Для публичного
развёртывания с OIDC установите `0.0.0.0` и направьте DNS своего домена на сервер.
Анонимный режим оставляйте только для личного экземпляра с локальной привязкой.

## Сертификат

Получите действующий сертификат для своего домена у доверенного центра
сертификации. Например, используйте ACME с DNS-проверкой: она не требует
HTTP-слушателя сервиса. Сам домен из примера не выдаёт сертификат автоматически.

Compose ожидает `certs/fullchain.pem` и `certs/privkey.pem`, либо те же имена
в каталоге `TLS_CERTS_DIR`. Приватный ключ не должен быть общедоступным.
В закреплённом Debian-образе Deno пользователь `deno` имеет UID/GID 1993.
Для обычного rootful Docker подготовьте доступ к файлам, заменив `/path/to/...`
на реальные исходные пути:

```bash
sudo install -d -m 0750 -o 1993 -g 1993 certs
sudo install -m 0644 -o 1993 -g 1993 /path/to/fullchain.pem certs/fullchain.pem
sudo install -m 0600 -o 1993 -g 1993 /path/to/privkey.pem certs/privkey.pem
```

При rootless Docker учтите отображение UID хоста в контейнер. Не ослабляйте права
приватного ключа до чтения всеми пользователями. Каталог монтируется только для
чтения, ключ не копируется в образ и исключён из Git и build context.
После обновления файлов сертификата перезапустите контейнер, чтобы загрузить их
в память. Для продления автоматизируйте эту операцию в используемом ACME-клиенте.

## Запуск

```bash
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100
```

Откройте `https://ВАШ-ДОМЕН`. Проверьте с сервера, подставив свой домен:

```bash
curl --fail --resolve hours.example.com:443:127.0.0.1 https://hours.example.com/ -o /dev/null
```

Не используйте `curl -k` и не отключайте проверку сертификатов. Для локальной
установки применяйте сертификат, которому доверяет ваш клиент, и совпадающий
HTTPS-адрес, включая порт. Для доверенного внутреннего CA настройте доверие
к нему у клиента самостоятельно.

База остаётся в Docker-томе `vaporbooster-data` (`/data/sqlite.db` внутри
контейнера). Миграции выполняются при запуске. `unless-stopped` сохраняет работу
контейнера при работающем Docker. Сохраните резервные копии базы и `.env`.
Собирать образ нужно на Linux; не переносите Windows `node_modules`.

## Проверки

`pnpm test` проверяет безопасность и Steam-клиент без реальных паролей.
`pnpm build` удаляет сгенерированный адаптером HTTP-launcher.
`pnpm test:runtime` требует Node 24, Deno и OpenSSL: он создаёт временный
сертификат, доверенный только тестовому клиенту, запускает отдельный HTTPS-сервис
и проверяет интерфейс, cookies, отказы HTTP/неверного сертификата и приватные пути.
`LIVE_STEAM=1 pnpm test:runtime` дополнительно проверяет QR start/poll/cancel.

Сборка Docker-образа и запуск на Debian 13 пока не проверены.
