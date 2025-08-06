import { beforeAll, expect, test } from 'vitest';
import { SQLJob } from '../src';
import { getRootCertificate } from '../src/tls';
import { DaemonServer, ServerTraceDest, ServerTraceLevel } from '../src/types';
import { ENV_CREDS } from './env';

let creds: DaemonServer = { ...ENV_CREDS };


beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
  creds.rejectUnauthorized = false;
});

test(`connection doesn't timeout in one minute`,{timeout:70000}, async () => {

    const job = new SQLJob();
    const res = await job.connect(creds);
    await new Promise<void>((resolve, reject)=>{
      setTimeout(async ()=>{
      const query = await job.query<any>("SELECT * FROM SAMPLE.SYSCOLUMNS", {
        isTerseResults: false,
      });
      const res = await query.execute(50);
      await query.close();
      expect(res.success).toBe(true);
      await job.close();
      resolve()
    }, 60000)

    })
});

