# Web Portal

Role-based web application for administrators and vendors. The API remains the source of truth for authorization.

## Run locally

Start the API in one terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Api.ps1
```

Start the web portal in a second terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\scripts\Start-Web.ps1
```

Open `http://localhost:3000`. The first implemented screen is `/login`.
