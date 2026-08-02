// Sample project — index.ts (the root entry point)
import { main, formatResult } from './app';
import { factorial } from './utils/math';

const results: string[] = [];
for (let i = 1; i <= 5; i++) {
  results.push(formatResult(`fact-${i}`, factorial(i)));
}

main();
console.log(results.join('\n'));
