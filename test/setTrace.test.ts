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

test(`Can set trace`, async () => {
    const job = new SQLJob();
    const dest: ServerTraceDest = "FILE"
    const level: ServerTraceLevel = "ERRORS"
    await job.connect(creds);
    const res = await job.setTraceConfig(dest, level)
    await job.close();
    expect(res.tracedest).toBe("FILE")
    expect(res.tracelevel).toBe("ERRORS")
})
