# Cloudflare Workers + D1

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

Бюджет хранится единым JSON на аккаунт с ограничением 1.8 MB (до лимита значения D1). Это сохраняет атомарность переноса между месяцами; интерфейс предложит экспорт при достижении ограничения. Для больших архивов потребуется нормализованная схема.

Деплой не считается проверенным, пока не получен URL и не проверены production HTTP-ответы. Проверка реальных iOS/Android остаётся отдельным шагом.
