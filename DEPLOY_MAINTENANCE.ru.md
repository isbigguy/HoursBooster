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

Перед обновлением сделайте **холодную копию** всех пяти томов и секретов.
На время копирования панель и бустинг остановятся. Выполняйте блок целиком;
при ошибке сначала устраните её, затем запустите `dc start`:

```bash
set -e
backup="$PWD/.private/backup-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$backup"
dc stop
for pair in vaporbooster:app keycloak:keycloak postgres:postgres proxy:proxy; do
  service=${pair%%:*}; target=${pair##*:}
  case "$service" in
    vaporbooster) source=/data ;; keycloak) source=/opt/keycloak/data ;;
    postgres) source=/var/lib/postgresql/data ;; proxy) source=/data ;;
  esac
  sudo docker cp -a "$(dc ps -aq "$service"):$source" "$backup/$target"
done
sudo docker cp -a "$(dc ps -aq proxy):/config" "$backup/proxy-config"
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
История чата в SQLite не ограничена по объёму — следите за диском (`df -h`).

Если установка не завершилась: `dc ps -a`, `dc logs --tail=50`. Для сертификатов проверьте
DNS only, обе A-записи и доступность 443 извне; для Keycloak — состояние postgres.
Не отключайте проверку TLS и не публикуйте журналы с секретами/URL callback.

Ссылки: [Keycloak и контейнеры](https://www.keycloak.org/server/containers),
[reverse proxy](https://www.keycloak.org/server/reverseproxy),
[временный администратор](https://www.keycloak.org/server/bootstrap-admin-recovery),
[ротация Docker](https://docs.docker.com/engine/logging/drivers/local/).
Linux CI проверяет контейнеры, HTTPS и реальный OIDC-вход на Ubuntu 24.04;
публичный ACME, DNS и ресурсы конкретного Debian-сервера проверяются при установке.
