# AutoSalon — Node.js + Microsoft SQL Server

Учебное веб-приложение автосалона на Node.js. Поддерживает два хранилища:

- **Microsoft SQL Server** — основной режим для работы с базой `AutoSalonDB` в SSMS;
- **SQLite** — прежний учебный режим для автономного запуска и локальных тестов.

В режиме SQL Server приложение работает с таблицами `dbo.Brands`, `dbo.Models`, `dbo.Positions`, `dbo.Employees`, `dbo.Customers`, `dbo.Suppliers`, `dbo.Cars`, `dbo.Sales`, `dbo.ServiceRecords`, `dbo.PurchaseOrders` и `dbo.PurchaseOrderItems`, созданными скриптом `database/sqlserver/AutoSalonDB_Create_And_Seed.sql`.

## 1. Создать базу через SSMS

1. Откройте SQL Server Management Studio (SSMS) и подключитесь к своему экземпляру SQL Server.
2. Откройте файл `database/sqlserver/AutoSalonDB_Create_And_Seed.sql`.
3. Выполните скрипт клавишей **F5**.
4. В результатах выполнения проверьте таблицу с количеством строк и список автомобилей.

> Внимание: скрипт создаёт `AutoSalonDB`, если базы нет. При повторном запуске он удаляет и пересоздаёт таблицы этого проекта внутри `AutoSalonDB`, то есть тестовые данные в этих таблицах заменятся. Перед запуском на базе с нужными данными сделайте резервную копию.

## 2. Запуск на Windows с Windows Authentication

Это рекомендуемый вариант для ваших текущих параметров, когда SQL Server находится на этом же компьютере.

1. Установите Node.js 22 или новее.
2. Для драйвера Windows Authentication установите **Microsoft ODBC Driver 18 for SQL Server**: <https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server>.
3. Скопируйте `.env.example` в `.env`.
4. Проверьте параметры в `.env`:

```dotenv
DB_CLIENT=mssql
MSSQL_AUTH=windows
MSSQL_SERVER=localhost
MSSQL_INSTANCE=SQLEXPRESS
MSSQL_DATABASE=AutoSalonDB
MSSQL_ODBC_DRIVER=ODBC Driver 18 for SQL Server
MSSQL_ENCRYPT=false
MSSQL_TRUST_SERVER_CERTIFICATE=true
```

Если у вас **экземпляр по умолчанию**, а не `SQLEXPRESS`, очистите `MSSQL_INSTANCE` и укажите TCP-порт в `MSSQL_PORT` (часто это `1433`). Имя экземпляра можно посмотреть в SSMS в строке подключения.

5. Откройте терминал в папке проекта и выполните:

```powershell
npm install
npm start
```

6. Откройте <http://localhost:5000>. Проверить состояние подключения можно по адресу <http://localhost:5000/api/health>.

При Windows Authentication Node.js подключается от имени Windows-пользователя, который запустил `npm start`. Этот пользователь должен иметь login на экземпляре SQL Server и права на `AutoSalonDB`. Если вход в SSMS работает, а приложение получает отказ в доступе, проверьте, что запуск приложения выполняется под той же Windows-учётной записью.

## 3. Запуск приложения в Docker

В обычном Docker Desktop используется Linux-контейнер. Он не получает автоматически текущую Windows-сессию пользователя, поэтому готовая конфигурация Compose использует **SQL Server Authentication**. Сам SQL Server остаётся на вашем компьютере Windows.

### Подготовка SQL Server

1. В конфигурации SQL Server включите TCP/IP и настройте фиксированный TCP-порт (предпочтительно `1433`). При изменении сетевых настроек может потребоваться перезапустить службу SQL Server.
2. Если сервер настроен только на Windows Authentication, включите режим **SQL Server and Windows Authentication mode** и перезапустите службу.
3. Создайте отдельный SQL login для приложения и пользователя базы в `AutoSalonDB`. Выдайте необходимые права чтения и изменения данных (`db_datareader` и `db_datawriter`). Не используйте пароль в исходном коде или в Git.
4. Убедитесь, что брандмауэр Windows разрешает входящее подключение к выбранному TCP-порту с локального Docker-хоста.

### Подготовка `.env`

Скопируйте `.env.example` в `.env`. Для Docker заполните параметры SQL login, например:

```dotenv
MSSQL_DATABASE=AutoSalonDB
MSSQL_USER=autosalon_app
MSSQL_PASSWORD=ЗАМЕНИТЕ_НА_РЕАЛЬНЫЙ_ПАРОЛЬ
MSSQL_DOCKER_SERVER=host.docker.internal
MSSQL_DOCKER_PORT=1433
MSSQL_ENCRYPT=false
MSSQL_TRUST_SERVER_CERTIFICATE=true
```

`docker-compose.yml` сам задаёт `DB_CLIENT=mssql` и `MSSQL_AUTH=sql`. Не добавляйте `.env` в репозиторий.

Запуск:

```bash
docker compose up --build -d
docker compose logs -f autosalon
```

Откройте <http://localhost:5000>. Остановка:

```bash
docker compose down
```

Если SQL Server использует динамический порт или именованный экземпляр, задайте экземпляру фиксированный TCP-порт и укажите его в `MSSQL_DOCKER_PORT`. Имя экземпляра `SQLEXPRESS` внутри контейнера обычно не является заменой TCP-порта для `host.docker.internal`.

## 4. Проверка подключения

После запуска откройте `http://localhost:5000/api/health`. При успехе API возвращает `status: "ok"`, имя базы и имя текущего SQL Server login. При неудаче проверьте:

- `MSSQL_SERVER`, `MSSQL_INSTANCE` или `MSSQL_PORT`;
- имя базы `MSSQL_DATABASE`;
- способ авторизации (`windows` для локального запуска Windows, `sql` для Docker);
- права login на базу, TCP/IP и доступность порта;
- установлен ли ODBC Driver 18, если запущено с `MSSQL_AUTH=windows`.

Не передавайте пароль в сообщениях или скриншотах. Для диагностики достаточно текста ошибки без секретов.

## 5. Функциональность и таблицы

В веб-интерфейсе доступны марки, модели, должности, сотрудники, клиенты, поставщики, автомобили, продажи, сервисные записи, заказы поставщикам и позиции заказов. Операции учитывают связи и ограничения базы. При создании продажи приложение в транзакции переводит автомобиль в статус `Продан` и добавляет запись о продаже.

API:

- `GET /api/health` — проверка подключения;
- `GET /api/cars` — список автомобилей с маркой, моделью и статусом.

## 6. Тесты и Docker-образ

Проверка синтаксиса и тесты старого SQLite-режима:

```bash
npm install
npm run check
npm test
```

GitHub Actions проверяет проект при push и pull request. Для сборки/публикации образа настройте репозиторий и права GitHub Container Registry. Для реального подключения к вашей базе SQL Server тест запускайте на компьютере с доступным SQL Server и корректными параметрами `.env`.

## 7. Переключение между SQLite и SQL Server

- SQL Server: `DB_CLIENT=mssql` (и остальные `MSSQL_*` параметры).
- SQLite: `DB_CLIENT=sqlite` или не задавать `DB_CLIENT`; используется `DATABASE_PATH`.

Секретные параметры подключения держите только в локальном `.env` или в защищённых переменных CI/CD.
