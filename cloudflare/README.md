# Cloudflare Workers + D1

Рабочий сайт: https://finance-tracker.alekseip2002.workers.dev
База уже создана, ID и аккаунт сохранены в `wrangler.jsonc`. Для этого проекта не повторять создание базы из раздела первого деплоя.

Самостоятельный Worker со статическими файлами, без ChatGPT Sites.
`worker.mjs` использует D1 и совместимый с локальным сервером HTTP API. Scrypt, хеши сессий, Secure/HttpOnly cookies; операции бюджета сохраняются с атомарной проверкой ревизии. Регистрация разрешена только с кодом приглашения из секрета `REGISTRATION_CODE`. Без секрета регистрация закрыта.

## Первый деплой

1. `npx wrangler login` — подтвердить вход в браузере.
2. `npx wrangler whoami` — проверить аккаунт. Если аккаунтов несколько, указать правильный `account_id` в `wrangler.jsonc`.
3. `npx wrangler d1 create finance-tracker` — один раз. Заменить нулевой `database_id` в `wrangler.jsonc` на полученный ID. Не создавать повторно, если БД уже есть.
4. `npx wrangler d1 migrations apply finance-tracker --remote`.
5. `npx wrangler deploy` — публикует приложение с закрытой регистрацией.
6. `npx wrangler secret put REGISTRATION_CODE` — в скрытом приглашении ввести собственный случайный код. Не записывать его в Git.
7. Открыть возвращённый `workers.dev` URL и зарегистрировать свой аккаунт с этим кодом, логином и паролем. Код нужен только для создания аккаунтов. Затем его можно удалить: `npx wrangler secret delete REGISTRATION_CODE`.

Локальные записи не загружаются автоматически: скачать JSON в локальном интерфейсе и импортировать в новый пустой аккаунт на сайте. Не публиковать локальную SQLite и тестовые данные.

## Следующие обновления

```powershell
git pull
npm ci
node tests/parity.mjs
npx wrangler deploy --dry-run
npx wrangler d1 migrations apply finance-tracker --remote
npx wrangler deploy
```

## Локальная проверка Worker

Создать игнорируемый файл `.dev.vars` с тестовым `REGISTRATION_CODE="local-test-invitation"`. Этот код используется только тестами и не должен становиться production-секретом.

```powershell
npx wrangler d1 migrations apply finance-tracker --local
npx wrangler dev --local
```

В другом терминале: `node tests/worker.mjs`. Тест создаёт два новых аккаунта только в локальной D1 и проверяет регистрацию, сессии, изоляцию и конфликт одновременных изменений. Не запускать этот тест против production.

## Если вход завершается UND_ERR_CONNECT_TIMEOUT

Wrangler может не использовать системный прокси Windows автоматически. Если в Windows включён HTTP-прокси `127.0.0.1:10809`, перед командами Wrangler в той же сессии PowerShell задайте:

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:10809'
$env:HTTP_PROXY='http://127.0.0.1:10809'
$env:NO_PROXY='localhost,127.0.0.1,::1'
npx wrangler login
```

Порт должен соответствовать реально работающему прокси. Эти настройки действуют только в текущем терминале и не меняют систему.

Первичный код приглашения хранится в локальном игнорируемом `data/registration-code.txt`. Не коммитить файл. `python tools/set_invitation.py` передаёт этот код в секрет Cloudflare через stdin. После регистрации владельца код можно отключить командой `npx wrangler secret delete REGISTRATION_CODE`; вход существующих пользователей продолжит работать.

Бюджет хранится единым JSON на аккаунт с ограничением 1.8 MB (до лимита значения D1). Это сохраняет атомарность переноса между месяцами; интерфейс предложит экспорт при достижении ограничения. Для больших архивов потребуется нормализованная схема.

Деплой не считается проверенным, пока не получен URL и не проверены production HTTP-ответы. Проверка реальных iOS/Android остаётся отдельным шагом.
