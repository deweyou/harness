import { cp, mkdir, rm } from 'node:fs/promises';

const source = new URL('../dashboard/dist/client/', import.meta.url);
const target = new URL('../assets/dashboard/', import.meta.url);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

console.log('Dashboard assets synchronized.');
