import { searchLogsSchema } from './src/lib/tools/search-logs.ts';
import { z } from 'zod';
import { tool, jsonSchema } from 'ai';

console.log("Is ZodObject?", searchLogsSchema instanceof z.ZodObject);

const t1 = tool({
  description: "Test parameters",
  parameters: searchLogsSchema,
} as any);
console.log("t1 parameters:", !!t1.parameters);

const t2 = tool({
  description: "Test inputSchema",
  inputSchema: searchLogsSchema,
} as any);
console.log("t2 inputSchema:", !!t2.inputSchema);
