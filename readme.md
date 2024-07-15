## mapepire-js Db2 for i client

mapepire-js is the pure-JS client (written in TS) for connecting to Db2 for IBM i.

[Check out the documentation ⭐️](https://mapepire-ibmi.github.io/guides/runtimes/nodejs/)

### How to dev/test

1. Clone & `npm install`
2. Make a copy of `.env.sample` named `.env`
   * Set the server and port variables to the Mapepire daemon server (either on the server or locally)
   * Set the username and password to an IBM i user profile and password
3. `npm run test`