# API Client

Typed TypeScript client consumed by mobile and web applications.

```ts
const api = new ApiClient({ baseUrl: "http://localhost:8000/api/v1" });
const meta = await api.getMeta();
```
