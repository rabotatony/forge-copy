// Sample project — app.ts (the entry point that depends on utils)
import { add, multiply, factorial, safeDivide } from './utils/math';
import { upper, lower, reverse } from './utils/strings';

export function main(): void {
  const sum = add(2, 3);
  const product = multiply(4, 5);
  const fact = factorial(6);
  const div = safeDivide(10, 2);
  console.log(`sum=${sum} product=${product} fact=${fact} div=${JSON.stringify(div)}`);

  const name = 'axiomstate';
  console.log(`upper=${upper(name)} lower=${lower(name)} reverse=${reverse(name)}`);
}

export function formatResult(label: string, value: number): string {
  return `${upper(label)}: ${value}`;
}
