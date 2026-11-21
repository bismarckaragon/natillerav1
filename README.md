# Natillera — Gestión de Fondos, Rifa Única Activa y Préstamos

Aplicación web lista para desplegar en **Coolify** con persistencia en **SQLite** (sin datos dummy).

## Características
- **Separación Administración vs. Miembros**:
  - `/` — Portal de miembros (acceso rápido a registro y rifa).
  - `/registro` — Enlace público para que un miembro se registre.
  - `/rifa` — Enlace público para que un miembro escoja sus números en la rifa activa (soporta `/rifa?miembro=<id>`).
  - `/admin` — Panel de administración completo protegido con contraseña/PIN.
- **Persistencia en SQLite** (`better-sqlite3` en modo WAL) — todos los cambios se guardan en disco en el servidor.
- **Sin datos dummy** — inicia completamente limpia (`$0` capital base, 0 miembros, 0 rifas, 0 préstamos, 0 movimientos).
- **Rifa única activa** con talonario interactivo `00–99` y descarga en imagen `.jpg`.
- **Control de capital y préstamos** con tasas individuales por préstamo, miembros responsables y deudores externos.
- **Respaldo JSON** — exportar e importar directamente contra la base de datos SQLite.
- **Healthcheck** integrado en `/api/health`.

## Despliegue en Coolify

### Opción 1: Dockerfile (Recomendada)
1. Sube este repositorio a GitHub / GitLab / Gitea.
2. En Coolify, crea un nuevo recurso **Application** apuntando a tu repositorio.
3. En **Build Pack**, selecciona **Dockerfile**.
4. En **Ports Exposes**, verifica que sea `3000`.
5. **MUY IMPORTANTE (Persistencia SQLite):** Ve a la pestaña **Storages** del recurso en Coolify y agrega un **Volume Mount**:
   - **Destination Path:** `/app/data`
   - Esto garantiza que el archivo `/app/data/natillera.db` se conserve entre despliegues y reinicios.
6. Haz clic en **Deploy**.

### Opción 2: Docker Compose
1. En Coolify, selecciona **Docker Compose** como Build Pack apuntando al repositorio.
2. El archivo `docker-compose.yml` ya declara el volumen persistente `natillera_data:/app/data` y la variable `DB_PATH=/app/data/natillera.db`.

## Variables de Entorno
| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP del servidor |
| `DB_PATH` | `./data/natillera.db` (`/app/data/natillera.db` en Docker) | Ruta del archivo SQLite |
| `ADMIN_PASSWORD` | *(opcional)* | Contraseña/PIN del panel `/admin`. Si no se define, se configura al primer ingreso en `/admin` y se guarda con hash en SQLite. |

## Ejecución Local
```bash
npm install
npm start
```
Abre `http://localhost:3000` en tu navegador.
