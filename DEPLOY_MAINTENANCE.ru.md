# HoursBooster: обслуживание Linux-установки

[Установка PostgreSQL, Keycloak и панели](DEPLOY_FULL_STACK.ru.md).

Все команды ниже выполняйте из каталога `HoursBooster`. В текущем Bash задайте сокращение
(после нового SSH-входа выполните его снова):

```bash
dc() { sudo docker compose --project-name hoursbooster --env-file .private/full-stack/compose.env -f deploy/full-stack/compose.yml "$@"; }
dc ps
dc logs --tail=50
dc restart
```

Перед обновлением сделайте **холодную копию** трёх рабочих томов, секретов и сертификатов.
На время копирования панель и бустинг остановятся. Выполняйте блок целиком;
при ошибке сначала устраните её, затем запустите `dc start`:

```bash
set -e
backup="$PWD/.private/backup-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$backup"
dc stop
for pair in vaporbooster:app keycloak:keycloak postgres:postgres; do
  service=${pair%%:*}; target=${pair##*:}
  case "$service" in
    vaporbooster) source=/data ;; keycloak) source=/opt/keycloak/data ;;
    postgres) source=/var/lib/postgresql/data ;;
  esac
  sudo docker cp -a "$(dc ps -aq "$service"):$source" "$backup/$target"
done
sudo cp -a certs/full-stack "$backup/certificates"
sudo cp -a .private/full-stack "$backup/private"
git rev-parse HEAD | sudo tee "$backup/revision.txt" >/dev/null
dc start
printf 'Копия: %s\n' "$backup"
```

Копия содержит пароли, CA и Steam-токены: храните её зашифрованной вне сервера.
Для восстановления физической PostgreSQL-копии нужны совместимые версия PostgreSQL
и архитектура; это не перенос между разными версиями. Не удаляйте рабочие тома.
Для планового переноса PostgreSQL между версиями используйте
[pg_dump/pg_restore](https://www.postgresql.org/docs/17/backup-dump.html).
Потеря `.private/full-stack/state.json` / `auth_secret` делает Steam-токены нечитаемыми.

Обновление после копии: `git pull --ff-only`, затем повторите команду установщика из шага 2.
Миграции SQLite выполняются автоматически. Настройки и секреты сохраняются;
существующий realm Keycloak не импортируется заново. Не меняйте домены/SteamID/секреты
редактированием случайных полей `state.json`: для существующей установки нужна миграция.
Этот комплект сам не переносит данные старой установки и не объединяет пользователей.

Раз в полгода продлевайте **внутренние** сертификаты (397 дней), сохраняя CA:

```bash
sudo python3 deploy/full-stack/setup.py --settings .private/full-stack/settings.env --renew-internal-tls
```

Не применяйте `down --volumes` к рабочему комплекту. Журналы автоматически ротируются:
до трёх файлов по 10 МБ на контейнер, старые удаляются; `dc logs` продолжает работать.
Для истории чата доступно [архивирование без потери сообщений](CHAT_ARCHIVE.ru.md):
сначала предпросмотр, затем явный перенос в проверенные gzip-файлы. Архивы сохраняются
бессрочно; следите за суммарным местом (`df -h`).

Выпуск и автоматическое продление публичного сертификата выполняет внешний Certbot.
После обновления скопируйте обе PEM-копии в `certs/full-stack/nginx` с правами из
инструкции установки. Затем выполните:

```bash
dc exec -T proxy nginx -t
dc exec -T proxy nginx -s reload
```

Перезагрузка должна выполняться только после успешного `nginx -t`.
Эти действия можно указать во внешнем deploy-hook Certbot; сам hook и настройки
DNS API в репозиторий не входят. Для копии сертификатов выберите момент, когда
внешний процесс продления не меняет PEM-файлы. При переносе проекта обновите
внешние пути копирования и hook.

При переходе со старого Caddy сначала сделайте копию по старой инструкции.
Сохраните старые тома `proxy-data`/`proxy-config`: новый комплект их не использует
и не удаляет. Пароли, OIDC realm и три тома данных сохраняются. Старый `SERVER_IP`
можно убрать из настроек без изменения секретов. CI использует временный
тестовый CA; публичные сертификаты и DNS API он не запрашивает.

Если установка не завершилась: `dc ps -a`, `dc logs --tail=50`. Для сертификатов проверьте
локальный DNS, файлы сертификата и цепочку; для Keycloak — состояние postgres.
Не отключайте проверку TLS и не публикуйте журналы с секретами/URL callback.

Ссылки: [nginx TLS](https://nginx.org/en/docs/http/ngx_http_ssl_module.html),
[reverse proxy](https://www.keycloak.org/server/reverseproxy),
[временный администратор](https://www.keycloak.org/server/bootstrap-admin-recovery),
[ротация Docker](https://docs.docker.com/engine/logging/drivers/local/).
Linux CI проверяет контейнеры, HTTPS и реальный OIDC-вход на Ubuntu 24.04;
публичный ACME, DNS и ресурсы конкретного Debian-сервера проверяются при установке.
