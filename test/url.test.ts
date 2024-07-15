import { test } from 'vitest';
import { UrlToDaemon } from '../src/sqlJob';

test(`Basic url`, async () => {
  const base64Secret = Buffer.from(`password:weflgkjn3to8eghergnsdfjklgnsdfljas`).toString('base64');
  const uri = `db2i://liama:${base64Secret}@server.com:8076`;

  const result = UrlToDaemon(uri);
  expect(result.host).toBe(`server.com`);
  expect(result.port).toBe(8076);
  expect(result.user).toBe(`liama`);
  expect(result.password).toBe(`password`);
});
