import { getRuntime } from '@dd/core';
import { buildServer } from './server.ts';

const rt = getRuntime();
await rt.start();
const server = await buildServer(rt.lifecycle, rt.cfg);
await server.listen({ port: rt.cfg.port, host: rt.cfg.host });
