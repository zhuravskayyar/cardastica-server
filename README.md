Cardastica server

Quick start:

1. Install dependencies

```bash
npm install
```

2. Run server (dev)

On Windows PowerShell (current session):

```powershell
cd cardastica-server
$env:CLIENT_ORIGIN="https://zhuravskayyar.github.io"
npm start
```

On Windows cmd.exe:

```cmd
cd cardastica-server
set CLIENT_ORIGIN=https://zhuravskayyar.github.io
npm start
```

PowerShell (one line):

```powershell
cd cardastica-server; $env:CLIENT_ORIGIN="https://zhuravskayyar.github.io"; npm start
```

Important: `CLIENT_ORIGIN` — это origin, без пути `/CARDFSTICANEW`. То есть именно `https://zhuravskayyar.github.io`.

3. Easier repeated start (cross-platform)

Install dev helper once:

```bash
npm i -D cross-env
```

Then use the provided npm script:

```bash
npm run start:dev
```

This runs:

```
cross-env CLIENT_ORIGIN=https://zhuravskayyar.github.io node server.js
```

4. Quick checks

When server started, open in browser:

http://localhost:3000/ → should return plain `OK`

http://localhost:3000/online → should return JSON like:

```json
{ "ok": true, "count": 0, "list": [] }
```

5. Deploy on Render

In Render service settings add environment variable:

`CLIENT_ORIGIN = https://zhuravskayyar.github.io`

Render will set the `PORT` environment variable automatically.

Notes:
- Set `CLIENT_ORIGIN` to the exact origin of your frontend (scheme + host + optional port). Do not include path.
- This server keeps presence/chat in memory — for production use Redis/Postgres.
