import { spawn } from 'node:child_process';

if (process.argv.includes('--crash')) {
  console.error('Deliberate test failure');
  process.exit(7);
}
if (process.argv.includes('--tree')) {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.once('data', () => console.log(`descendant:${child.pid}`));
}
console.log('fixture ready');
console.error('fixture stderr');
const bytes = Buffer.from('🧇 streaming output\n');
process.stdout.write(bytes.subarray(0, 2));
setTimeout(() => process.stdout.write(bytes.subarray(2)), 20);
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));
setInterval(() => {}, 1000);
