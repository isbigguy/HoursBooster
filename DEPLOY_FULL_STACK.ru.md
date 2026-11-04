# HoursBooster: установка на Linux с PostgreSQL и Keycloak

Для **нового Debian 13** с `sudo`, публичным IPv4 и двумя поддоменами.
Другие Linux подходят для контейнеров, но команды установки Docker ниже — для Debian.
Практический стартовый запас: 2 vCPU, 4 ГБ RAM, 20 ГБ свободного диска;
это рекомендация, а не измеренный минимум. Node, Deno, Java и PostgreSQL на хост ставить не нужно.

Комплект устанавливает **Caddy → HoursBooster / Keycloak → PostgreSQL**.
HoursBooster хранит аккаунты в **SQLite**, PostgreSQL нужен **Keycloak**.
Пароли, БД `keycloak`, роль `keycloak`, realm `hours`, OIDC-клиент `hoursbooster`
и пользователь `operator` создаются автоматически. Вручную SQL и OIDC-секреты вводить не нужно.
Снаружи открыт только HTTPS, TCP 443; внутренние соединения тоже проверяют TLS.

## 1. Сервер и DNS

В панели вашего DNS-провайдера создайте две **A-записи**: `hours.ВАШ-ДОМЕН`
и `auth.ВАШ-ДОМЕН` → публичный IPv4 сервера из панели хостинга.
Удалите для этих имён AAAA и лишние A, отключите CDN-проксирование (DNS only).
В firewall хостинга/роутера разрешите входящий **TCP 443**, сохраните доступ по SSH.
Порт 443 должен быть свободен; TCP 80 не требуется. Открывать 5432/8080/8443 нельзя.
Исходящий доступ к DNS, HTTPS, реестрам контейнеров, Steam и Let's Encrypt необходим.
Docker публикует порты в обход некоторых правил UFW; ограничение у хостинга надёжнее.

На свежем Debian установите инструменты и Docker из официального APT-репозитория:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git python3 openssl nano less
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

Если Docker уже установлен, достаточно проверить последнюю команду.
Не удаляйте пакеты/данные существующего Docker вслепую; при конфликте пакетов используйте
[официальную инструкцию Debian](https://docs.docker.com/engine/install/debian/).

## 2. Пять своих значений и запуск

```bash
git clone https://github.com/isbigguy/HoursBooster.git
cd HoursBooster
umask 077
mkdir -p .private/full-stack
cp deploy/full-stack/settings.example.env .private/full-stack/settings.env
nano .private/full-stack/settings.env
```

Замените значения в файле (без кавычек, пробелов и комментариев после значения):

```dotenv
HOURS_DOMAIN=hours.example.com
AUTH_DOMAIN=auth.example.com
SERVER_IP=203.0.113.10
ACME_EMAIL=admin@example.com
STEAM_ALLOWED_IDS=76561198000000001
EDGE_SUBNET=172.28.0.0/24
```

- `HOURS_DOMAIN` / `AUTH_DOMAIN`: ваши два DNS-имени **без** `https://`, пути и порта.
- `SERVER_IP`: публичный IPv4 сервера. `ACME_EMAIL`: ваша рабочая почта для Let's Encrypt.
- `STEAM_ALLOWED_IDS`: ваши SteamID64, 17 цифр, несколько — через запятую без пробелов.
  В Steam откройте свой профиль → «Редактировать профиль» → «Основное»:
  очистите поле «Личная ссылка», сохраните и откройте профиль; число в адресе
  `steamcommunity.com/profiles/ЧИСЛО` — SteamID64. Свою личную ссылку можно вернуть.
- `EDGE_SUBNET`: оставьте как есть; при пересечении с LAN/VPN/Docker выберите свободную
  частную подсеть `/24`, например `172.29.0.0/24`.

В nano: `Ctrl+O`, Enter, `Ctrl+X`. Затем:

```bash
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env
```

Первая сборка занимает несколько минут. Установщик проверит DNS, создаст секреты
и сертификаты, запустит четыре сервиса и дождётся HTTPS панели и Keycloak.
Caddy сам получает и продлевает публичные сертификаты Let's Encrypt через TCP 443.
Внутренний CA не нужно устанавливать на ваш компьютер. Не используйте `--test` на сервере.

## 3. Первый вход и администратор Keycloak

```bash
sudo less .private/full-stack/credentials.txt
```

Файл содержит **два разных пароля**. `q` закрывает просмотр; никому их не отправляйте.

1. Откройте `https://ВАШ-HOURS_DOMAIN`, нажмите Keycloak, войдите как **operator**
   с первым паролем. Это обычный пользователь панели.
2. Смените его пароль: `https://ВАШ-AUTH_DOMAIN/realms/hours/account/` →
   **Account security → Signing in → Password → Update**.
3. Откройте `https://ВАШ-AUTH_DOMAIN/admin/`, войдите как **bootstrap-admin** со вторым
   паролем. В левом верхнем переключателе выберите realm **master**.
4. **Users → Add user**: заполните Username, Email, First name, Last name,
   включите Enabled и нажмите Create.
   На вкладке **Credentials → Set password** задайте уникальный пароль,
   отключите Temporary и сохраните. **Role mapping → Assign role → Filter by realm roles**:
   выберите **admin**, нажмите Assign.
5. В отдельном приватном окне проверьте вход новым администратором в `/admin/`.
   Только после успешной проверки удалите `bootstrap-admin` через **master → Users → Delete**.
   Пароли работающего Keycloak меняют здесь, а не в `state.json`.

Для нового пользователя панели: **realm hours → Users → Add user**, укажите Username,
Email, First name и Last name, включите Enabled и Email verified только для проверенного
вами адреса; затем **Credentials → Set password**. Temporary можно включить для смены
при первом входе. Роль `admin` ему не нужна; публичная регистрация закрыта.

Steam-вход необязателен для работы через Keycloak, но allowlist нужен установщику.
Чтобы оба способа открывали один профиль: сначала войдите через Keycloak →
**Link Steam sign-in** → подтвердите на сайте Steam. Отдельный первый вход через Steam
создаёт другой профиль. Steam Web API key не нужен. Аккаунты для бустинга добавляются
отдельно внутри панели паролем/Steam Guard или QR.

## 4. После установки

Команды проверки, резервного копирования, обновления и продления внутренних
сертификатов: [обслуживание](DEPLOY_MAINTENANCE.ru.md). Сохраните эту инструкцию.
